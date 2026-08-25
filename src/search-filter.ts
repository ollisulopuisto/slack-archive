import { channelKind } from "./channels.js";
import { Channel, SearchMessage, Users } from "./interfaces.js";

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
