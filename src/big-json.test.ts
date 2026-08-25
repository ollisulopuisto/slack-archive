import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { constants as bufferConstants } from "buffer";

import {
  MAX_STRING_LENGTH,
  readJsonArraySync,
  readSearchDataSync,
  writeJsonArraySync,
  writeSearchDataSync,
} from "./big-json.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-json-"));
});

afterEach(() => {
  fs.removeSync(dir);
  vi.restoreAllMocks();
});

function file(name = "messages.json") {
  return path.join(dir, name);
}

const MESSAGES = [
  { ts: "1.0", user: "U1", text: "hei" },
  { ts: "2.0", user: "U2", text: 'brackets ] } "quoted" \\ and , commas' },
  { ts: "3.0", text: "unicode: ääkköset 🇫🇮 😀", reactions: [{ name: "+1" }] },
  { ts: "4.0", files: [], replies: [{ ts: "4.1", nested: { deep: [1, 2] } }] },
  { ts: "5.0", text: null, edited: undefined },
];

describe("writeJsonArraySync", () => {
  // The bug: JSON.stringify on a 713k-message array produced a string past
  // V8's 536,870,888-character ceiling and threw RangeError: Invalid string
  // length. Nothing about the array is too big for disk - only for one string
  // - so the whole array must never be handed to JSON.stringify at once.
  it("never stringifies the whole array at once", () => {
    const stringify = vi.spyOn(JSON, "stringify");

    writeJsonArraySync(file(), MESSAGES);

    const stringifiedTheArray = stringify.mock.calls.some(([value]) =>
      Array.isArray(value),
    );
    expect(stringifiedTheArray).toBe(false);
  });

  it("writes a file that plain JSON.parse understands", () => {
    writeJsonArraySync(file(), MESSAGES);

    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual(
      JSON.parse(JSON.stringify(MESSAGES)),
    );
  });

  it("writes an empty array", () => {
    writeJsonArraySync(file(), []);

    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual([]);
  });

  it("creates missing parent directories", () => {
    const nested = path.join(dir, "a", "b", "messages.json");

    writeJsonArraySync(nested, MESSAGES);

    expect(fs.existsSync(nested)).toBe(true);
  });

  it("leaves the previous file intact when writing fails", () => {
    writeJsonArraySync(file(), MESSAGES);
    const circular: any = { ts: "6.0" };
    circular.self = circular;

    expect(() => writeJsonArraySync(file(), [circular])).toThrow();
    expect(readJsonArraySync(file())).toEqual(
      JSON.parse(JSON.stringify(MESSAGES)),
    );
    expect(fs.readdirSync(dir)).toEqual(["messages.json"]);
  });
});

describe("readJsonArraySync", () => {
  it("defaults to the largest string V8 will make", () => {
    expect(MAX_STRING_LENGTH).toBe(bufferConstants.MAX_STRING_LENGTH);
  });

  it("round-trips what writeJsonArraySync wrote", () => {
    writeJsonArraySync(file(), MESSAGES);

    expect(readJsonArraySync(file())).toEqual(
      JSON.parse(JSON.stringify(MESSAGES)),
    );
  });

  // Archives written by earlier versions are pretty-printed with an indent of
  // 2. Those files are the ones that grew past the limit, so the reader that
  // exists to rescue them has to understand them.
  it("reads a file too big for one string, without making one", () => {
    fs.writeFileSync(file(), JSON.stringify(MESSAGES, undefined, 2));
    const readFileSync = vi.spyOn(fs, "readFileSync");

    // A limit small enough that this file counts as oversized.
    const read = readJsonArraySync(file(), { maxStringLength: 16 });

    expect(read).toEqual(JSON.parse(JSON.stringify(MESSAGES)));
    for (const call of readFileSync.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  it("reads the same values whichever path it takes", () => {
    const compact = file("compact.json");
    const pretty = file("pretty.json");
    fs.writeFileSync(compact, JSON.stringify(MESSAGES));
    fs.writeFileSync(pretty, JSON.stringify(MESSAGES, undefined, 2));

    for (const oversized of [compact, pretty]) {
      expect(readJsonArraySync(oversized, { maxStringLength: 16 })).toEqual(
        readJsonArraySync(oversized),
      );
    }
  });

  it("handles scalars, nulls and empty arrays in the oversized path", () => {
    const values = [1, "two ]", null, true, [], {}, [[{ a: "]" }]]];
    fs.writeFileSync(file(), JSON.stringify(values, undefined, 2));

    expect(readJsonArraySync(file(), { maxStringLength: 1 })).toEqual(values);
    fs.writeFileSync(file(), "[]");
    expect(readJsonArraySync(file(), { maxStringLength: 1 })).toEqual([]);
  });

  it("refuses a file that is not a JSON array", () => {
    fs.writeFileSync(file(), '{"ts":"1.0"}');

    expect(() => readJsonArraySync(file(), { maxStringLength: 1 })).toThrow(
      /array/i,
    );
  });

  it("refuses a truncated array rather than returning half of it", () => {
    fs.writeFileSync(file(), '[{"ts":"1.0"},{"ts":"2.0"}');

    expect(() => readJsonArraySync(file(), { maxStringLength: 1 })).toThrow();
  });
});

const SEARCH_DATA = {
  users: { U1: "olli", U2: "matti" },
  channels: { C1: "offtopic", C2: "yleinen" },
  messages: {
    C1: [
      { m: "hei", u: "U1", t: "1.0" },
      { m: 'a } bracket, a "quote" and a \\ backslash', u: "U2", t: "2.0" },
      { m: "ääkköset 🇫🇮", t: "3.0" },
    ],
    C2: [],
  },
  pages: { C1: ["3.0", "1.0"], C2: [] },
};

/** What the one-shot writer used to produce, and what archives contain. */
function legacySearchData(data: unknown) {
  return `window.search_data = ${JSON.stringify(data)};`;
}

describe("writeSearchDataSync", () => {
  // search.js is the same failure waiting to happen: every message of every
  // channel in one JSON.stringify, 111 MB today.
  it("never stringifies the whole file or a whole channel at once", () => {
    const stringify = vi.spyOn(JSON, "stringify");

    writeSearchDataSync(file("search.js"), SEARCH_DATA);

    const stringifiedTooMuch = stringify.mock.calls.some(
      ([value]) =>
        Array.isArray(value) ||
        (typeof value === "object" &&
          value !== null &&
          "messages" in (value as object)),
    );
    expect(stringifiedTooMuch).toBe(false);
  });

  it("writes the assignment the browser expects", () => {
    writeSearchDataSync(file("search.js"), SEARCH_DATA);
    const contents = fs.readFileSync(file("search.js"), "utf8");

    expect(contents.startsWith("window.search_data = ")).toBe(true);
    expect(contents.trimEnd().endsWith(";")).toBe(true);
    expect(JSON.parse(contents.trimEnd().slice(21, -1))).toEqual(SEARCH_DATA);
  });

  it("writes an empty search file", () => {
    const empty = { users: {}, channels: {}, messages: {}, pages: {} };
    writeSearchDataSync(file("search.js"), empty);

    expect(readSearchDataSync(file("search.js"))).toEqual(empty);
  });
});

describe("readSearchDataSync", () => {
  it("returns nothing readable as empty rather than throwing", () => {
    expect(readSearchDataSync(file("missing.js"))).toEqual({
      users: {},
      channels: {},
      messages: {},
      pages: {},
    });
  });

  it("round-trips what writeSearchDataSync wrote", () => {
    writeSearchDataSync(file("search.js"), SEARCH_DATA);

    expect(readSearchDataSync(file("search.js"))).toEqual(SEARCH_DATA);
  });

  it("reads a file too big for one string, without making one", () => {
    fs.writeFileSync(file("search.js"), legacySearchData(SEARCH_DATA));
    const readFileSync = vi.spyOn(fs, "readFileSync");

    const read = readSearchDataSync(file("search.js"), { maxStringLength: 8 });

    expect(read).toEqual(SEARCH_DATA);
    for (const call of readFileSync.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  it("reads the same values whichever path it takes", () => {
    for (const contents of [
      legacySearchData(SEARCH_DATA),
      legacySearchData({ users: {}, channels: {}, messages: {}, pages: {} }),
    ]) {
      fs.writeFileSync(file("search.js"), contents);

      expect(
        readSearchDataSync(file("search.js"), { maxStringLength: 8 }),
      ).toEqual(readSearchDataSync(file("search.js")));
    }
  });

  it("refuses a file that is not the assignment it expects", () => {
    fs.writeFileSync(file("search.js"), "window.search_data = 5;");

    expect(() =>
      readSearchDataSync(file("search.js"), { maxStringLength: 1 }),
    ).toThrow(/object/i);
  });
});
