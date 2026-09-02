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
import { buildSearchSql } from "./search-sql.js";

const CHANNELS = [
  { id: "C1", name: "general", kind: "public" as const, isArchived: false },
  { id: "C2", name: "random", kind: "public" as const, isArchived: true },
  { id: "C3", name: "salainen", kind: "private" as const, isArchived: false },
  { id: "D1", name: "olli", kind: "im" as const, isArchived: false },
  {
    id: "C1_FILES",
    name: "kuvakanava",
    kind: "public" as const,
    isArchived: false,
  },
  {
    id: "D1_FILES",
    name: "yksityinen",
    kind: "im" as const,
    isArchived: false,
  },
  {
    id: "C1_REACT",
    name: "reaktiot",
    kind: "public" as const,
    isArchived: false,
  },
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

// Reactions, with the reactor ids Slack supplies. Measured across 22 350
// reaction entries in the real archive, `count` never disagreed with
// `users.length`, so the array is authoritative and no count column is stored:
// a count is what you get by counting.
const REACTED = {
  t: "1700000020.0001",
  u: "U1",
  m: "reaktioita keranneet sanat",
  reactions: [
    { name: "cat", users: ["U1", "U2"], count: 2 },
    { name: "joy", users: ["U2"], count: 1 },
  ],
};

// A heavily-reacted message: Slack reports 40 but names only three, which is
// the disagreement the two tables exist to preserve. And an emoji with no user
// list at all, which must not become a zero.
const TRUNCATED = {
  t: "1700000021.0001",
  u: "U2",
  m: "moni reagoi tahan",
  reactions: [
    { name: "tada", users: ["U1", "U2", "U3"], count: 40 },
    { name: "eyes", count: 5 },
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
  reactions?: Array<{ name: string; users?: Array<string>; count?: number }>;
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
  C1_REACT: [REACTED, TRUNCATED],
  D1_FILES: [PRIVATE_FILE],
};

const USERS = { U1: "alice", U2: "bob" };

// Newest page first, each entry the OLDEST timestamp on that page - the shape
// create-html records and search.js has always carried.
const PAGES = {
  C1: ["1700000500.0001", "1700000200.0001", "1700000000.0001"],
};

let dir: string;
let dbPath: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-db-"));
  dbPath = path.join(dir, "search.db");

  await buildSearchDatabase(dbPath, {
    users: USERS,
    channels: CHANNELS,
    loadMessages: async (channelId) => MESSAGES[channelId] || [],
    pages: PAGES,
  });
});

afterAll(() => {
  fs.removeSync(dir);
});

describe("buildSearchDatabase", () => {
  it("writes a database file that needs no native module", () => {
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("does not store a user who never appears in the indexed channels", async () => {
    // The published search.db used to hold every workspace member, so the
    // user dropdown named people who only ever DMed.
    const ghostPath = path.join(dir, "ghost.db");

    await buildSearchDatabase(ghostPath, {
      users: { ...USERS, U_DM: "secret" },
      names: {
        U_DM: [
          {
            nick: "only-in-dms",
            first: "2016-01-01T00:00:00.000Z",
            last: "2016-01-02T00:00:00.000Z",
            sources: ["mention"],
          },
        ],
      },
      channels: CHANNELS,
      loadMessages: async (channelId) => MESSAGES[channelId] || [],
      pages: PAGES,
    });

    const db = openSearchDatabase(ghostPath);
    const users = db.all("SELECT id FROM users") as Array<{ id: string }>;
    const nicks = db.all("SELECT user_id FROM user_names") as Array<{
      user_id: string;
    }>;

    expect(users.map((row) => row.id)).not.toContain("U_DM");
    expect(nicks.map((row) => row.user_id)).not.toContain("U_DM");
    db.close();
    fs.removeSync(ghostPath);
  });

  it("indexes every message", () => {
    const db = openSearchDatabase(dbPath);
    expect(countMessages(db)).toBe(8);
    db.close();
  });

  it("replaces an existing database instead of appending to it", async () => {
    await buildSearchDatabase(dbPath, {
      users: USERS,
      channels: CHANNELS,
      loadMessages: async (channelId) => MESSAGES[channelId] || [],
      pages: PAGES,
    });

    const db = openSearchDatabase(dbPath);
    expect(countMessages(db)).toBe(8);
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
    const rows = db.all(
      "SELECT id, is_archived FROM channels",
    ) as unknown as Array<{ id: string; is_archived: number | null }>;
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
    const row = db.get(
      "SELECT message_id, channel_id FROM files WHERE id = 'F_CAT'",
    ) as any;

    expect(row.message_id).toBe("C1_FILES-1700000010.0001");
    expect(row.channel_id).toBe("C1_FILES");
    db.close();
  });

  // The central case: searching the filename finds a message with no text.
  it("finds a caption-less message by its filename", () => {
    const db = openSearchDatabase(dbPath);
    const results = searchDatabase(db, "kissa-katolla");

    // Asserts that the message is FOUND, not that it ranks first. Rank shifts
    // whenever anyone adds content to the fixtures, and this test is about
    // whether a filename reaches the index at all - not about ordering.
    expect(results.map((result) => result.c)).toContain("C1_FILES");
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
      const channel = db.get("SELECT kind FROM channels WHERE id = ?", [
        hit.c,
      ]) as any;
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
    const row = db.get(
      "SELECT is_image FROM files WHERE id = 'F_NOEXT'",
    ) as any;
    expect(row.is_image).toBe(1);
    db.close();
  });
});

// Reactions are the richest thing the archive holds that the index did not.
// One row per (message, emoji, reactor), because that single shape answers
// every question anyone asks of them: what was reacted to most, who gets the
// most, who gives the most, and which emoji belongs to whom.
describe("reactions", () => {
  it("records the total Slack reported, per emoji", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT name, count FROM reactions WHERE message_id = ? ORDER BY name",
      ["C1_REACT-1700000020.0001"],
    ) as unknown as Array<{ name: string; count: number }>;

    expect(rows).toEqual([
      { name: "cat", count: 2 },
      { name: "joy", count: 1 },
    ]);
    db.close();
  });

  it("records who reacted, one row each", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT name, user_id FROM reaction_users WHERE message_id = ? ORDER BY name, user_id",
      ["C1_REACT-1700000020.0001"],
    ) as unknown as Array<{ name: string; user_id: string }>;

    expect(rows).toEqual([
      { name: "cat", user_id: "U1" },
      { name: "cat", user_id: "U2" },
      { name: "joy", user_id: "U2" },
    ]);
    db.close();
  });

  it("records which channel the reaction happened in", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT DISTINCT channel_id FROM reactions WHERE message_id = ?",
      ["C1_REACT-1700000020.0001"],
    ) as { channel_id: string };

    expect(row.channel_id).toBe("C1_REACT");
    db.close();
  });

  // The reason the total is stored rather than counted. Slack truncates the
  // user list on heavily-reacted messages and keeps the count honest, so the
  // two disagree in one direction only: attribution undercounts. Counting rows
  // would understate precisely the messages worth asking about.
  it("keeps the total when Slack names fewer people than it counted", () => {
    const db = openSearchDatabase(dbPath);

    const total = db.get(
      "SELECT count FROM reactions WHERE message_id = ? AND name = 'tada'",
      ["C1_REACT-1700000021.0001"],
    ) as { count: number };
    const named = db.get(
      "SELECT COUNT(*) AS n FROM reaction_users WHERE message_id = ? AND name = 'tada'",
      ["C1_REACT-1700000021.0001"],
    ) as { n: number };

    expect(Number(total.count)).toBe(40);
    expect(Number(named.n)).toBe(3);
    db.close();
  });

  it("can attribute reactions to the person who gave them", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT user_id, COUNT(*) AS n FROM reaction_users GROUP BY user_id ORDER BY n DESC, user_id",
    ) as unknown as Array<{ user_id: string; n: number }>;

    expect(rows[0].user_id).toBe("U2");
    db.close();
  });

  it("survives a reaction with no user list at all", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT count FROM reactions WHERE message_id = ? AND name = 'eyes'",
      ["C1_REACT-1700000021.0001"],
    ) as { count: number };

    expect(Number(row.count)).toBe(5);
    db.close();
  });

  it("leaves messages without reactions alone", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT COUNT(*) AS n FROM reactions WHERE message_id = ?",
      ["C1-1700000000.0001"],
    ) as { n: number };

    expect(Number(row.n)).toBe(0);
    db.close();
  });
});

// A search result is only useful if you can go and read it in context. The
// link needs a page number, and the page index has always lived in search.js
// - a 110 MB file the bot has no business parsing to answer one question.
describe("page index", () => {
  it("stores each page's oldest timestamp", () => {
    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT page, oldest_ts FROM pages WHERE channel_id = 'C1' ORDER BY page",
    ) as unknown as Array<{ page: number; oldest_ts: string }>;

    expect(rows).toEqual([
      { page: 0, oldest_ts: "1700000500.0001" },
      { page: 1, oldest_ts: "1700000200.0001" },
      { page: 2, oldest_ts: "1700000000.0001" },
    ]);
    db.close();
  });

  // Pages run newest first, so page 0 holds the highest timestamps. Finding a
  // message's page is the first page whose oldest entry is at or below it.
  it("resolves a timestamp to the page that contains it", () => {
    const db = openSearchDatabase(dbPath);

    const pageOf = (ts: string) => {
      const row = db.get(
        `SELECT page FROM pages
         WHERE channel_id = 'C1' AND CAST(oldest_ts AS REAL) <= CAST(? AS REAL)
         ORDER BY page ASC LIMIT 1`,
        [ts],
      ) as { page: number } | null;
      return row ? row.page : null;
    };

    expect(pageOf("1700000900.0001")).toBe(0); // newer than page 0's oldest
    expect(pageOf("1700000500.0001")).toBe(0); // exactly page 0's oldest
    expect(pageOf("1700000300.0001")).toBe(1);
    expect(pageOf("1700000000.0001")).toBe(2);
    db.close();
  });

  // Older than anything recorded means the index cannot say, and the caller
  // has to know that rather than be handed page 0.
  it("resolves to nothing when the timestamp predates every page", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      `SELECT page FROM pages
       WHERE channel_id = 'C1' AND CAST(oldest_ts AS REAL) <= CAST(? AS REAL)
       ORDER BY page ASC LIMIT 1`,
      ["1600000000.0001"],
    );
    expect(row).toBeNull();
    db.close();
  });

  it("keeps channels apart", () => {
    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT COUNT(*) AS n FROM pages WHERE channel_id = 'C2'",
    ) as { n: number };
    expect(Number(row.n)).toBe(0);
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

  it("executes search query sorted by newest first", () => {
    const db = openSearchDatabase(dbPath);
    const query = buildSearchSql({ query: "arkisto", sort: "newest" })!;
    const rows = db.all(query.sql, query.params) as Array<{ t: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].t).toBe("1700000002.0001");
    expect(rows[1].t).toBe("1700000000.0001");
    db.close();
  });

  it("executes search query sorted by oldest first", () => {
    const db = openSearchDatabase(dbPath);
    const query = buildSearchSql({ query: "arkisto", sort: "oldest" })!;
    const rows = db.all(query.sql, query.params) as Array<{ t: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].t).toBe("1700000000.0001");
    expect(rows[1].t).toBe("1700000002.0001");
    db.close();
  });
});

describe("user_names", () => {
  const NAMES = {
    U1: [
      {
        nick: "dst",
        first: "2016-10-06T00:00:00.000Z",
        last: "2016-11-22T00:00:00.000Z",
        sources: ["mention"],
      },
      {
        nick: "beerhana",
        first: "2023-04-19T00:00:00.000Z",
        last: "2025-08-07T00:00:00.000Z",
        sources: ["attachment", "html"],
      },
    ],
  };

  it("stores every name a person has gone by", async () => {
    const dbPath = path.join(dir, "names.db");
    await buildSearchDatabase(dbPath, {
      users: { U1: "bentsohana" },
      names: NAMES,
      channels: [{ id: "C1", name: "offtopic", kind: "public" }],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
    });

    const db = openSearchDatabase(dbPath);
    const rows = db.all(
      "SELECT nick, first, last, sources FROM user_names WHERE user_id = 'U1' ORDER BY first",
    ) as unknown as Array<{
      nick: string;
      first: string;
      last: string;
      sources: string;
    }>;
    db.close();

    expect(rows.map((r) => r.nick)).toEqual(["dst", "beerhana"]);
    expect(rows[1].sources).toBe("attachment,html");
    expect(rows[1].first).toBe("2023-04-19T00:00:00.000Z");
  });

  it("is empty rather than absent when no history exists", async () => {
    const dbPath = path.join(dir, "no-names.db");
    await buildSearchDatabase(dbPath, {
      users: { U1: "bentsohana" },
      channels: [{ id: "C1", name: "offtopic", kind: "public" }],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
    });

    const db = openSearchDatabase(dbPath);
    const row = db.get("SELECT COUNT(*) AS count FROM user_names") as any;
    db.close();

    expect(Number(row.count)).toBe(0);
  });
});

describe("statuses and membership", () => {
  it("stores what a status said and when it was seen", async () => {
    const dbPath = path.join(dir, "statuses.db");
    await buildSearchDatabase(dbPath, {
      users: { U1: "olli" },
      statuses: {
        U1: [
          {
            text: "kaljalla",
            emoji: ":beer:",
            first: "2026-08-26T08:00:00.000Z",
            last: "2026-08-27T08:00:00.000Z",
          },
        ],
      },
      channels: [{ id: "C1", name: "offtopic", kind: "public" }],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
    });

    const db = openSearchDatabase(dbPath);
    const row = db.get(
      "SELECT text, emoji, first, last FROM user_statuses WHERE user_id = 'U1'",
    ) as any;
    db.close();

    expect(row.text).toBe("kaljalla");
    expect(row.emoji).toBe(":beer:");
    expect(row.last).toBe("2026-08-27T08:00:00.000Z");
  });

  // The question per-conversation access has to answer, and the one an archive
  // cannot answer about the past: who was in this channel?
  it("stores who was in a channel", async () => {
    const dbPath = path.join(dir, "members.db");
    await buildSearchDatabase(dbPath, {
      users: { U1: "olli", U2: "aisa" },
      channels: [
        { id: "C1", name: "offtopic", kind: "public", members: ["U1", "U2"] },
        { id: "C2", name: "salahommat", kind: "private", members: ["U1"] },
      ],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
    });

    const db = openSearchDatabase(dbPath);
    const inPrivate = db.all(
      "SELECT user_id FROM channel_members WHERE channel_id = 'C2'",
    ) as unknown as Array<{ user_id: string }>;
    const count = db.get("SELECT COUNT(*) AS n FROM channel_members") as any;
    db.close();

    expect(inPrivate.map((r) => r.user_id)).toEqual(["U1"]);
    expect(Number(count.n)).toBe(3);
  });

  it("leaves the tables empty rather than absent when nothing was recorded", async () => {
    const dbPath = path.join(dir, "no-extras.db");
    await buildSearchDatabase(dbPath, {
      users: { U1: "olli" },
      channels: [{ id: "C1", name: "offtopic", kind: "public" }],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
    });

    const db = openSearchDatabase(dbPath);
    const s = db.get("SELECT COUNT(*) AS n FROM user_statuses") as any;
    const m = db.get("SELECT COUNT(*) AS n FROM channel_members") as any;
    db.close();

    expect(Number(s.n)).toBe(0);
    expect(Number(m.n)).toBe(0);
  });
});

describe("what kind of name and status", () => {
  it("keeps handles, display names and real names apart in the database", async () => {
    const file = path.join(dir, "kinds.db");

    await buildSearchDatabase(file, {
      users: { U1: "infosota" },
      channels: [{ id: "C1", name: "general", kind: "public" }],
      loadMessages: async () => [{ t: "1.0", u: "U1", m: "moi" }],
      names: {
        U1: [
          {
            nick: "tsippadai",
            first: "2026-01-01T00:00:00.000Z",
            last: "2026-08-01T00:00:00.000Z",
            sources: ["profile"],
            kinds: ["display"],
          },
          {
            nick: "Jimmie Åkesson",
            first: "2026-08-01T00:00:00.000Z",
            last: "2026-08-01T00:00:00.000Z",
            sources: ["profile"],
            kinds: ["real"],
          },
        ],
      },
      statuses: {
        U1: [
          {
            text: "kaljalla",
            emoji: ":beer:",
            kind: "status",
            first: "2026-01-01T00:00:00.000Z",
            last: "2026-01-02T00:00:00.000Z",
          },
          {
            text: "value creator",
            emoji: "",
            kind: "title",
            first: "2026-01-01T00:00:00.000Z",
            last: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
    });

    const db = openSearchDatabase(file);

    expect(db.all("SELECT nick, kinds FROM user_names ORDER BY nick")).toEqual([
      { nick: "Jimmie Åkesson", kinds: "real" },
      { nick: "tsippadai", kinds: "display" },
    ]);

    expect(
      db.all("SELECT text, kind FROM user_statuses ORDER BY text"),
    ).toEqual([
      { text: "kaljalla", kind: "status" },
      { text: "value creator", kind: "title" },
    ]);

    db.close();
  });
});

// The browser reads this file over HTTP range requests now, a few pages at a
// time, so the shape of the file is part of its interface.
describe("what makes the database readable over the network", () => {
  it("is written in small pages", () => {
    // A range request fetches whole pages. At the 4096-byte default, every
    // read drags in four times the data it needs; 1024 is what sql.js-httpvfs
    // asks for and what keeps a phone's search to a few hundred kilobytes.
    const db = openSearchDatabase(dbPath);

    expect(db.all("pragma page_size")).toEqual([{ page_size: 1024 }]);
    db.close();
  });

  it("can find one person's messages without reading the whole table", () => {
    // Without these, "everything alice said" is a full scan - a second locally
    // and a download of the entire corpus over range requests, which is the
    // thing this whole change exists to stop.
    const db = openSearchDatabase(dbPath);
    const plan = db.all(
      "explain query plan select * from messages where user_id = ? order by timestamp desc",
      ["U1"],
    ) as Array<{ detail: string }>;

    expect(plan.map((row) => row.detail).join(" ")).toMatch(/using index/i);
    db.close();
  });

  it("can find one channel's messages the same way", () => {
    const db = openSearchDatabase(dbPath);
    const plan = db.all(
      "explain query plan select * from messages where channel_id = ? order by timestamp desc",
      ["C1"],
    ) as Array<{ detail: string }>;

    expect(plan.map((row) => row.detail).join(" ")).toMatch(/using index/i);
    db.close();
  });
});

describe("searching by date alone", () => {
  it("uses an index rather than reading every message", () => {
    // "What was said that week", with no channel and nobody named. Without an
    // index on the timestamp this walks the whole table - which over HTTP
    // range requests means downloading the archive to answer one question.
    const db = openSearchDatabase(dbPath);
    const plan = db.all(
      `explain query plan select * from messages
        where timestamp >= ? and timestamp < ? order by timestamp desc`,
      ["1700000000", "1700000600"],
    ) as Array<{ detail: string }>;

    expect(plan.map((row) => row.detail).join(" ")).toMatch(/using index/i);
    db.close();
  });
});
