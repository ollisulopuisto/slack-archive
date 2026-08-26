import { Channel } from "./interfaces.js";

/**
 * Which channel the front page offers to open.
 *
 * Every workspace has one room that is the workspace - here it is #offtopic,
 * which holds 65% of ten years - and no default can know its name. So it is a
 * setting, `--start-channel`, and when nobody sets it the busiest published
 * channel is a better guess than the first one in a list, which is an accident
 * of sorting.
 *
 * A name that does not match anything published falls back rather than
 * offering a link to a page this site did not write.
 */
export function pickStartChannel(
  channels: Array<Channel>,
  messages: Record<string, number>,
  wanted: string,
): Channel | undefined {
  if (channels.length === 0) return undefined;

  const asked = wanted.trim().replace(/^#/, "").toLowerCase();

  if (asked) {
    const named = channels.find(
      (channel) =>
        channel.id?.toLowerCase() === asked ||
        (channel.name || "").toLowerCase() === asked,
    );

    if (named) return named;
  }

  const busiest = [...channels].sort(
    (a, b) => (messages[b.id!] || 0) - (messages[a.id!] || 0),
  )[0];

  return busiest || channels[0];
}
