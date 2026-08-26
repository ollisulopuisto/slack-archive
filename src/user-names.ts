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
/**
 * What kind of name this is - because they are not the same thing and this
 * archive was showing them in one pile.
 *
 * `handle` is the @-name Slack knows the account by (`users.name`, and the
 * name the old pipe-form mentions carry). `display` is what the person set as
 * their display name, which is what everyone actually sees and what changes
 * for a joke twice a month. `real` is the real-name field, which in this
 * workspace is another joke field, but is still not a nick.
 */
export type NameKind = "display" | "handle" | "real";

export interface UserName {
  nick: string;
  /** ISO 8601, earliest sighting. */
  first: string;
  /** ISO 8601, latest sighting. */
  last: string;
  /** Where the sighting came from, sorted: mention, profile, username. */
  sources: Array<string>;
  /**
   * Which fields this name was seen in, sorted. Absent on entries recorded
   * before the archive told the two apart.
   */
  kinds?: Array<NameKind>;
}

export type UserNames = Record<string, Array<UserName>>;

export type NameSource = "attachment" | "mention" | "profile" | "username";

export interface NameSighting {
  userId: string;
  nick: string;
  /** ISO 8601. */
  seen: string;
  source: NameSource;
  kind: NameKind;
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
      // The pipe form carries the HANDLE, not the display name.
      add(sightings, match[1], match[2], seen, "mention", "handle");
    }

    // Bot and legacy messages carry the posting name directly.
    if (message.user && typeof message.username === "string") {
      add(
        sightings,
        message.user,
        message.username,
        seen,
        "username",
        "handle",
      );
    }

    // Sharing a message quotes it as an attachment carrying the author's
    // DISPLAY name that day. The pipe-form mention above dried up around 2018;
    // this did not, which makes it the only source covering the middle years.
    // An attachment with no author_id is a link unfurl - "Helsingin Sanomat" is
    // a newspaper, not a member - so the id is what qualifies it.
    for (const attachment of message.attachments || []) {
      if (!MEMBER_ID.test(String(attachment?.author_id || ""))) continue;

      for (const name of [attachment.author_name, attachment.author_subname]) {
        // A quoted message is signed with the display name of that day.
        add(
          sightings,
          attachment.author_id,
          name,
          seen,
          "attachment",
          "display",
        );
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
    for (const { nick, kind } of profileNames(user)) {
      add(sightings, userId, nick, now, "profile", kind);
    }
  }

  return sightings;
}

function profileNames(
  user: User | undefined,
): Array<{ nick: string; kind: NameKind }> {
  if (!user) return [];

  // display_name is the one people change; the others are recorded because a
  // person who never set a display name is still known by something. Each is
  // recorded as what it is.
  return [
    { nick: user.profile?.display_name, kind: "display" as const },
    { nick: user.profile?.real_name, kind: "real" as const },
    { nick: user.name, kind: "handle" as const },
  ]
    .map(({ nick, kind }) => ({
      nick: typeof nick === "string" ? nick.trim() : "",
      kind,
    }))
    .filter(({ nick }) => nick.length > 0);
}

function add(
  sightings: Array<NameSighting>,
  userId: string | undefined,
  nick: string | undefined,
  seen: string,
  source: NameSource,
  kind: NameKind,
) {
  const trimmed = typeof nick === "string" ? nick.trim() : "";

  // A name that is itself an id is what getName() prints when it has nothing,
  // so recording it would teach the history that a person is called U2GV75QA2.
  if (!userId || trimmed.length === 0 || MEMBER_ID.test(trimmed)) return;

  sightings.push({ userId, nick: trimmed, seen, source, kind });
}

/**
 * What somebody was called at a given moment.
 *
 * Better than listing every name they have ever had, and much smaller: a
 * ten-year-old message signed with today's display name wants one answer -
 * who was this, then - not a catalogue of thirty-seven. Listing them all put
 * 1 338 bytes on every message and made 62% of a rendered page a tooltip.
 *
 * The windows are sighting windows, not tenures: `first` and `last` are when
 * the archive SAW a name in use. A message between two sightings of the same
 * name is inside that window; a message before any sighting gets the earliest
 * name, since a name seen in 2016 was more likely in use just before then than
 * one first seen in 2024.
 */
export function nameAt(
  history: UserNames,
  userId: string | undefined,
  iso: string,
): string | null {
  if (!userId) return null;

  const names = history[userId] || [];
  if (names.length === 0) return null;

  // A real name is not what somebody was called - it is the field next to it -
  // so a display name or a handle wins over it. But only at the same distance
  // in time: a real name covering 2017 beats a display name first seen in
  // 2020, because the question is what this message was signed with.
  const spoken = names.filter((name) => !isOnlyRealName(name));
  const covering = (from: Array<UserName>) =>
    from.find((name) => iso >= name.first && iso <= name.last);
  const earlier = (from: Array<UserName>) =>
    from.filter((name) => name.first <= iso).slice(-1)[0];

  const answer =
    covering(spoken) ||
    covering(names) ||
    earlier(spoken) ||
    earlier(names) ||
    spoken[0] ||
    names[0];

  return answer ? answer.nick : null;
}

function isOnlyRealName(name: UserName): boolean {
  return (
    (name.kinds || []).length > 0 && name.kinds!.every((k) => k === "real")
  );
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
      ...(name.kinds ? { kinds: [...name.kinds] } : {}),
    }));
  }

  for (const { userId, nick, seen, source, kind } of sightings) {
    const names = (merged[userId] = merged[userId] || []);
    const known = names.find((name) => name.nick === nick);

    if (!known) {
      names.push({
        nick,
        first: seen,
        last: seen,
        sources: [source],
        kinds: [kind],
      });
      continue;
    }

    if (seen < known.first) known.first = seen;
    if (seen > known.last) known.last = seen;
    if (!known.sources.includes(source)) {
      known.sources = [...known.sources, source].sort();
    }
    if (!(known.kinds || []).includes(kind)) {
      known.kinds = [...(known.kinds || []), kind].sort();
    }
  }

  // Oldest first, so a user's entry reads as the story of what they have been
  // called.
  for (const names of Object.values(merged)) {
    names.sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
  }

  return merged;
}

export interface NameHistoryEntry {
  userId: string;
  names: Array<UserName>;
}

/**
 * The people the names page is about, most-renamed first.
 *
 * `exclude` is the bot accounts: they never renamed themselves, the names
 * mined for them come from their own message signatures, and the page links
 * every row to a profile page that is not written for bots.
 */
export function nameHistory(
  userNames: UserNames,
  exclude: Set<string>,
): Array<NameHistoryEntry> {
  return Object.entries(userNames)
    .filter(([userId, names]) => names.length > 0 && !exclude.has(userId))
    .map(([userId, names]) => ({ userId, names }))
    .sort((a, b) => b.names.length - a.names.length);
}
