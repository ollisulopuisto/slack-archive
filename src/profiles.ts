import { UserStats } from "./stats.js";

/**
 * Who gets a profile page - the one answer, used by the thing that writes the
 * pages and by everything that links to them.
 *
 * Two places deciding this separately is how the archive ended up with seven
 * dead links per channel page: the message linked anyone with a user id, while
 * the pages were written only for people who said something in a channel that
 * is being published, bots excluded.
 */
export function profilePageIds(
  byUser: Record<string, UserStats>,
): Set<string> {
  return new Set(
    Object.values(byUser)
      .filter((person) => person.messages > 0 && !person.isBot)
      .map((person) => person.userId),
  );
}
