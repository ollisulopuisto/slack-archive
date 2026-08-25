import { ArchiveMessage, User, Users } from "./interfaces.js";

/**
 * One name a person was known by, and when we saw them using it.
 *
 * Slack has no rename history: `users.info` answers with whoever they are
 * today, and yesterday is gone. In a workspace where people change their
 * handle for a joke and change it back a week later, "who wrote this" is
 * unanswerable from the current profile alone - one member of this archive has
 * been juusokarhu, kuningaslitmanen, reijotossavainen, hevosenkuerpae,
 * ullaappelsin, natsiblondi and lahtari, all in eleven months.
 */
export interface UserName {
  nick: string;
  /** ISO 8601, earliest sighting. */
  first: string;
  /** ISO 8601, latest sighting. */
  last: string;
  /** Where the sighting came from, sorted: mention, profile, username. */
  sources: Array<string>;
}

export type UserNames = Record<string, Array<UserName>>;

export type NameSource = "attachment" | "mention" | "profile" | "username";

export interface NameSighting {
  userId: string;
  nick: string;
  /** ISO 8601. */
  seen: string;
  source: NameSource;
}

/**
 * Mentions used to carry the name: `<@U2H06BCQZ|jaricurry>`. Slack mostly
 * sends the bare `<@U2H06BCQZ>` now, but the old form is all over messages
 * from 2016 onward and it is a dated record of what somebody called themselves
 * that day - the only retroactive one there is.
 */
const MENTION_WITH_NAME = /<@(U[A-Z0-9]+)\|([^>]*)>/g;

/** A Slack member id, as opposed to a bot or an app. */
const MEMBER_ID = /^U[A-Z0-9]+$/;

/** A Slack timestamp ("1475062758.000002") as an ISO 8601 string. */
export function slackTimestampToIso(ts: string | undefined): string | null {
  const seconds = Number.parseFloat(ts || "");

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

/** Every name sighting in one message, its thread replies included. */
export function mineNames(message: ArchiveMessage): Array<NameSighting> {
  const sightings: Array<NameSighting> = [];
  const seen = slackTimestampToIso(message.ts);

  if (seen) {
    for (const match of String(message.text || "").matchAll(
      MENTION_WITH_NAME,
    )) {
      add(sightings, match[1], match[2], seen, "mention");
    }

    // Bot and legacy messages carry the posting name directly.
    if (message.user && typeof message.username === "string") {
      add(sightings, message.user, message.username, seen, "username");
    }

    // Sharing a message quotes it as an attachment carrying the author's
    // DISPLAY name that day. The pipe-form mention above dried up around 2018;
    // this did not, which makes it the only source covering the middle years.
    // An attachment with no author_id is a link unfurl - "Helsingin Sanomat" is
    // a newspaper, not a member - so the id is what qualifies it.
    for (const attachment of message.attachments || []) {
      if (!MEMBER_ID.test(String(attachment?.author_id || ""))) continue;

      for (const name of [attachment.author_name, attachment.author_subname]) {
        add(sightings, attachment.author_id, name, seen, "attachment");
      }
    }
  }

  for (const reply of message.replies || []) {
    sightings.push(...mineNames(reply));
  }

  return sightings;
}

/** What everyone is called right now, which is what today adds to the record. */
export function snapshotNames(users: Users, now: string): Array<NameSighting> {
  const sightings: Array<NameSighting> = [];

  for (const [userId, user] of Object.entries(users || {})) {
    for (const nick of profileNames(user)) {
      add(sightings, userId, nick, now, "profile");
    }
  }

  return sightings;
}

function profileNames(user: User | undefined): Array<string> {
  if (!user) return [];

  // display_name is the one people change; the others are recorded because a
  // person who never set a display name is still known by something.
  return [user.profile?.display_name, user.profile?.real_name, user.name]
    .map((name) => (typeof name === "string" ? name.trim() : ""))
    .filter((name) => name.length > 0);
}

function add(
  sightings: Array<NameSighting>,
  userId: string | undefined,
  nick: string | undefined,
  seen: string,
  source: NameSource,
) {
  const trimmed = typeof nick === "string" ? nick.trim() : "";

  // A name that is itself an id is what getName() prints when it has nothing,
  // so recording it would teach the history that a person is called U2GV75QA2.
  if (!userId || trimmed.length === 0 || MEMBER_ID.test(trimmed)) return;

  sightings.push({ userId, nick: trimmed, seen, source });
}

/**
 * Fold sightings into the history, widening the window on a name we already
 * know rather than adding it twice. Returns a new object; the input is not
 * touched.
 */
export function recordNames(
  history: UserNames,
  sightings: Array<NameSighting>,
): UserNames {
  const merged: UserNames = {};

  for (const [userId, names] of Object.entries(history || {})) {
    merged[userId] = names.map((name) => ({
      ...name,
      sources: [...name.sources],
    }));
  }

  for (const { userId, nick, seen, source } of sightings) {
    const names = (merged[userId] = merged[userId] || []);
    const known = names.find((name) => name.nick === nick);

    if (!known) {
      names.push({ nick, first: seen, last: seen, sources: [source] });
      continue;
    }

    if (seen < known.first) known.first = seen;
    if (seen > known.last) known.last = seen;
    if (!known.sources.includes(source)) {
      known.sources = [...known.sources, source].sort();
    }
  }

  // Oldest first, so a user's entry reads as the story of what they have been
  // called.
  for (const names of Object.values(merged)) {
    names.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
  }

  return merged;
}
