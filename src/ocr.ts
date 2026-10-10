import { execFile } from "child_process";
import fs from "fs-extra";
import path from "path";
import { promisify } from "util";

import { ChannelKind, SearchMessage } from "./interfaces.js";

const execFileAsync = promisify(execFile);

/**
 * Text read out of the pictures in the archive.
 *
 * Done once, in its own step, and remembered. The search database is thrown
 * away and rebuilt from nothing every time; if the pictures were read as part
 * of that, 40 000 of them would be read again on every build. So the readings
 * live in a file of their own, keyed by file id, and the build only looks
 * them up.
 */

/** One reading per line: `{"id":"F01…","text":"…"}`. Append-only. */
export interface OcrRecord {
  id: string;
  text: string;
}

/** What the reader has, as far as the build is concerned. */
export type OcrCache = Map<string, string>;

/**
 * Channel kinds whose pictures may be read and indexed.
 *
 * An allow-list, not a deny-list of `im` and `mpim`. A kind that is missing or
 * new is refused, the same way the search gate refuses a channel it cannot
 * classify. A screenshot is the commonest picture of text there is, and the
 * ones in a direct message were sent to one person.
 */
const OCR_KINDS = new Set<ChannelKind>(["public", "private"]);

export function isOcrAllowedKind(kind: ChannelKind | undefined): boolean {
  return !!kind && OCR_KINDS.has(kind);
}

/** Pictures bigger than this are not worth the minutes. Same as the bot's cap. */
export const OCR_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Words below this confidence are dropped, on a scale of 0 to 100.
 *
 * Tesseract reads a photograph of a dog as a few lines of confident-looking
 * noise. Its per-word confidence is low for that noise and high for real
 * print, so the cut is made per word rather than per picture.
 */
export const MIN_WORD_CONFIDENCE = 60;

/**
 * Fewer characters than this is not a reading. A lone "l" or "I1" from a
 * photograph would make the picture match queries it has nothing to do with.
 */
export const MIN_TEXT_LENGTH = 12;

/**
 * Reduce Tesseract's TSV output to the words worth indexing.
 *
 * Level 5 rows are words; the rest describe pages, blocks and lines. Columns:
 * level, page, block, par, line, word, left, top, width, height, conf, text.
 * The text column may itself contain tabs in no case seen, but is rejoined
 * rather than trusted to be a single field.
 */
export function parseTesseractTsv(tsv: string): string {
  const words: Array<string> = [];

  for (const row of tsv.split(/\r?\n/)) {
    const cells = row.split("\t");

    if (cells.length < 12 || cells[0] !== "5") continue;

    const confidence = Number(cells[10]);
    const text = cells.slice(11).join(" ").trim();

    if (!text || !Number.isFinite(confidence)) continue;
    if (confidence < MIN_WORD_CONFIDENCE) continue;

    words.push(text);
  }

  const joined = words.join(" ").replace(/\s+/g, " ").trim();

  return joined.length >= MIN_TEXT_LENGTH ? joined : "";
}

/** Reads one picture. Injectable, so the rest runs without Tesseract. */
export type OcrReader = (imagePath: string) => Promise<string>;

/**
 * Tesseract as a child process.
 *
 * `fin+eng`: the archive is Finnish with English in it. Both models must be
 * installed (`tesseract-ocr-fin`), or Tesseract exits with an error rather
 * than reading with the wrong one.
 */
export function createTesseractReader(
  options: { languages?: string; timeoutMs?: number } = {},
): OcrReader {
  const languages = options.languages ?? "fin+eng";
  const timeout = options.timeoutMs ?? 120_000;

  return async (imagePath) => {
    const { stdout } = await execFileAsync(
      "tesseract",
      [imagePath, "stdout", "-l", languages, "tsv"],
      { timeout, maxBuffer: 64 * 1024 * 1024 },
    );

    return parseTesseractTsv(stdout);
  };
}

export async function loadOcrCache(cachePath: string): Promise<OcrCache> {
  const cache: OcrCache = new Map();

  if (!(await fs.pathExists(cachePath))) return cache;

  const lines = (await fs.readFile(cachePath, "utf8")).split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const record = JSON.parse(line) as OcrRecord;

      // Last line wins, so a picture can be read again by appending.
      if (record && typeof record.id === "string") {
        cache.set(record.id, String(record.text ?? ""));
      }
    } catch {
      // A line cut short by a killed run. Everything before it still counts.
    }
  }

  return cache;
}

export async function appendOcrRecord(
  cachePath: string,
  record: OcrRecord,
): Promise<void> {
  await fs.ensureDir(path.dirname(cachePath));
  await fs.appendFile(cachePath, `${JSON.stringify(record)}\n`, "utf8");
}

export interface OcrCandidate {
  id: string;
  /** Where the file is on disk. */
  imagePath: string;
  size?: number;
}

export interface OcrRunResult {
  read: number;
  empty: number;
  failed: number;
  skipped: number;
}

/**
 * Read every candidate that has no reading yet.
 *
 * An empty reading is recorded too. "Nothing legible" is an answer, and
 * without it every photograph in the archive would be read again on every run.
 * A failure is not recorded: that may work next time.
 */
export async function readPending(
  candidates: AsyncIterable<OcrCandidate> | Iterable<OcrCandidate>,
  options: {
    cache: OcrCache;
    cachePath: string;
    reader: OcrReader;
    onProgress?: (done: number, candidate: OcrCandidate) => void;
  },
): Promise<OcrRunResult> {
  const result: OcrRunResult = { read: 0, empty: 0, failed: 0, skipped: 0 };
  let done = 0;

  for await (const candidate of candidates) {
    if (options.cache.has(candidate.id)) {
      result.skipped++;
      continue;
    }

    if (candidate.size !== undefined && candidate.size > OCR_MAX_BYTES) {
      result.skipped++;
      continue;
    }

    try {
      const text = await options.reader(candidate.imagePath);

      await appendOcrRecord(options.cachePath, { id: candidate.id, text });
      options.cache.set(candidate.id, text);

      if (text) result.read++;
      else result.empty++;
    } catch {
      result.failed++;
    }

    options.onProgress?.(++done, candidate);
  }

  return result;
}

/**
 * Attach the readings to the messages whose files they belong to.
 *
 * Files without a reading, or with an empty one, are returned as they were.
 */
export function withOcr(
  messages: Array<SearchMessage>,
  cache: OcrCache,
): Array<SearchMessage> {
  if (cache.size === 0) return messages;

  return messages.map((message) => {
    if (!message.files?.length) return message;

    return {
      ...message,
      files: message.files.map((file) => {
        const text = file.id ? cache.get(file.id) : undefined;

        return text ? { ...file, ocr: text } : file;
      }),
    };
  });
}
