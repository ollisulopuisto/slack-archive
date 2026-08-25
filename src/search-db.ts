import fs from "fs-extra";
import path from "path";
// A default import, not `import { Database }`: the package is CommonJS, and
// Node's named-export detection cannot see through its bundled output. The
// named form typechecks and then throws "does not provide an export named
// 'Database'" the moment the compiled ESM in lib/ is actually run.
import sqliteWasm from "node-sqlite3-wasm";

const { Database } = sqliteWasm;

export type SearchDatabase = InstanceType<typeof Database>;

import { filterResultsByPhrases, parseSearchQuery } from "./search-query.js";
import { ChannelKind } from "./interfaces.js";

// The search database is SQLite compiled to WebAssembly, not a native addon.
// It used to be `sqlite3`, which is node-gyp built: every new Node release
// ships an ABI that has no prebuilt binary yet, so `npx github:...` died with
// "Could not locate the bindings file" on any machine ahead of the prebuilds,
// and the container image had to carry python3/make/g++ to compile it. A .wasm
// build has no ABI to match and nothing to compile. It also settles FTS5:
// Node's own `node:sqlite` is built without it on the official binaries, and
// this archive is nothing but full-text search.

export interface SearchDbChannel {
  id: string;
  name: string;
  /**
   * Omit only when the type genuinely could not be determined. It is stored as
   * NULL rather than defaulting, because `public` is the one value a reader is
   * entitled to hand to anybody, and a guess must never land on it.
   */
  kind?: ChannelKind;
  isArchived?: boolean;
}

export interface SearchDbMessage {
  t?: string;
  u?: string;
  m?: string;
}

export interface SearchDbInput {
  /** User id -> display name */
  users: Record<string, string>;
  channels: Array<SearchDbChannel>;
  loadMessages: (channelId: string) => Promise<Array<SearchDbMessage>>;
  /** Called before a channel is indexed, for progress reporting */
  onChannel?: (channel: SearchDbChannel) => void;
}

export interface SearchDbResult {
  /** Timestamp */
  t: string;
  /** User id */
  u: string;
  /** Message text */
  m: string;
  /** Channel id */
  c: string;
  channelName: string | null;
  userName: string | null;
}

const SEARCH_SQL = `SELECT
  m.timestamp AS t,
  m.user_id AS u,
  m.message AS m,
  m.channel_id AS c,
  c_tbl.name AS channelName,
  u_tbl.name AS userName
FROM messages m
JOIN messages_fts fts ON m.id = fts.id
LEFT JOIN channels c_tbl ON m.channel_id = c_tbl.id
LEFT JOIN users u_tbl ON m.user_id = u_tbl.id
WHERE messages_fts MATCH ?
ORDER BY rank
LIMIT ?`;

export function openSearchDatabase(dbPath: string): SearchDatabase {
  return new Database(dbPath);
}

export function countMessages(db: SearchDatabase): number {
  const row = db.get("SELECT COUNT(*) AS count FROM messages") as {
    count: number;
  } | null;

  return row ? Number(row.count) : 0;
}

export async function buildSearchDatabase(
  dbPath: string,
  { users, channels, loadMessages, onChannel }: SearchDbInput,
): Promise<void> {
  // Start fresh rather than update in place: the archive is rebuilt wholesale,
  // and a fresh file cannot inherit rows for messages that have since gone.
  await fs.ensureDir(path.dirname(dbPath));
  await fs.remove(dbPath);

  const db = openSearchDatabase(dbPath);

  try {
    // kind and is_archived exist so a reader can withhold what it should not
    // show. The archive holds private channels and direct messages next to
    // public ones, and without the type in the row there is no way to tell
    // them apart at query time. Both are nullable: an unknown channel is a
    // reader's problem to refuse, not the writer's to guess at.
    db.exec(`CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT,
      kind TEXT,
      is_archived INTEGER
    )`);
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)");
    db.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      user_id TEXT,
      timestamp TEXT,
      message TEXT
    )`);
    db.exec(
      "CREATE VIRTUAL TABLE messages_fts USING fts5(id UNINDEXED, message)",
    );

    db.exec("BEGIN TRANSACTION");

    const userStmt = db.prepare(
      "INSERT OR REPLACE INTO users (id, name) VALUES (?, ?)",
    );
    for (const [userId, name] of Object.entries(users)) {
      userStmt.run([userId, name]);
    }
    userStmt.finalize();

    const channelStmt = db.prepare(
      "INSERT OR REPLACE INTO channels (id, name, kind, is_archived) VALUES (?, ?, ?, ?)",
    );
    const msgStmt = db.prepare(
      "INSERT OR REPLACE INTO messages (id, channel_id, user_id, timestamp, message) VALUES (?, ?, ?, ?, ?)",
    );
    const ftsStmt = db.prepare(
      "INSERT OR REPLACE INTO messages_fts (id, message) VALUES (?, ?)",
    );

    for (const channel of channels) {
      if (!channel.id) continue;

      onChannel?.(channel);
      channelStmt.run([
        channel.id,
        channel.name,
        channel.kind ?? null,
        channel.isArchived === undefined ? null : channel.isArchived ? 1 : 0,
      ]);

      const messages = await loadMessages(channel.id);

      for (const message of messages) {
        if (!message.t) continue;

        const id = `${channel.id}-${message.t}`;
        const text = message.m || "";

        msgStmt.run([id, channel.id, message.u ?? null, message.t, text]);
        ftsStmt.run([id, text]);
      }
    }

    channelStmt.finalize();
    msgStmt.finalize();
    ftsStmt.finalize();

    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

export function searchDatabase(
  db: SearchDatabase,
  query: string,
  limit: number = 100,
): Array<SearchDbResult> {
  const { cleanQuery, phrases } = parseSearchQuery(query);

  const ftsQuery = cleanQuery
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((word) => word.length > 0)
    .map((word) => `"${word}"*`)
    .join(" AND ");

  if (!ftsQuery) return [];

  let rows: Array<SearchDbResult> = [];

  try {
    rows = db.all(SEARCH_SQL, [
      ftsQuery,
      limit,
    ]) as unknown as Array<SearchDbResult>;
  } catch (error) {
    console.error("Database search error:", error);
    return [];
  }

  // Quoted phrases are checked on the stored text, not by FTS: the index is
  // tokenized, so it cannot tell "new processor" from "processor new".
  return filterResultsByPhrases(rows, phrases);
}
