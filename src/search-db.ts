import fs from "fs-extra";
import path from "path";

import { UserNames } from "./user-names.js";
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

export interface SearchDbFile {
  id?: string;
  name?: string;
  title?: string;
  filetype?: string;
  mimetype?: string;
}

export interface SearchDbReaction {
  name?: string;
  /** How many reacted, per Slack. Authoritative even when `users` is short. */
  count?: number;
  /** Who reacted, as far as Slack said. May be shorter than `count`. */
  users?: Array<string>;
}

export interface SearchDbMessage {
  t?: string;
  u?: string;
  m?: string;
  /** Parent timestamp, on thread replies. See SearchMessage.p. */
  p?: string;
  files?: Array<SearchDbFile>;
  reactions?: Array<SearchDbReaction>;
}

/**
 * Image types Slack can display and that are worth previewing.
 *
 * The type comes from Slack's `mimetype`/`filetype` fields, never from the
 * filename. The filename cannot be trusted here for two reasons, both present
 * in the real archive: some files have no extension at all, because
 * download-files.ts takes the extension from the download URL and some URLs
 * carry none; and a PDF appears twice under one file id, once as `.pdf` and
 * once as the `.png` that the same code saves from Slack's `thumb_pdf`.
 *
 * Counted across all 74 channels and 1 084 375 messages:
 *
 *     attachments        42 422   (41 228 unique ids)
 *     image by mimetype  40 588
 *     image by filetype       0
 *     neither field         676
 *
 * So the fallback below currently never fires - every real image is caught by
 * mimetype. It stays because Slack's payload shape is not ours to depend on,
 * but if it ever starts matching something, that is news rather than routine.
 *
 * The 676 with neither field are not files. They are `hidden_by_limit` (624,
 * withheld by the free-plan retention limit), `tombstone` (51, deleted) and
 * one `file_not_found`. None of them carries a name either, so none is
 * findable by name and none has anything to preview: is_image = 0 is the
 * right answer for every one, not a gap where a picture fell through.
 */
const IMAGE_FILETYPES = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic"]);

function isImageFile(file: SearchDbFile): boolean {
  if (file.mimetype && file.mimetype.startsWith("image/")) return true;
  return IMAGE_FILETYPES.has((file.filetype || "").toLowerCase());
}

/**
 * What goes into the full-text index: the message text, plus the names and
 * titles of anything attached to it.
 *
 * The archive holds 40 124 images and a great many were posted with no
 * caption. Such a message has an empty `message`, so no search term reaches
 * it - the filename is the only thing anybody could remember about it.
 *
 * This text goes into the INDEX only. `messages.message` keeps what was
 * actually written, because the bot echoes that back, and echoing a filename
 * as though someone had typed it would be a small lie in every result.
 */
function indexableText(message: SearchDbMessage): string {
  const parts = [message.m || ""];

  for (const file of message.files || []) {
    if (file.name) parts.push(file.name);
    if (file.title) parts.push(file.title);
  }

  return parts.filter((part) => part.length > 0).join(" ");
}

export interface SearchDbInput {
  /**
   * Channel id -> each page's OLDEST timestamp, newest page first.
   *
   * The shape create-html records and search.js has always carried. It is here
   * so a reader can turn a message into a link without parsing a 110 MB
   * JavaScript file to answer one question.
   */
  pages?: Record<string, Array<string>>;
  /** User id -> display name */
  users: Record<string, string>;
  /** User id -> every name they have gone by, oldest first */
  names?: UserNames;
  channels: Array<SearchDbChannel>;
  loadMessages: (channelId: string) => Promise<Array<SearchDbMessage>>;
  /** Called before a channel is indexed, for progress reporting */
  onChannel?: (channel: SearchDbChannel) => void;
}

export interface SearchDbResult {
  /** Timestamp */
  t: string;
  /** Parent timestamp on a thread reply, so a caller can link it. */
  p: string | null;
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
  m.parent_timestamp AS p,
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
  { users, names, channels, loadMessages, onChannel, pages }: SearchDbInput,
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

    // Every name a person has gone by, one row each. Not a column on `users`:
    // somebody here has had 33, and the question "who was John Stuart Bill in
    // 2021" is a lookup, not a string somebody has to split.
    db.exec(`CREATE TABLE user_names (
      user_id TEXT,
      nick    TEXT,
      first   TEXT,
      last    TEXT,
      sources TEXT
    )`);
    db.exec("CREATE INDEX user_names_user_id ON user_names (user_id)");
    db.exec("CREATE INDEX user_names_nick ON user_names (nick)");
    db.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      user_id TEXT,
      timestamp TEXT,
      -- Set on thread replies: the message this one answers. A reply's own
      -- timestamp cannot find its page, because the page index is built from
      -- top-level timestamps only.
      parent_timestamp TEXT,
      message TEXT
    )`);
    db.exec(
      "CREATE VIRTUAL TABLE messages_fts USING fts5(id UNINDEXED, message)",
    );

    // Attachments in their own table, tied to the message that carried them.
    // Channel kind reaches a file through its message, so the one gate that
    // withholds direct messages withholds their attachments too. A second
    // rule for files could drift from the first; there isn't one.
    db.exec(`CREATE TABLE files (
      id         TEXT PRIMARY KEY,
      message_id TEXT,
      channel_id TEXT,
      name       TEXT,
      title      TEXT,
      filetype   TEXT,
      mimetype   TEXT,
      is_image   INTEGER
    )`);
    db.exec("CREATE INDEX files_message_id ON files (message_id)");

    // Reactions are two different facts, so they are two tables.
    //
    // `count` is how many people reacted. `users` is who. They are not the
    // same claim: Slack truncates the user list on heavily-reacted messages
    // while keeping the count honest, so they disagree in a known direction -
    // attribution undercounts, the total does not. Deriving a total by
    // counting rows would therefore understate exactly the messages people
    // most want to ask about.
    //
    // I measured 22 350 reaction entries in this archive and found no
    // disagreement, which was weaker evidence than it looked: the largest
    // reaction in that sample was 8, far below where Slack starts truncating.
    // Absence of the case in a sample that could not contain it is not
    // evidence of its absence.
    //
    // Reactions live or die with their message, so anything excluded from the
    // index takes its reactions with it - no separate rule that could drift
    // from the one guarding messages.
    db.exec(`CREATE TABLE reactions (
      message_id TEXT,
      channel_id TEXT,
      name       TEXT,
      count      INTEGER,
      PRIMARY KEY (message_id, name)
    )`);
    db.exec("CREATE INDEX reactions_message_id ON reactions (message_id)");
    db.exec("CREATE INDEX reactions_name ON reactions (name)");

    // Attribution, separately, because it is separately incomplete.
    db.exec(`CREATE TABLE reaction_users (
      message_id TEXT,
      name       TEXT,
      user_id    TEXT,
      PRIMARY KEY (message_id, name, user_id)
    )`);
    db.exec("CREATE INDEX reaction_users_user_id ON reaction_users (user_id)");

    // Which rendered page holds a message.
    //
    // A search result that cannot be opened in context is half an answer, and
    // the page number has only ever existed in search.js - which is 110 MB of
    // JavaScript, and no reasonable reader parses that to place one message.
    //
    // Pages run newest first and each row records that page's OLDEST
    // timestamp, so the page holding a message is the first whose oldest entry
    // is at or below it. A timestamp older than every row resolves to nothing
    // rather than to page 0: the index cannot say, and a caller handed a
    // confident wrong page would link people to the wrong conversation.
    db.exec(`CREATE TABLE pages (
      channel_id TEXT,
      page       INTEGER,
      oldest_ts  TEXT,
      PRIMARY KEY (channel_id, page)
    )`);

    db.exec("BEGIN TRANSACTION");

    const pageStmt = db.prepare(
      "INSERT OR REPLACE INTO pages (channel_id, page, oldest_ts) VALUES (?, ?, ?)",
    );
    for (const [channelId, boundaries] of Object.entries(pages || {})) {
      (boundaries || []).forEach((oldest, index) => {
        if (oldest) pageStmt.run([channelId, index, String(oldest)]);
      });
    }
    pageStmt.finalize();

    const userStmt = db.prepare(
      "INSERT OR REPLACE INTO users (id, name) VALUES (?, ?)",
    );
    for (const [userId, name] of Object.entries(users)) {
      userStmt.run([userId, name]);
    }
    userStmt.finalize();

    const nameStmt = db.prepare(
      `INSERT INTO user_names (user_id, nick, first, last, sources)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [userId, userNames] of Object.entries(names || {})) {
      for (const name of userNames) {
        nameStmt.run([
          userId,
          name.nick,
          name.first,
          name.last,
          name.sources.join(","),
        ]);
      }
    }
    nameStmt.finalize();

    const channelStmt = db.prepare(
      "INSERT OR REPLACE INTO channels (id, name, kind, is_archived) VALUES (?, ?, ?, ?)",
    );
    const msgStmt = db.prepare(
      `INSERT OR REPLACE INTO messages
       (id, channel_id, user_id, timestamp, parent_timestamp, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const ftsStmt = db.prepare(
      "INSERT OR REPLACE INTO messages_fts (id, message) VALUES (?, ?)",
    );
    // INSERT OR REPLACE because one file id can appear more than once: Slack
    // reuses it when a file is re-shared into another message. Last write
    // wins, which is right for the file's own metadata - it is one file - but
    // note the consequence: `message_id` then names the most recent share
    // rather than the original. Anything that needs "where did this first
    // appear" wants a join table, not this column.
    // INSERT OR REPLACE rather than INSERT: the same reactor cannot react
    // twice with the same emoji, so a repeat is the same fact arriving again.
    const reactionStmt = db.prepare(
      `INSERT OR REPLACE INTO reactions (message_id, channel_id, name, count)
       VALUES (?, ?, ?, ?)`,
    );
    const reactionUserStmt = db.prepare(
      `INSERT OR REPLACE INTO reaction_users (message_id, name, user_id)
       VALUES (?, ?, ?)`,
    );
    const fileStmt = db.prepare(
      `INSERT OR REPLACE INTO files
       (id, message_id, channel_id, name, title, filetype, mimetype, is_image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

        msgStmt.run([
          id,
          channel.id,
          message.u ?? null,
          message.t,
          message.p ?? null,
          text,
        ]);
        ftsStmt.run([id, indexableText(message)]);

        for (const reaction of message.reactions || []) {
          if (!reaction.name) continue;

          const named = (reaction.users || []).filter(Boolean);
          // Fall back to the number of names only when Slack sent no count -
          // never the other way round, since the count is the reliable half.
          const total =
            typeof reaction.count === "number" ? reaction.count : named.length;

          reactionStmt.run([id, channel.id, reaction.name, total]);

          for (const reactor of named) {
            reactionUserStmt.run([id, reaction.name, reactor]);
          }
        }

        for (const file of message.files || []) {
          if (!file.id) continue;
          fileStmt.run([
            file.id,
            id,
            channel.id,
            file.name ?? null,
            file.title ?? null,
            file.filetype ?? null,
            file.mimetype ?? null,
            isImageFile(file) ? 1 : 0,
          ]);
        }
      }
    }

    channelStmt.finalize();
    msgStmt.finalize();
    ftsStmt.finalize();
    fileStmt.finalize();
    reactionStmt.finalize();
    reactionUserStmt.finalize();

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

  // Punctuation separates words rather than vanishing from between them.
  //
  // This used to strip non-word characters inside each word, which turned
  // "kissa-katolla" into "kissakatolla" and matched nothing - while FTS5's own
  // tokenizer had indexed "kissa-katolla.png" as kissa / katolla / png. A
  // query tokenizer that disagrees with the index tokenizer is the one thing
  // it must not do, and it failed silently rather than erroring. Filenames are
  // mostly hyphens, underscores and dots, so this is the common case now.
  //
  // Splitting still neutralises FTS5's operators (*, ^, parentheses and so
  // on) by turning them into separators, which is what the stripping was for.
  const ftsQuery = cleanQuery
    .split(/[^\p{L}\p{N}_]+/u)
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
