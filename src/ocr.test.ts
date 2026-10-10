import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  MIN_WORD_CONFIDENCE,
  OCR_MAX_BYTES,
  OcrCandidate,
  appendOcrRecord,
  isOcrAllowedKind,
  loadOcrCache,
  parseTesseractTsv,
  readPending,
  withOcr,
} from "./ocr.js";
import {
  buildSearchDatabase,
  openSearchDatabase,
  searchDatabase,
} from "./search-db.js";
import { SearchMessage } from "./interfaces.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-ocr-"));
});

afterEach(() => {
  fs.removeSync(dir);
});

/** A Tesseract TSV row. Only level, confidence and text matter to the parser. */
function row(level: number, confidence: number, text: string) {
  return [level, 1, 1, 1, 1, 1, 0, 0, 10, 10, confidence, text].join("\t");
}

const HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

describe("parseTesseractTsv", () => {
  it("keeps the words Tesseract was sure of", () => {
    const tsv = [
      HEADER,
      row(5, 96, "Kokouksen"),
      row(5, 91, "pöytäkirja"),
      row(5, 88, "liitteineen"),
    ].join("\n");

    expect(parseTesseractTsv(tsv)).toBe("Kokouksen pöytäkirja liitteineen");
  });

  it("drops words below the confidence floor", () => {
    const tsv = [
      HEADER,
      row(5, 95, "Kokouksen"),
      row(5, MIN_WORD_CONFIDENCE - 1, "x7#"),
      row(5, 93, "pöytäkirja"),
    ].join("\n");

    expect(parseTesseractTsv(tsv)).toBe("Kokouksen pöytäkirja");
  });

  it("ignores rows that are not words", () => {
    const tsv = [
      HEADER,
      row(1, 100, "sivu"),
      row(4, 100, "rivi"),
      row(5, 90, "Kokouksen"),
      row(5, 90, "pöytäkirja"),
    ].join("\n");

    expect(parseTesseractTsv(tsv)).toBe("Kokouksen pöytäkirja");
  });

  it("reads a photograph's few stray characters as nothing", () => {
    const tsv = [HEADER, row(5, 80, "il"), row(5, 75, "Y")].join("\n");

    expect(parseTesseractTsv(tsv)).toBe("");
  });

  it("survives blank words and rows that are cut short", () => {
    const tsv = [HEADER, row(5, 90, ""), "5\t1\t1", "", ""].join("\n");

    expect(parseTesseractTsv(tsv)).toBe("");
  });
});

describe("isOcrAllowedKind", () => {
  it("allows public and private channels", () => {
    expect(isOcrAllowedKind("public")).toBe(true);
    expect(isOcrAllowedKind("private")).toBe(true);
  });

  it("refuses direct messages", () => {
    expect(isOcrAllowedKind("im")).toBe(false);
    expect(isOcrAllowedKind("mpim")).toBe(false);
  });

  it("refuses a channel whose kind is not known", () => {
    expect(isOcrAllowedKind(undefined)).toBe(false);
  });
});

describe("the reading cache", () => {
  it("is empty when nothing has been read", async () => {
    const cache = await loadOcrCache(path.join(dir, "ocr.jsonl"));

    expect(cache.size).toBe(0);
  });

  it("gives back what was appended", async () => {
    const cachePath = path.join(dir, "data", "ocr.jsonl");

    await appendOcrRecord(cachePath, { id: "F1", text: "yksi" });
    await appendOcrRecord(cachePath, { id: "F2", text: "" });

    const cache = await loadOcrCache(cachePath);

    expect(cache.get("F1")).toBe("yksi");
    expect(cache.has("F2")).toBe(true);
    expect(cache.get("F2")).toBe("");
  });

  it("lets a later line replace an earlier one", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");

    await appendOcrRecord(cachePath, { id: "F1", text: "vanha" });
    await appendOcrRecord(cachePath, { id: "F1", text: "uusi" });

    expect((await loadOcrCache(cachePath)).get("F1")).toBe("uusi");
  });

  it("keeps what came before a line cut short by a killed run", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");

    await appendOcrRecord(cachePath, { id: "F1", text: "ehjä" });
    await fs.appendFile(cachePath, '{"id":"F2","te');

    const cache = await loadOcrCache(cachePath);

    expect(cache.get("F1")).toBe("ehjä");
    expect(cache.has("F2")).toBe(false);
  });
});

describe("readPending", () => {
  const candidate = (id: string, size = 1000): OcrCandidate => ({
    id,
    imagePath: path.join(dir, `${id}.png`),
    size,
  });

  it("reads each new picture once and remembers it", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");
    const cache = await loadOcrCache(cachePath);
    const seen: Array<string> = [];

    const result = await readPending([candidate("F1"), candidate("F2")], {
      cache,
      cachePath,
      reader: async (imagePath) => {
        seen.push(path.basename(imagePath));
        return "luettavaa tekstiä";
      },
    });

    expect(result).toEqual({ read: 2, empty: 0, failed: 0, skipped: 0 });
    expect(seen).toEqual(["F1.png", "F2.png"]);
    expect((await loadOcrCache(cachePath)).size).toBe(2);
  });

  it("does not read a picture it already has a reading for", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");
    await appendOcrRecord(cachePath, { id: "F1", text: "jo luettu" });
    const cache = await loadOcrCache(cachePath);
    let calls = 0;

    const result = await readPending([candidate("F1"), candidate("F2")], {
      cache,
      cachePath,
      reader: async () => {
        calls++;
        return "uusi";
      },
    });

    expect(calls).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.read).toBe(1);
  });

  it("remembers a picture with nothing legible, so it is not read again", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");
    const cache = await loadOcrCache(cachePath);

    const first = await readPending([candidate("F1")], {
      cache,
      cachePath,
      reader: async () => "",
    });
    const second = await readPending([candidate("F1")], {
      cache: await loadOcrCache(cachePath),
      cachePath,
      reader: async () => {
        throw new Error("should not be read twice");
      },
    });

    expect(first.empty).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);
  });

  it("does not remember a failure, since the next run may succeed", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");
    const cache = await loadOcrCache(cachePath);

    const result = await readPending([candidate("F1"), candidate("F2")], {
      cache,
      cachePath,
      reader: async (imagePath) => {
        if (imagePath.endsWith("F1.png")) throw new Error("tesseract died");
        return "toinen onnistui";
      },
    });

    expect(result.failed).toBe(1);
    expect(result.read).toBe(1);
    expect((await loadOcrCache(cachePath)).has("F1")).toBe(false);
  });

  it("leaves a picture over the size limit alone", async () => {
    const cachePath = path.join(dir, "ocr.jsonl");
    const cache = await loadOcrCache(cachePath);
    let calls = 0;

    const result = await readPending([candidate("F1", OCR_MAX_BYTES + 1)], {
      cache,
      cachePath,
      reader: async () => {
        calls++;
        return "ei pitäisi";
      },
    });

    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe("withOcr", () => {
  const messages: Array<SearchMessage> = [
    { t: "1.0001", u: "U1", m: "", files: [{ id: "F1" }, { id: "F2" }] },
    { t: "2.0001", u: "U1", m: "ilman liitteitä" },
  ];

  it("attaches a reading to the file it belongs to", () => {
    const [first] = withOcr(messages, new Map([["F1", "tekstiä kuvassa"]]));

    expect(first.files?.[0].ocr).toBe("tekstiä kuvassa");
    expect(first.files?.[1].ocr).toBeUndefined();
  });

  it("leaves a file with an empty reading untouched", () => {
    const [first] = withOcr(messages, new Map([["F1", ""]]));

    expect(first.files?.[0]).toEqual({ id: "F1" });
  });

  it("does not change the messages it was given", () => {
    withOcr(messages, new Map([["F1", "tekstiä kuvassa"]]));

    expect(messages[0].files?.[0]).toEqual({ id: "F1" });
  });
});

describe("indexing a reading", () => {
  const CHANNELS = [
    { id: "CPUB", name: "yleinen", kind: "public" as const },
    { id: "CPRIV", name: "salainen", kind: "private" as const },
    { id: "DDM", name: "olli", kind: "im" as const },
    { id: "GDM", name: "ryhma", kind: "mpim" as const },
    // No kind: the one the gate must not guess about.
    { id: "CUNK", name: "tuntematon" },
  ];

  const picture = (id: string, ocr: string) => ({
    t: `1700000${id.length}00.0001`,
    u: "U1",
    m: "",
    files: [
      {
        id,
        name: `${id}.png`,
        filetype: "png",
        mimetype: "image/png",
        filename: `${id}.png`,
        ocr,
      },
    ],
  });

  const MESSAGES: Record<string, Array<any>> = {
    CPUB: [picture("FPUB", "kokouksen pöytäkirja liitteineen")],
    CPRIV: [picture("FPRIV", "yksityisen kanavan muistio")],
    DDM: [picture("FDM", "kahdenkeskinen kuvakaappaus")],
    GDM: [picture("FGDM", "ryhmäviestin kuvakaappaus")],
    CUNK: [picture("FUNK", "luokittelematon kuvakaappaus")],
  };

  async function build() {
    const dbPath = path.join(dir, "search.db");

    await buildSearchDatabase(dbPath, {
      users: { U1: "alice" },
      channels: CHANNELS,
      loadMessages: async (channelId) => MESSAGES[channelId] || [],
    });

    return openSearchDatabase(dbPath);
  }

  it("finds a message with no text by what its picture says", async () => {
    const db = await build();

    expect(searchDatabase(db, "pöytäkirja").map((result) => result.c)).toEqual([
      "CPUB",
    ]);
    db.close();
  });

  it("finds it in a private channel too", async () => {
    const db = await build();

    expect(searchDatabase(db, "muistio").map((result) => result.c)).toEqual([
      "CPRIV",
    ]);
    db.close();
  });

  it("does not index what a picture in a direct message says", async () => {
    const db = await build();

    expect(searchDatabase(db, "kahdenkeskinen")).toEqual([]);
    expect(searchDatabase(db, "ryhmäviestin")).toEqual([]);
    db.close();
  });

  it("does not index it for a channel of unknown kind", async () => {
    const db = await build();

    expect(searchDatabase(db, "luokittelematon")).toEqual([]);
    db.close();
  });

  it("keeps the displayed message as it was written", async () => {
    const db = await build();
    const rows = db.all(
      "SELECT message FROM messages WHERE channel_id = 'CPUB'",
    ) as Array<{ message: string }>;

    expect(rows.map((r) => r.message)).toEqual([""]);
    db.close();
  });
});
