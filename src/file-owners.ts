import { Users } from "./interfaces.js";
import { excludedUserIds } from "./search-filter.js";

/**
 * Whose files this archive does not download.
 *
 * A bot that shares an archived image back into a channel produces a real
 * Slack message with a real file, and the next run downloads it - so every
 * share permanently adds a second copy of a picture the archive already has,
 * under a new id. The copy buys nothing: the original is right there.
 *
 * Not downloading it is better than deleting it later. A sweep would need
 * write access to a file store that is deliberately read-only, and it would
 * have to keep working forever - and a sweep that silently stops looks exactly
 * like a sweep with nothing to do. Not fetching it means there is nothing to
 * find, nothing to delete, and no mechanism to maintain.
 *
 * This is deliberately a separate list from the search exclusion. They overlap
 * for reposting bots and they are not the same question: somebody kept out of
 * the index because they asked to be should still have their pictures kept.
 */
export function skipsFiles(names: Array<string>, users: Users): Set<string> {
  return excludedUserIds(names, users);
}
