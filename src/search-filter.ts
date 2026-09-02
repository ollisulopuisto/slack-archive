import { channelKind } from "./channels.js";
import { ArchiveMessage, Channel, SearchMessage, Users } from "./interfaces.js";

/**
 * What the search index is allowed to see.
 *
 * The archive holds direct messages next to public ones, and until now the
 * index held all of it: `kind` was stored on the channel row but no query ever
 * filtered on it. Excluding at build time rather than at query time is the
 * difference between an index that cannot answer a question and one that
 * merely does not - the second kind leaks the day someone writes a new query,
 * or opens the database file directly, which is a thing a bot on a VPS does.
 */

/**
 * Turn what a person wrote on the command line - `historia,backlog` - into ids.
 *
 * Handles, display names and raw ids all work, because the person typing this
 * knows the bot as "backlog" and should not have to look up U08NYQN3469. A
 * name that matches nobody is ignored rather than guessed at: excluding a user
 * who does not exist is harmless, excluding the wrong one is not.
 */
export function excludedUserIds(
  names: Array<string>,
  users: Users,
): Set<string> {
  const wanted = names
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  const excluded = new Set<string>();

  for (const name of wanted) {
    for (const [userId, user] of Object.entries(users || {})) {
      const candidates = [
        userId,
        user?.name,
        user?.profile?.display_name,
        user?.profile?.real_name,
      ];

      if (
        candidates.some(
          (candidate) =>
            typeof candidate === "string" &&
            candidate.trim().toLowerCase() === name,
        )
      ) {
        excluded.add(userId);
      }
    }
  }

  return excluded;
}

/**
 * Every account the workspace marks as a bot or an app.
 *
 * Derived rather than configured: nobody should have to type U08NYQN3469, or
 * remember which of thirty-two accounts are people.
 */
export function botUserIds(users: Users): Set<string> {
  const bots = new Set<string>();

  for (const [userId, user] of Object.entries(users || {})) {
    if (user?.is_bot || (user as any)?.is_app_user || userId === "USLACKBOT") {
      bots.add(userId);
    }
  }

  return bots;
}

/**
 * Who an index is allowed to name: people who appear in it, not the whole
 * workspace directory.
 *
 * The users table and the search-page dropdown used to list everyone in
 * users.json, including people who only ever DMed.
 */
export function collectIndexedUserIds(options: {
  messages: Array<{
    u?: string;
    reactions?: Array<{ users?: Array<string> }>;
  }>;
  members?: Array<string>;
}): Set<string> {
  const ids = new Set<string>();

  for (const userId of options.members || []) {
    if (userId) ids.add(userId);
  }

  for (const message of options.messages) {
    if (message.u) ids.add(message.u);

    for (const reaction of message.reactions || []) {
      for (const userId of reaction.users || []) {
        if (userId) ids.add(userId);
      }
    }
  }

  return ids;
}

export function pickVisibleUsers<T>(
  users: Record<string, T>,
  visible: Set<string>,
): Record<string, T> {
  const picked: Record<string, T> = {};

  for (const [userId, value] of Object.entries(users)) {
    if (visible.has(userId)) picked[userId] = value;
  }

  return picked;
}

/** Is this channel one the index may hold at all? */
export function isChannelSearchable(
  channel: Channel,
  excludedKinds: Set<string>,
): boolean {
  return !excludedKinds.has(channelKind(channel));
}

/** Is this message one the index may hold? */
export function isMessageSearchable(
  message: SearchMessage,
  excludedUsers: Set<string>,
): boolean {
  return !message.u || !excludedUsers.has(message.u);
}

export interface SearchMessageOptions {
  hiddenUsers: Set<string>;
  includeBots: boolean;
}

/**
 * Archive messages -> index entries, filtered.
 *
 * One function because there are two builders - search.js and search.db - and
 * they had drifted: the exclusions were computed in both, announced in both,
 * and applied on only one of the four paths through them. Two hand-rolled
 * copies of the same mapping is what let a fix to one leave the other exactly
 * as it was.
 *
 * The filter runs AFTER the mapping. isMessageSearchable reads `u`; an archive
 * message calls it `user`. ArchiveMessage carries an index signature, so
 * reading `.u` off one is legal, always undefined, and silently keeps
 * everything - which is how the exclusions passed tsc and 132 tests while
 * excluding nothing.
 */
export function toSearchMessages(
  messages: Array<ArchiveMessage>,
  options: SearchMessageOptions,
): Array<SearchMessage> {
  // Replies are messages. They were never indexed - getMessages returns
  // top-level messages with their replies nested inside them, and every
  // builder mapped only the outer array - so 35 024 messages in this archive,
  // about 3% of it and disproportionately the answers rather than the
  // questions, could not be found by search and never could.
  const flat: Array<ArchiveMessage> = [];

  // A reply sent with "also send to channel" comes back BOTH as a top-level
  // message and inside its parent's replies, so flattening produced two rows
  // with one timestamp - 7 598 of them in the busiest channel alone. MiniSearch
  // throws on the first duplicate id it is given, which meant every search on
  // the website died before showing a single result.
  const seen = new Set<string>();
  const push = (message: ArchiveMessage) => {
    const ts = message.ts || "";

    if (seen.has(ts)) return;

    seen.add(ts);
    flat.push(message);
  };

  for (const message of messages) {
    // Replies first: that copy knows which thread it belongs to, and the
    // top-level copy of the same message does not.
    for (const reply of message.replies || []) {
      // Slack repeats the parent as the first element of a thread in some
      // payloads; the archiver strips that, but a reply that IS its parent
      // would otherwise be indexed twice.
      if (reply.ts === message.ts) continue;

      push({ ...reply, parentTs: message.ts } as ArchiveMessage);
    }

    push(message);
  }

  // Back into the order they were given in: oldest first within a thread, and
  // a parent before its replies.
  flat.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));

  return flat
    .filter((message) => options.includeBots || !message.bot_id)
    .map((message) => {
      const searchMessage: SearchMessage = {
        m: message.text,
        u: message.user,
        t: message.ts,
      };

      if (message.parentTs) searchMessage.p = message.parentTs as string;

      const files = (message.files || [])
        .filter((file: any) => file && file.id)
        .map((file: any) => ({
          id: file.id,
          name: file.name,
          title: file.title,
          filetype: file.filetype,
          mimetype: file.mimetype,
        }));

      if (files.length > 0) searchMessage.files = files;

      // Reactions travel with the message. Lost in .145 when the two builders
      // were unified: `files` was carried across from the inline mapping and
      // this was not, so every index built since has had an empty reactions
      // table while the archive itself held 144 840 of them.
      const reactions = (message.reactions || [])
        .filter((reaction: any) => reaction && reaction.name)
        .map((reaction: any) => ({
          name: reaction.name,
          count: reaction.count,
          users: reaction.users,
        }));

      if (reactions.length > 0) searchMessage.reactions = reactions;

      return searchMessage;
    })
    .filter((message) => isMessageSearchable(message, options.hiddenUsers));
}
