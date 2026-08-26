import fetch from "node-fetch";
import fs from "fs-extra";
import esMain from "es-main";
import ora, { Ora } from "ora";
import path from "path";

import { File } from "./interfaces.js";
import {
  getChannelUploadFilePath,
  config,
  NO_FILE_DOWNLOAD,
} from "./config.js";
import { getChannels, getMessages } from "./data-load.js";
import { downloadAvatars } from "./users.js";

export interface DownloadUrlOptions {
  authorize?: boolean;
  force?: boolean;
}

/**
 * What happened, so a caller can tell "not there" from "will never be there".
 *
 * `refused` is the server declining - 403 and 404 on an avatar URL Slack has
 * retired, and no amount of retrying changes it. `failed` is everything that
 * might work next time: a timeout, a 5xx, a dropped connection.
 */
export type DownloadOutcome = "stored" | "skipped" | "refused" | "failed";

export async function downloadURL(
  url: string,
  filePath: string,
  options: DownloadUrlOptions = {},
): Promise<DownloadOutcome> {
  const authorize = options.authorize === undefined ? true : options.authorize;

  if (!options.force && fs.existsSync(filePath)) {
    return "skipped";
  }

  const { token } = config;
  const headers: HeadersInit = authorize
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};

  try {
    const response = await fetch(url, { headers });

    // A refusal has a body too. Slack answers an expired avatar or file link
    // with a 243-byte XML document, and writing that under the requested name
    // produces an error page called avatar.png: a broken image that looks
    // downloaded, and that the existence check above then skips forever.
    if (!response.ok) {
      console.warn(
        `Failed to download file ${url}: ${response.status} ${response.statusText}`,
      );

      // A 4xx is the server's settled answer. A 5xx might not be.
      return response.status >= 400 && response.status < 500
        ? "refused"
        : "failed";
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.outputFileSync(filePath, buffer);

    return "stored";
  } catch (error) {
    console.warn(`Failed to download file ${url}`, error);
    return "failed";
  }
}

async function downloadFile(
  file: File,
  channelId: string,
  i: number,
  total: number,
  spinner: Ora,
) {
  const { url_private, id, is_external, mimetype } = file;
  const { thumb_1024, thumb_720, thumb_480, thumb_pdf } = file as any;

  const fileUrl = is_external
    ? thumb_1024 || thumb_720 || thumb_480 || thumb_pdf
    : url_private;

  if (!fileUrl) return;

  spinner.text = `Downloading ${i}/${total}: ${fileUrl}`;

  const extension = path.extname(fileUrl);
  const filePath = getChannelUploadFilePath(channelId, `${id}${extension}`);

  await downloadURL(fileUrl, filePath);

  if (mimetype === "application/pdf" && thumb_pdf) {
    spinner.text = `Downloading ${i}/${total}: ${thumb_pdf}`;
    const thumbFile = filePath.replace(extension, ".png");
    await downloadURL(thumb_pdf, thumbFile);
  }
}

export async function downloadFilesForChannel(channelId: string, spinner: Ora) {
  if (NO_FILE_DOWNLOAD) {
    return;
  }

  const messages = await getMessages(channelId);
  const channels = await getChannels();
  const channel = channels.find(({ id }) => id === channelId);
  const fileMessages = messages.filter(
    (m) => (m.files?.length || m.replies?.length || 0) > 0,
  );
  const getSpinnerText = (i: number, ri?: number) => {
    let reply = "";
    if (ri !== undefined) {
      reply = ` (reply ${ri})`;
    }

    return `Downloading ${i}/${
      fileMessages.length
    }${reply} messages with files for channel ${channel?.name || channelId}...`;
  };

  spinner.text = getSpinnerText(0);

  for (const [i, fileMessage] of fileMessages.entries()) {
    if (!fileMessage.files && !fileMessage.replies) {
      continue;
    }

    if (fileMessage.files) {
      for (const file of fileMessage.files) {
        spinner.text = getSpinnerText(i);
        spinner.render();
        await downloadFile(file, channelId, i, fileMessages.length, spinner);
      }
    }

    if (fileMessage.replies) {
      for (const [ri, reply] of fileMessage.replies.entries()) {
        if (reply.files) {
          for (const file of reply.files) {
            spinner.text = getSpinnerText(i, ri);
            spinner.render();
            await downloadFile(
              file,
              channelId,
              i,
              fileMessages.length,
              spinner,
            );
          }
        }
      }
    }
  }
}
