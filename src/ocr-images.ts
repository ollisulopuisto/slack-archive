import esMain from "es-main";
import fs from "fs-extra";
import ora from "ora";

import { channelKind } from "./channels.js";
import {
  OCR_CACHE_PATH,
  SEARCH_EXCLUDE_KINDS,
  SEARCH_INCLUDE_BOTS,
  getChannelUploadFilePath,
} from "./config.js";
import { getChannels, getMessages } from "./data-load.js";
import {
  OcrCandidate,
  createTesseractReader,
  isOcrAllowedKind,
  loadOcrCache,
  readPending,
} from "./ocr.js";
import { isImageFile } from "./search-db.js";
import { isChannelSearchable, toSearchMessages } from "./search-filter.js";

/**
 * Every picture in a channel that could be read, in archive order.
 *
 * Channels whose kind may not be read (direct messages, anything unclassified)
 * are never opened, so a picture in one is not even handed to Tesseract.
 */
async function* candidates(): AsyncGenerator<OcrCandidate> {
  const channels = await getChannels();

  for (const channel of channels) {
    if (!channel.id) continue;
    if (!isChannelSearchable(channel, SEARCH_EXCLUDE_KINDS)) continue;
    if (!isOcrAllowedKind(channelKind(channel))) continue;

    const messages = toSearchMessages(await getMessages(channel.id, true), {
      hiddenUsers: new Set(),
      includeBots: SEARCH_INCLUDE_BOTS,
    });

    for (const message of messages) {
      for (const file of message.files || []) {
        if (!file.id || !file.filename || !isImageFile(file)) continue;

        const imagePath = getChannelUploadFilePath(channel.id, file.filename);
        const stat = await fs.stat(imagePath).catch(() => null);

        // Not downloaded, or downloaded as nothing. Not a failure: the
        // picture may arrive in a later run.
        if (!stat || !stat.isFile() || stat.size === 0) continue;

        yield { id: file.id, imagePath, size: stat.size };
      }
    }
  }
}

export async function ocrImages() {
  const spinner = ora("Reading pictures...").start();
  const cache = await loadOcrCache(OCR_CACHE_PATH);
  const before = cache.size;

  spinner.info(
    `${before} pictures already read; new ones are added to ${OCR_CACHE_PATH}`,
  );
  spinner.start();

  const result = await readPending(candidates(), {
    cache,
    cachePath: OCR_CACHE_PATH,
    reader: createTesseractReader(),
    onProgress: (done, candidate) => {
      spinner.text = `Reading pictures... ${done} (${candidate.id})`;
    },
  });

  spinner.succeed(
    `Read ${result.read} with text, ${result.empty} without, ` +
      `${result.failed} failed, ${result.skipped} already done. ` +
      `Rebuild the search database (npm run build-db) to index them.`,
  );

  if (result.failed > 0) process.exitCode = 1;
}

if (esMain(import.meta)) {
  ocrImages().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
