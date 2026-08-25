import { constants as bufferConstants } from "buffer";
import fs from "fs-extra";
import path from "path";

import { SearchFile, SearchMessage } from "./interfaces.js";

/**
 * The longest string V8 will make: 536,870,888 characters. A channel's message
 * data passed that in July 2026 (`offtopic`, 713k messages, 538 MB on disk) and
 * both halves of the archive broke at once - `JSON.stringify` of the array
 * threw `RangeError: Invalid string length` on write, and reading the file back
 * would have thrown the same on `readFileSync(path, "utf8")`.
 *
 * Nothing here is too big for disk or for memory, only for one string, so
 * neither direction goes through a whole-file string any more.
 */
export const MAX_STRING_LENGTH = bufferConstants.MAX_STRING_LENGTH;

/** Flush to disk about this often, in characters, while writing. */
const WRITE_CHUNK = 4 * 1024 * 1024;

const enum Byte {
  Tab = 0x09,
  NewLine = 0x0a,
  CarriageReturn = 0x0d,
  Space = 0x20,
  Quote = 0x22,
  Comma = 0x2c,
  Colon = 0x3a,
  OpenBracket = 0x5b,
  Backslash = 0x5c,
  CloseBracket = 0x5d,
  OpenBrace = 0x7b,
  CloseBrace = 0x7d,
}

/**
 * Open a file for streamed writing, hand `body` a `write` that buffers, and
 * rename the result into place. A failure partway through half a gigabyte
 * leaves the previous file where it was.
 */
function writeStreamed(
  filePath: string,
  body: (write: (text: string) => void) => void,
): void {
  fs.ensureDirSync(path.dirname(filePath));

  const tempPath = `${filePath}.tmp`;
  const fd = fs.openSync(tempPath, "w");
  let pending = "";

  const flush = () => {
    if (pending.length > 0) {
      fs.writeSync(fd, pending);
      pending = "";
    }
  };

  const write = (text: string) => {
    pending += text;

    if (pending.length >= WRITE_CHUNK) {
      flush();
    }
  };

  try {
    body(write);
    flush();
    fs.closeSync(fd);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed. The rename not happening is what matters.
    }

    fs.removeSync(tempPath);
    throw error;
  }
}

/**
 * `JSON.stringify` returns `undefined` for values JSON has no room for. Inside
 * an array or an object it writes `null` instead, and so do we, rather than
 * writing a hole into the file.
 */
function stringifyValue(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

/**
 * Write an array as JSON, one element per line, stringifying each element on
 * its own. The file is ordinary JSON - `JSON.parse` reads it back - but no
 * single string ever holds more than one element.
 */
export function writeJsonArraySync(filePath: string, items: unknown[]): void {
  writeStreamed(filePath, (write) => {
    write("[");

    for (const [i, item] of items.entries()) {
      write(i === 0 ? "\n" : ",\n");
      write(stringifyValue(item));
    }

    write(items.length > 0 ? "\n]\n" : "]\n");
  });
}

/** `search.js` is a JS assignment, not JSON: this is the part before the JSON. */
const SEARCH_DATA_PREFIX = "window.search_data = ";

/**
 * Write `search.js`, the file the search page loads. Every message of every
 * channel used to go through one `JSON.stringify` - 111 MB by August 2026, on
 * the same road to V8's string limit as the channel files - so the object is
 * written a message at a time.
 */
export function writeSearchDataSync(filePath: string, data: SearchFile): void {
  writeStreamed(filePath, (write) => {
    write(`${SEARCH_DATA_PREFIX}{`);
    write(`\n"users":${stringifyValue(data.users || {})},`);
    write(`\n"channels":${stringifyValue(data.channels || {})},`);
    write(`\n"pages":${stringifyValue(data.pages || {})},`);
    write(`\n"names":${stringifyValue(data.names || {})},`);
    write(`\n"messages":{`);

    let firstChannel = true;

    for (const [channelId, messages] of Object.entries(data.messages || {})) {
      write(firstChannel ? "\n" : ",\n");
      firstChannel = false;
      write(`${JSON.stringify(channelId)}:[`);

      for (const [i, message] of (messages || []).entries()) {
        write(i === 0 ? "" : ",");
        write(stringifyValue(message));
      }

      write("]");
    }

    write(firstChannel ? "}" : "\n}");
    write("\n};\n");
  });
}

export interface ReadJsonArrayOptions {
  /** Files larger than this are parsed element by element. Tests lower it. */
  maxStringLength?: number;
}

/**
 * Read a JSON array, parsing element by element when the file is too big to
 * become one string. Files written by earlier versions are pretty-printed with
 * an indent of 2; those are exactly the files that outgrew the limit, so the
 * element scanner reads any valid JSON array, not only what we write.
 */
export function readJsonArraySync<T>(
  filePath: string,
  options: ReadJsonArrayOptions = {},
): Array<T> {
  const { maxStringLength = MAX_STRING_LENGTH } = options;

  if (fs.statSync(filePath).size <= maxStringLength) {
    const parsed = fs.readJSONSync(filePath);

    if (!Array.isArray(parsed)) {
      throw new Error(`${filePath} does not contain a JSON array`);
    }

    return parsed;
  }

  const buffer = fs.readFileSync(filePath);

  return splitTopLevelArray(buffer, filePath).map(
    (element) => JSON.parse(element.toString("utf8")) as T,
  );
}

/**
 * Read `search.js` back. Anything unreadable is an empty search file, which is
 * what the callers already treated a missing file as.
 */
export function readSearchDataSync(
  filePath: string,
  options: ReadJsonArrayOptions = {},
): SearchFile {
  const empty: SearchFile = {
    users: {},
    channels: {},
    messages: {},
    pages: {},
    names: {},
  };

  if (!fs.existsSync(filePath)) {
    return empty;
  }

  const { maxStringLength = MAX_STRING_LENGTH } = options;
  const buffer = fs.readFileSync(filePath);
  const start = buffer.indexOf(Byte.OpenBrace);
  const end = buffer.lastIndexOf(Byte.CloseBrace);

  if (start < 0 || end < start) {
    throw new Error(`${filePath} does not contain a search_data object`);
  }

  const body = buffer.subarray(start, end + 1);

  if (body.length <= maxStringLength) {
    return { ...empty, ...JSON.parse(body.toString("utf8")) };
  }

  const result = empty;

  for (const [key, value] of splitTopLevelObject(body, filePath)) {
    if (key === "messages") {
      for (const [channelId, list] of splitTopLevelObject(value, filePath)) {
        result.messages[channelId] = splitTopLevelArray(list, filePath).map(
          (element) => JSON.parse(element.toString("utf8")) as SearchMessage,
        );
      }
    } else if (
      key === "users" ||
      key === "channels" ||
      key === "pages" ||
      key === "names"
    ) {
      result[key] = JSON.parse(value.toString("utf8"));
    }
  }

  return result;
}

/**
 * Slice a JSON object's buffer into one buffer per value, keyed by the parsed
 * key, without decoding the whole thing.
 */
function splitTopLevelObject(
  buffer: Buffer,
  filePath: string,
): Array<[string, Buffer]> {
  let i = skipWhitespace(buffer, 0);

  if (buffer[i] !== Byte.OpenBrace) {
    throw new Error(`${filePath} does not contain a JSON object`);
  }

  i++;

  const entries: Array<[string, Buffer]> = [];
  let closed = false;

  while (i < buffer.length) {
    i = skipWhitespace(buffer, i);

    if (i >= buffer.length) {
      break;
    }

    if (buffer[i] === Byte.CloseBrace) {
      i++;
      closed = true;
      break;
    }

    if (buffer[i] === Byte.Comma) {
      i++;
      continue;
    }

    if (buffer[i] !== Byte.Quote) {
      throw new Error(
        `${filePath} is not valid JSON: expected a key at byte ${i}`,
      );
    }

    const keyStart = i;
    i = endOfValue(buffer, i);
    const key = JSON.parse(buffer.subarray(keyStart, i).toString("utf8"));

    i = skipWhitespace(buffer, i);

    if (buffer[i] !== Byte.Colon) {
      throw new Error(
        `${filePath} is not valid JSON: expected ':' at byte ${i}`,
      );
    }

    i = skipWhitespace(buffer, i + 1);
    const valueStart = i;
    i = endOfValue(buffer, i);
    entries.push([key, buffer.subarray(valueStart, i)]);
  }

  if (!closed) {
    throw new Error(`${filePath} is not valid JSON: the object never closes`);
  }

  return entries;
}

/**
 * Slice a JSON array's buffer into one buffer per element without decoding it.
 * Every byte of a multi-byte UTF-8 character is >= 0x80, so no character can
 * masquerade as a brace, bracket, quote or comma: scanning bytes is safe.
 */
function splitTopLevelArray(buffer: Buffer, filePath: string): Array<Buffer> {
  const elements: Array<Buffer> = [];
  let i = skipWhitespace(buffer, 0);

  if (buffer[i] !== Byte.OpenBracket) {
    throw new Error(`${filePath} does not contain a JSON array`);
  }

  i++;

  let closed = false;
  let expectElement = true;

  while (i < buffer.length) {
    i = skipWhitespace(buffer, i);

    if (i >= buffer.length) {
      break;
    }

    if (buffer[i] === Byte.CloseBracket) {
      i++;
      closed = true;
      break;
    }

    if (buffer[i] === Byte.Comma) {
      i++;
      expectElement = true;
      continue;
    }

    if (!expectElement) {
      throw new Error(
        `${filePath} is not valid JSON: missing comma at byte ${i}`,
      );
    }

    const start = i;
    i = endOfValue(buffer, i);
    elements.push(buffer.subarray(start, i));
    expectElement = false;
  }

  if (!closed) {
    throw new Error(`${filePath} is not valid JSON: the array never closes`);
  }

  return elements;
}

function isWhitespace(byte: number): boolean {
  return (
    byte === Byte.Space ||
    byte === Byte.NewLine ||
    byte === Byte.CarriageReturn ||
    byte === Byte.Tab
  );
}

function skipWhitespace(buffer: Buffer, i: number): number {
  while (i < buffer.length && isWhitespace(buffer[i])) {
    i++;
  }

  return i;
}

/** The index just past the value starting at `i`. */
function endOfValue(buffer: Buffer, i: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < buffer.length; i++) {
    const byte = buffer[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (byte === Byte.Backslash) {
        escaped = true;
      } else if (byte === Byte.Quote) {
        inString = false;

        if (depth === 0) {
          return i + 1;
        }
      }

      continue;
    }

    if (byte === Byte.Quote) {
      inString = true;
    } else if (byte === Byte.OpenBrace || byte === Byte.OpenBracket) {
      depth++;
    } else if (byte === Byte.CloseBrace || byte === Byte.CloseBracket) {
      if (depth === 0) {
        // The array's own closing bracket, right after a bare number or the
        // like: the value ended at the previous byte.
        return i;
      }

      depth--;

      if (depth === 0) {
        return i + 1;
      }
    } else if (depth === 0 && (byte === Byte.Comma || isWhitespace(byte))) {
      // A bare number, `true`, `false` or `null` ends where it stops.
      return i;
    }
  }

  return i;
}
