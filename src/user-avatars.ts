import { ArchiveMessage } from "./interfaces.js";

/**
 * A picture somebody used, and when they started using it.
 *
 * Slack has no more history for profile pictures than it does for names, but
 * an avatar URL carries the date it was uploaded in its own path:
 *
 *     https://avatars.slack-edge.com/2021-10-04/2570.../..._512.jpg
 *
 * and a shared message quotes its author's avatar as `author_icon`. So the
 * dates come free and the pictures are still fetchable. Across this archive
 * that is 212 avatars for 13 people, one of them 81 changes deep.
 */
export interface UserAvatar {
  /** The date Slack put in the URL, YYYY-MM-DD. Identity, not just metadata. */
  date: string;
  url: string;
  /** Slack timestamp of the earliest message that showed this picture. */
  seen: string;
}

export type UserAvatars = Record<string, Array<UserAvatar>>;

const AVATAR_URL = /avatars\.slack-edge\.com\/(\d{4}-\d{2}-\d{2})\//;
const MEMBER_ID = /^U[A-Z0-9]+$/;

export interface AvatarSighting {
  userId: string;
  date: string;
  url: string;
  seen: string;
}

/** Every avatar sighting in one message, thread replies included. */
export function mineAvatars(message: ArchiveMessage): Array<AvatarSighting> {
  const sightings: Array<AvatarSighting> = [];

  for (const attachment of message.attachments || []) {
    const url = String(attachment?.author_icon || "");
    const userId = String(attachment?.author_id || "");

    // No author_id means a link unfurl, where the icon belongs to a website
    // rather than a member - a newspaper's logo is not somebody's face.
    if (!MEMBER_ID.test(userId)) continue;

    const match = url.match(AVATAR_URL);
    if (!match) continue;

    sightings.push({
      userId,
      date: match[1],
      url,
      seen: message.ts || "",
    });
  }

  for (const reply of message.replies || []) {
    sightings.push(...mineAvatars(reply));
  }

  return sightings;
}

/**
 * Fold sightings into the history, keyed by the URL's own date.
 *
 * Two sightings of the same picture are one avatar, not two, and the date in
 * the URL is what says so - the same face quoted in 2021 and again in 2024 is
 * still the picture they uploaded in 2019.
 */
export function recordAvatars(
  history: UserAvatars,
  sightings: Array<AvatarSighting>,
): UserAvatars {
  const merged: UserAvatars = {};

  for (const [userId, avatars] of Object.entries(history || {})) {
    merged[userId] = avatars.map((avatar) => ({ ...avatar }));
  }

  for (const { userId, date, url, seen } of sightings) {
    const avatars = (merged[userId] = merged[userId] || []);
    const known = avatars.find((avatar) => avatar.date === date);

    if (!known) {
      avatars.push({ date, url, seen });
      continue;
    }

    // Earliest sighting wins: it is the closest the archive gets to when they
    // actually changed it.
    if (seen && (!known.seen || seen < known.seen)) {
      known.seen = seen;
      known.url = url;
    }
  }

  for (const avatars of Object.values(merged)) {
    avatars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  return merged;
}
