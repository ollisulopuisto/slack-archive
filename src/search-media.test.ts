import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { buildSearchDatabase, openSearchDatabase } from "./search-db.js";
import { buildSearchSql } from "./search-sql.js";

const CHANNELS = [{ id: "C1", name: "yleinen", kind: "public" as const }];

const png = (id: string, extra: Record<string, string> = {}) => ({
  id,
  name: `${id}.png`,
  title: "",
  filetype: "png",
  mimetype: "image/png",
  filename: `${id}.png`,
  ...extra,
});

const MESSAGES = [
  // Text only.
  { t: "1700000001.0001", u: "U1", m: "kokous huomenna" },
  // A caption and a picture.
  {
    t: "1700000002.0001",
    u: "U1",
    m: "kokous: tässä kalvot",
    files: [png("F_SLIDES", { title: "Kalvot" })],
  },
  // No caption; the words are in the picture.
  {
    t: "1700000003.0001",
    u: "U2",
    m: "",
    files: [png("F_SHOT", { ocr: "kokouksen pöytäkirja liitteineen" })],
  },
  // Three pictures in one message.
  {
    t: "1700000004.0001",
    u: "U1",
    m: "kokous kuvina",
    files: [png("F_A"), png("F_B"), png("F_C")],
  },
  // Mentions a file Slack withheld: no filename, so nothing to show.
  {
    t: "1700000005.0001",
    u: "U1",
    m: "kokous piilotettu",
    files: [{ id: "F_HIDDEN", name: "piilo.png", mimetype: "image/png" }],
  },
  // A PDF, which is a saved file but not a picture.
  {
    t: "1700000006.0001",
    u: "U1",
    m: "kokous pdf",
    files: [
      {
        id: "F_PDF",
        name: "esitys.pdf",
        title: "Esitys",
        filetype: "pdf",
        mimetype: "application/pdf",
        filename: "F_PDF.pdf",
      },
    ],
  },
];

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-media-"));
  dbPath = path.join(dir, "search.db");

  await buildSearchDatabase(dbPath, {
    users: { U1: "alice", U2: "bob" },
    channels: CHANNELS,
    loadMessages: async () => MESSAGES,
  });
});

afterAll(() => {
  fs.removeSync(dir);
});

function run(request: Parameters<typeof buildSearchSql>[0]) {
  const built = buildSearchSql(request)!;
  const db = openSearchDatabase(dbPath);

  try {
    return db.all(built.sql, built.params) as Array<Record<string, any>>;
  } finally {
    db.close();
  }
}

const times = (rows: Array<Record<string, any>>) => rows.map((r) => r.t).sort();

describe("searching with the media toggle on", () => {
  it("returns only messages with a saved file", () => {
    const rows = run({ query: "kokous", media: true });

    expect(times(rows)).toEqual([
      "1700000002.0001",
      "1700000004.0001",
      "1700000006.0001",
    ]);
  });

  it("returns every match when the toggle is off", () => {
    // Five, not six: the screenshot says "kokouksen", which "kokous" is not a
    // prefix of.
    expect(run({ query: "kokous" })).toHaveLength(5);
  });

  it("finds a picture by what it says, with no caption", () => {
    const rows = run({ query: "pöytäkirja", media: true });

    expect(rows).toHaveLength(1);
    expect(rows[0].file_name).toBe("F_SHOT.png");
    expect(rows[0].m_text).toBe("");
  });

  it("shows the message as written, not the text read from its picture", () => {
    const [row] = run({ query: "pöytäkirja", media: true });
    const [ordinary] = run({ query: "pöytäkirja" });

    expect(row.m_text).toBe("");
    expect(ordinary.m_text).toBe("");
  });

  it("does not find a hidden file, which has nothing to show", () => {
    const rows = run({ query: "piilotettu", media: true });

    expect(rows).toEqual([]);
  });

  it("describes the first file and counts the rest, in one row", () => {
    const rows = run({ query: "kuvina", media: true });

    expect(rows).toHaveLength(1);
    expect(rows[0].file_name).toBe("F_A.png");
    expect(rows[0].file_count).toBe(3);
    expect(rows[0].file_is_image).toBe(1);
  });

  it("labels a file by its title, else its name", () => {
    const [slides] = run({ query: "kalvot", media: true });
    const [shot] = run({ query: "pöytäkirja", media: true });

    expect(slides.file_label).toBe("Kalvot");
    expect(shot.file_label).toBe("F_SHOT.png");
  });

  it("marks a PDF as a file rather than a picture", () => {
    const [pdf] = run({ query: "pdf", media: true });

    expect(pdf.file_is_image).toBe(0);
    expect(pdf.file_label).toBe("Esitys");
  });

  it("lists media newest first when there is no text", () => {
    const rows = run({ query: "", media: true });

    expect(rows.map((r) => r.t)).toEqual([
      "1700000006.0001",
      "1700000004.0001",
      "1700000003.0001",
      "1700000002.0001",
    ]);
  });

  it("combines with the other filters", () => {
    const rows = run({ query: "", media: true, user: "U2" });

    expect(times(rows)).toEqual(["1700000003.0001"]);
  });

  it("works against the recent index as well", () => {
    const rows = run({ query: "kokous", media: true, recent: true });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.file_name)).toBe(true);
  });
});
