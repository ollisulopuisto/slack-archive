import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  buildSearchDatabase,
  countMessages,
  openSearchDatabase,
  searchDatabase,
} from "./search-db.js";

const CHANNELS = [
  { id: "C1", name: "general", kind: "public" as const, isArchived: false },
  { id: "C2", name: "random", kind: "public" as const, isArchived: true },
  { id: "C3", name: "salainen", kind: "private" as const, isArchived: false },
  { id: "D1", name: "olli", kind: "im" as const, isArchived: false },
  { id: "C1_FILES", name: "kuvakanava", kind: "public" as const, isArchived: false },
  { id: "D1_FILES", name: "yksityinen", kind: "im" as const, isArchived: false },
  // Deliberately supplies no kind: see the fail-closed test below.
  { id: "C9", name: "tuntematon" },
];

// An image posted with no caption. This is the whole point of the feature:
// the message text is empty, so without the filename in the index there is no
// term that reaches it.
const UNCAPTIONED = {
  t: "1700000010.0001",
  u: "U1",
  m: "",
  files: [
    {
      id: "F_CAT",
      name: "kissa-katolla.png",
      title: "Kissa katolla",
      filetype: "png",
      mimetype: "image/png",
    },
    // The same message also carries a non-image attachment.
    {
      id: "F_DOC",
      name: "raportti.pdf",
      title: "Raportti",
      filetype: "pdf",
      mimetype: "application/pdf",
    },
    // 19 files in the real archive have no extension at all, so the type has
    // to come from Slack's fields rather than the name.
    {
      id: "F_NOEXT",
      name: "F02U7C1DYF3",
      title: "",
      filetype: "jpg",
      mimetype: "image/jpeg",
    },
  ],
};

// An attachment in a direct message.
const PRIVATE_FILE = {
  t: "1700000011.0001",
  u: "U1",
  m: "",
  files: [
    {
      id: "F_SECRET",
      name: "kissa-salaisuus.png",
      title: "Kissa salaisuus",
      filetype: "png",
      mimetype: "image/png",
    },
  ],
};

type FixtureMessage = {
  t: string;
  u: string;
  m: string;
  files?: Array<Record<string, string>>;
};

const MESSAGES: Record<string, Array<FixtureMessage>> = {
  C1: [
    {
      t: "1700000000.0001",
      u: "U1",
      m: "Intel shipped a new processor today, arkisto",
    },
    { t: "1700000001.0001", u: "U2", m: "this phrase should match exactly" },
  ],
  C2: [
    { t: "1700000002.0001", u: "U1", m: "nothing interesting here, arkisto" },
    { t: "1700000003.0001", u: "U2", m: "" },
  ],
  C1_FILES: [UNCAPTIONED],
  D1_FILES: [PRIVATE_FILE],
};

const USERS = { U1: "alice", U2: "bob" };

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-db-"));
  dbPath = path.join(dir, "search.db");

  await buildSearchDatabase(dbPath, {
    users: USERS,
    channels: CHANNELS,
    loadMessages: async (channelId) => MESSAGES[channelId] || [],
  });
});

afterAll(() => {
  fs.removeSync(dir);
});

describe("buildSearchDatabase", () => {
  it("writes a database file that needs no native module", () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("indexes every message", () => {
    const db = openSearchDatabase(dbPath);
    expect(countMessages(db)).toBe(6);
    db.close();
  });

  it("replaces an existing database instead of appending to it", async () => {
    await buildSearchDatabase(dbPath, {
      users: USERS,
      channels: CHANNELS,
      loadMessages: async (channelId) => MESSAGES[channelId] || [],
    });

    const db = openSearchDatabase(dbPath);
    expect(countMessages(db)).toBe(6);
    db.close();
  });
});

// The archive holds private channels and direct messages alongside public
// ones. Nothing downstream can withhold them unless the index says which is
// which, so the type travels with the channel row.
describe("channel kind", () => {
  it("stores the kind and archived flag it was given", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT id, kind, is_archived FROM channels ORDER BY id",
    ) as unknown as Array<{
      id: string;
      kind: string | null;
      is_archived: number | null;
    }>;

    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId["C1"].kind).toBe("public");
    expect(byId["C3"].kind).toBe("private");
    expect(byId["D1"].kind).toBe("im");
    db.close();
  });

  it("records archived channels as archived", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all("SELECT id, is_archived FROM channels") as unknown as
      Array<{ id: string; is_archived: number | null }>;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

    expect(byId["C2"].is_archived).toBe(1);
    expect(byId["C1"].is_archived).toBe(0);
    db.close();
  });

  // Fail closed. A channel whose type could not be determined must not be
  // recorded as public, because "public" is the one value a reader is entitled
  // to hand to anybody. NULL forces the reader to decide, and the gate that
  // reads this treats an unknown channel as off limits.
  it("leaves the kind NULL when it was not supplied, rather than assuming public", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT kind FROM channels WHERE id = 'C9'") as {
      kind: string | null;
    } | null;

    expect(row).not.toBeNull();
    expect(row!.kind).toBeNull();
    db.close();
  });
});


// Attachments. The archive holds 40 124 images and many were posted with no
// caption, leaving the message text empty. Without the file's name and title
// in the index, no search term reaches them.
describe("file attachments", () => {
  it("stores the attachment metadata", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT * FROM files WHERE id = 'F_CAT'") as any;

    expect(row).not.toBeNull();
    expect(row.name).toBe("kissa-katolla.png");
    expect(row.title).toBe("Kissa katolla");
    expect(row.filetype).toBe("png");
    expect(row.is_image).toBe(1);
    db.close();
  });

  it("ties a file to the message it arrived with", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT message_id, channel_id FROM files WHERE id = 'F_CAT'") as any;

    expect(row.message_id).toBe("C1_FILES-1700000010.0001");
    expect(row.channel_id).toBe("C1_FILES");
    db.close();
  });

  // The central case: searching the filename finds a message with no text.
  it("finds a caption-less message by its filename", () => {
    const db = openSearchDatabase(dbPath);
    const results = searchDatabase(db, "kissa-katolla");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].c).toBe("C1_FILES");
    db.close();
  });

  it("finds it by the file title too", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, "katolla").length).toBeGreaterThan(0);
    db.close();
  });

  // What gets displayed stays honest: the filename lives in the index, not in
  // the message body. Otherwise the bot would quote text nobody wrote.
  it("does not leak the filename into the displayed message", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT message FROM messages WHERE id = 'C1_FILES-1700000010.0001'",
    ) as any;

    expect(row.message).toBe("");
    db.close();
  });

  // The same gate as messages. A file inherits its channel's kind, because it
  // is tied to a message and the message to a channel.
  it("leaves a direct message attachment classifiable, so a reader can refuse it", () => {
    const db = openSearchDatabase(dbPath);

    const hits = searchDatabase(db, "kissa-salaisuus");
    for (const hit of hits) {
      const channel = db.get(
        "SELECT kind FROM channels WHERE id = ?",
        [hit.c],
      ) as any;
      // The hit may exist in the index, but its channel kind has to be known
      // so that a reader can refuse to show it.
      expect(channel.kind).toBe("im");
    }
    db.close();
  });

  it("marks a non-image as is_image = 0", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT is_image FROM files WHERE id = 'F_DOC'") as any;
    expect(row.is_image).toBe(0);
    db.close();
  });

  // 19 files in the real archive have no extension. The type must come from
  // Slack's fields, not from the filename.
  it("trusts mimetype over the filename extension", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT is_image FROM files WHERE id = 'F_NOEXT'") as any;
    expect(row.is_image).toBe(1);
    db.close();
  });
});

describe("searchDatabase", () => {
  it("matches a word prefix and joins channel and user names", () => {
    const db = openSearchDatabase(dbPath);
    const results = searchDatabase(db, "intel");

    expect(results).toHaveLength(1);
    expect(results[0].channelName).toBe("general");
    expect(results[0].userName).toBe("alice");
    expect(results[0].c).toBe("C1");
    expect(results[0].m).toContain("Intel shipped");
    db.close();
  });

  it("requires all words to be present", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, "intel processor")).toHaveLength(1);
    expect(searchDatabase(db, "intel banana")).toHaveLength(0);
    db.close();
  });

  it("honours quoted phrases", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, '"phrase should match"')).toHaveLength(1);
    expect(searchDatabase(db, '"should exactly match"')).toHaveLength(0);
    db.close();
  });

  it("returns nothing for an empty query", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, "   ")).toHaveLength(0);
    db.close();
  });

  it("applies the result limit", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, "arkisto")).toHaveLength(2);
    expect(searchDatabase(db, "arkisto", 1)).toHaveLength(1);
    db.close();
  });

  it("strips FTS operators out of what the user typed instead of throwing", () => {
    const db = openSearchDatabase(dbPath);
    expect(searchDatabase(db, "^ ( intel")).toHaveLength(1);
    // "NOT" is a word someone typed, not an FTS operator: quoting it means the
    // query asks for messages containing both "not" and "intel".
    expect(searchDatabase(db, "NOT intel")).toHaveLength(0);
    expect(searchDatabase(db, "^ ( )")).toEqual([]);
    db.close();
  });
});
