import { User, Users } from "./interfaces.js";

/**
 * A status somebody had, and when the archive saw it.
 *
 * Slack keeps no history of statuses any more than it does of names or
 * pictures, and unlike those two there is nothing to mine: a status is never
 * quoted in a message, so nothing about the past is recoverable. What can be
 * done is to start writing it down. In a workspace where the status line is
 * used as a joke channel, "kaljalla" for three days in July 2019 is the same
 * kind of artefact as a nickname - and equally gone if nobody records it.
 */
export interface UserStatus {
  text: string;
  /** Slack's `:emoji:` shortcode, or "" when the status is text only. */
  emoji: string;
  /** ISO 8601, first time this status was seen. */
  first: string;
  /** ISO 8601, most recent time it was seen. */
  last: string;
}

export type UserStatuses = Record<string, Array<UserStatus>>;

export interface StatusSighting {
  userId: string;
  text: string;
  emoji: string;
  seen: string;
}

/** What everyone's status says right now. */
export function snapshotStatuses(
  users: Users,
  now: string,
): Array<StatusSighting> {
  const sightings: Array<StatusSighting> = [];

  for (const [userId, user] of Object.entries(users || {})) {
    const profile = (user as User)?.profile;
    const text = (profile?.status_text || "").trim();
    const emoji = (profile?.status_emoji || "").trim();

    // An empty status is a real state - somebody cleared theirs - but it is
    // not worth a row of its own: the gap between two statuses says the same
    // thing, and recording every blank would bury the ones that say something.
    if (!text && !emoji) continue;

    sightings.push({ userId, text, emoji, seen: now });
  }

  return sightings;
}

/**
 * Fold sightings into the history, widening a status we already know rather
 * than adding it again. Returns a new object; the input is not touched.
 */
export function recordStatuses(
  history: UserStatuses,
  sightings: Array<StatusSighting>,
): UserStatuses {
  const merged: UserStatuses = {};

  for (const [userId, statuses] of Object.entries(history || {})) {
    merged[userId] = statuses.map((status) => ({ ...status }));
  }

  for (const { userId, text, emoji, seen } of sightings) {
    const statuses = (merged[userId] = merged[userId] || []);
    const known = statuses.find(
      (status) => status.text === text && status.emoji === emoji,
    );

    if (!known) {
      statuses.push({ text, emoji, first: seen, last: seen });
      continue;
    }

    if (seen < known.first) known.first = seen;
    if (seen > known.last) known.last = seen;
  }

  for (const statuses of Object.values(merged)) {
    statuses.sort((a, b) =>
      a.first < b.first ? -1 : a.first > b.first ? 1 : 0,
    );
  }

  return merged;
}
