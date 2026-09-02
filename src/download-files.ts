import fetch from "node-fetch";
import fs from "fs-extra";
import esMain from "es-main";
import ora, { Ora } from "ora";

import { File } from "./interfaces.js";
import { EXCLUDE_USER_FILES } from "./config.js";
import { skipsFiles } from "./file-owners.js";
import {
  ArchivedFile,
  archivedFileName,
  archivedThumbName,
  fileDownloadUrl,
} from "./archived-files.js";
import {
  getChannelUploadFilePath,
  config,
  NO_FILE_DOWNLOAD,
} from "./config.js";
import { getChannels, getMessages, getUsers } from "./data-load.js";
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

/**
 * Whether this URL may see the Slack user token.
 *
 * The default used to send `Authorization: Bearer` to whatever Slack (or a
 * crafted JSON file) named. Avatars and emoji do not need it; an
 * attacker-controlled `url_private` must never see it.
 */
export function shouldSendSlackToken(url: string): boolean {
  let host: string;

  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return (
    host === "files.slack.com" ||
    host.endsWith(".files.slack.com") ||
    host === "slack-files.com" ||
    host.endsWith(".slack-files.com")
  );
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

export async function downloadURL(
  url: string,
  filePath: string,
  options: DownloadUrlOptions = {},
  redirectsLeft = 5,
): Promise<DownloadOutcome> {
  const wantsAuth = options.authorize !== false;
  const authorize = wantsAuth && shouldSendSlackToken(url);

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
    const response = await fetch(url, { headers, redirect: "manual" });

    if (REDIRECT.has(response.status)) {
      const location = response.headers.get("location");

      if (!location || redirectsLeft <= 0) {
        console.warn(`Failed to download file ${url}: redirect with no target`);
        return "failed";
      }

      const next = new URL(location, url).href;

      // Recompute authorization for the new host: a Slack URL that bounces to
      // a tracker must not take the token with it.
      return downloadURL(
        next,
        filePath,
        { ...options, force: true },
        redirectsLeft - 1,
      );
    }

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
  const { thumb_pdf } = file as any;

  const fileUrl = fileDownloadUrl(file as ArchivedFile);
  const name = archivedFileName(file as ArchivedFile);

  if (!fileUrl || !name) return;

  spinner.text = `Downloading ${i}/${total}: ${fileUrl}`;

  const filePath = getChannelUploadFilePath(channelId, name);

  await downloadURL(fileUrl, filePath);

  // Any file Slack made a PDF preview for, not only PDFs themselves: the
  // pages show that preview for every non-image attachment, so a .docx whose
  // thumbnail was never fetched is a broken image on the site.
  if (thumb_pdf) {
    spinner.text = `Downloading ${i}/${total}: ${thumb_pdf}`;
    await downloadURL(
      thumb_pdf,
      getChannelUploadFilePath(
        channelId,
        archivedThumbName(file as ArchivedFile)!,
      ),
    );
  }
}

export async function downloadFilesForChannel(channelId: string, spinner: Ora) {
  if (NO_FILE_DOWNLOAD) {
    return;
  }

  // Whose files this archive does not fetch: see EXCLUDE_USER_FILES.
  const skip = skipsFiles(EXCLUDE_USER_FILES, await getUsers());
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

    if (fileMessage.files && !skip.has(fileMessage.user || "")) {
      for (const file of fileMessage.files) {
        spinner.text = getSpinnerText(i);
        spinner.render();
        await downloadFile(file, channelId, i, fileMessages.length, spinner);
      }
    }

    if (fileMessage.replies) {
      for (const [ri, reply] of fileMessage.replies.entries()) {
        if (reply.files && !skip.has(reply.user || "")) {
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
