import { ArchiveMessage } from "./interfaces.js";

/**
 * "Also send to channel", shown once.
 *
 * A reply sent that way comes back from Slack twice: as a top-level message in
 * the channel, and inside its parent's replies. The archive stores both,
 * faithfully - and the page then rendered the same message twice, with the same
 * `id` on both, which is invalid HTML and makes a permalink to that message
 * ambiguous. 953 of them on forty pages of one channel.
 *
 * The copy kept is the one in the thread, because that is where the message
 * makes sense and because the search index made the same choice - a result
 * linking to that timestamp lands on an anchor that exists.
 *
 * A broadcast whose parent is NOT on this page is kept: pages are chunks of a
 * channel, a thread answered a week later has its parent elsewhere, and
 * dropping it here would lose the message rather than de-duplicate it.
 */
export function withoutBroadcastCopies(
  messages: Array<ArchiveMessage>,
): Array<ArchiveMessage> {
  const shownInThreads = new Set<string>();

  for (const message of messages) {
    for (const reply of message.replies || []) {
      if (reply.ts) shownInThreads.add(reply.ts);
    }
  }

  if (shownInThreads.size === 0) return messages;

  return messages.filter(
    (message) => !(message.ts && shownInThreads.has(message.ts)),
  );
}
