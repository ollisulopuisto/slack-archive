import path from "path";
import ora from "ora";
import fs from "fs";
import { createRequire } from "node:module";

import { EMOJIS_DIR, NO_SLACK_CONNECT } from "./config.js";
import { downloadURL } from "./download-files.js";
import { EmojiIndex } from "./emoji-render.js";
import { ArchiveMessage, Emojis } from "./interfaces.js";
import { getWebClient } from "./web-client.js";

const require = createRequire(import.meta.url);
const emojiData = require("emoji-datasource");

let _unicodeEmoji: Record<string, string>;
function getUnicodeEmoji() {
  if (_unicodeEmoji) {
    return _unicodeEmoji;
  }

  _unicodeEmoji = {};
  for (const emoji of emojiData) {
    _unicodeEmoji[emoji.short_name as string] = emoji.unified;
  }

  return _unicodeEmoji;
}

export function getEmojiFilePath(name: string, extension?: string) {
  // If we have an extension, return the correct path
  if (extension) {
    return path.join(EMOJIS_DIR, `${name}${extension}`);
  }

  // If we don't have an extension, return the first path that exists
  // regardless of extension
  const extensions = [".png", ".jpg", ".gif"];
  for (const ext of extensions) {
    if (fs.existsSync(path.join(EMOJIS_DIR, `${name}${ext}`))) {
      return path.join(EMOJIS_DIR, `${name}${ext}`);
    }
  }
}

/**
 * How the HTML refers to a downloaded custom emoji, relative to the html
 * directory - the same way avatars are referenced.
 *
 * Not the filesystem path: that starts with /Users/somebody and is a broken
 * image everywhere except the machine that rendered the page.
 */
export function getEmojiRef(name: string) {
  const filePath = getEmojiFilePath(name);

  return filePath ? `emojis/${path.basename(filePath)}` : undefined;
}

export function isEmojiUnicode(name: string) {
  const unicodeEmoji = getUnicodeEmoji();
  return !!unicodeEmoji[name];
}

export function getEmojiUnicode(name: string) {
  const unicodeEmoji = getUnicodeEmoji();
  const unified = unicodeEmoji[name];
  const split = unified.split("-");

  return split
    .map((code) => {
      return String.fromCodePoint(parseInt(code, 16));
    })
    .join("");
}

/**
 * Everything the browser needs to turn a shortcode into an emoji.
 *
 * The rendered pages do this here, with the emoji directory and the emoji
 * datasource both on disk. The search page cannot: it is a template, it runs
 * in somebody's browser and it prints the raw message text out of the index.
 * So it is handed the same two facts as data - every standard shortcode and
 * the character it means, and every custom emoji this archive actually
 * downloaded and the file it lives in.
 *
 * The custom half is read from the emoji directory rather than from
 * emojis.json, for the same reason getEmojiRef is: what matters is which
 * pictures are on disk to point at, not which ones the workspace has.
 */
export function getEmojiIndex(): EmojiIndex {
  return {
    unicode: getUnicodeEmojiChars(),
    custom: getDownloadedEmoji(),
  };
}

/** Every standard shortcode, mapped to the character it means. */
function getUnicodeEmojiChars(): Record<string, string> {
  const chars: Record<string, string> = {};

  for (const name of Object.keys(getUnicodeEmoji())) {
    chars[name] = getEmojiUnicode(name);
  }

  return chars;
}

/**
 * Every custom emoji on disk, mapped the way the pages refer to it.
 *
 * An emoji the workspace has but this archive never downloaded is not in here,
 * and that is the point: a name with no file behind it would render as a
 * broken image, where the shortcode at least still says what was meant.
 */
function getDownloadedEmoji(): Record<string, string> {
  if (!fs.existsSync(EMOJIS_DIR)) {
    return {};
  }

  const extensions = new Set([".png", ".jpg", ".gif"]);
  const refs: Record<string, string> = {};

  for (const file of fs.readdirSync(EMOJIS_DIR)) {
    const extension = path.extname(file).toLowerCase();

    if (!extensions.has(extension)) continue;

    refs[path.basename(file, path.extname(file)).toLowerCase()] =
      `emojis/${file}`;
  }

  return refs;
}

export async function downloadEmojiList(): Promise<Emojis> {
  if (NO_SLACK_CONNECT) {
    return {};
  }

  const response = await getWebClient().emoji.list();

  if (response.ok) {
    return response.emoji!;
  } else {
    return {};
  }
}

export async function downloadEmoji(
  name: string,
  url: string,
  emojis: Emojis,
): Promise<void> {
  // Alias?
  if (url.startsWith("alias:")) {
    const alias = getEmojiAlias(url);

    if (!emojis[alias]) {
      console.warn(
        `Found emoji alias ${alias}, which does not exist in master emoji list`,
      );
      return;
    } else {
      return downloadEmoji(alias, emojis[alias], emojis);
    }
  }

  const extension = path.extname(url);
  const filePath = getEmojiFilePath(name, extension);

  await downloadURL(url, filePath!);
}

export function getEmojiAlias(name: string): string {
  // Ugh regex methods - this should turn "alias:hi-bob" into "hi-bob"
  const alias = [...name.matchAll(/alias:(.*)/g)][0][1]!;
  return alias!;
}

/**
 * Every emoji this workspace made itself, downloaded once per run.
 *
 * It used to scan messages for the emoji in their REACTIONS, which meant an
 * emoji only ever typed in message text was never downloaded, and one added
 * to a channel that had no new messages this run was never downloaded either.
 * The whole list is a few hundred small files and the existence check makes
 * every run after the first one nearly free, so there is nothing to be clever
 * about.
 */
export async function downloadAllEmoji(emojis: Emojis) {
  const names = Object.keys(emojis);

  if (names.length === 0) {
    return;
  }

  const spinner = ora(`Downloading ${names.length} custom emoji...`).start();
  let downloaded = 0;
  let skipped = 0;

  for (const [i, name] of names.entries()) {
    spinner.text = `Downloading custom emoji ${i + 1}/${names.length}: ${name}`;
    spinner.render();

    const url = resolveEmojiUrl(name, emojis);

    // An alias pointing at one of Slack's own emoji, e.g. shipit -> squirrel.
    // There is nothing to download and nothing wrong.
    if (!url) {
      skipped++;
      continue;
    }

    // Under its OWN name, not the target's: the message says :salut-2:, and
    // that is the file the page will ask for.
    await downloadURL(url, getEmojiFilePath(name, path.extname(url))!);
    downloaded++;
  }

  spinner.succeed(
    `Downloaded ${downloaded} custom emoji${skipped > 0 ? ` (${skipped} alias to standard emoji)` : ""}`,
  );
}

/** Follows alias chains to the URL that actually holds an image. */
function resolveEmojiUrl(
  name: string,
  emojis: Emojis,
  seen = new Set<string>(),
): string | undefined {
  const url = emojis[name];

  if (!url || seen.has(name)) {
    return undefined;
  }

  if (!url.startsWith("alias:")) {
    return url;
  }

  seen.add(name);

  return resolveEmojiUrl(getEmojiAlias(url), emojis, seen);
}
