import { ElementSpan } from "./big-json.js";
import { ChunksInfo } from "./interfaces.js";

/**
 * Which pages exist, where their messages are in the file, and who renders
 * them.
 *
 * The first attempt at rendering on several cores gave each worker a whole
 * channel, which cannot work here: one channel holds 65% of this archive, so
 * one worker rendered seven hundred pages while the rest finished in seconds.
 * A page does not depend on any other page - it needs its own thousand
 * messages and `chunksInfo`, which is three numbers per chunk - so the unit of
 * work is a page.
 *
 * What made that impractical before was reading: a page's messages lived in a
 * 367 MB array that had to be parsed whole. Elements of a JSON array are
 * contiguous, so a page is one byte range, and a worker can read a megabyte
 * instead of a third of a gigabyte.
 */
export interface PagePlan {
  index: number;
  span: ElementSpan;
  /** The oldest message on the page: what the permalink index records. */
  oldestTs?: string;
}

export interface ChannelPlan {
  channelId: string;
  chunksInfo: ChunksInfo;
  pages: Array<PagePlan>;
}

export interface PlanOptions {
  chunkSize: number;
  /** How a timestamp is written in the pagination control. */
  formatTimestamp: (message: { ts?: string }) => string;
}

export function planChannel(
  channelId: string,
  messages: Array<{ ts?: string }>,
  spans: Array<ElementSpan>,
  { chunkSize, formatTimestamp }: PlanOptions,
): ChannelPlan {
  const chunksInfo: ChunksInfo = [];
  const pages: Array<PagePlan> = [];

  // A channel nobody ever posted in still gets its page, saying so.
  if (messages.length === 0) {
    return {
      channelId,
      chunksInfo,
      pages: [{ index: 0, span: { start: 0, end: 0 } }],
    };
  }

  for (let start = 0; start < messages.length; start += chunkSize) {
    const last = Math.min(start + chunkSize, messages.length) - 1;

    chunksInfo.push({
      oldest: formatTimestamp(messages[last]),
      newest: formatTimestamp(messages[start]),
      count: last - start + 1,
    });

    pages.push({
      index: pages.length,
      span: { start: spans[start].start, end: spans[last].end },
      oldestTs: messages[last]?.ts,
    });
  }

  return { channelId, chunksInfo, pages };
}

/**
 * Share the pages out, by bytes rather than by count.
 *
 * A page of links and one-word replies is not the same work as a page of
 * pasted articles, and the byte range is the best estimate of that difference
 * that costs nothing to compute.
 */
export function shareOutPages(
  plans: Array<ChannelPlan>,
  workers: number,
): Array<Array<ChannelPlan>> {
  const buckets: Array<Map<string, ChannelPlan>> = Array.from(
    { length: workers },
    () => new Map(),
  );
  const load = new Array(workers).fill(0);

  const heaviestFirst = plans
    .flatMap((plan) => plan.pages.map((page) => ({ plan, page })))
    .sort((a, b) => weigh(b.page) - weigh(a.page));

  for (const { plan, page } of heaviestFirst) {
    const lightest = load.indexOf(Math.min(...load));
    const bucket = buckets[lightest];
    const existing = bucket.get(plan.channelId);

    if (existing) {
      existing.pages.push(page);
    } else {
      // chunksInfo travels once per worker per channel, not once per page:
      // a channel with 714 pages carries 714 entries in it.
      bucket.set(plan.channelId, {
        channelId: plan.channelId,
        chunksInfo: plan.chunksInfo,
        pages: [page],
      });
    }

    load[lightest] += weigh(page);
  }

  return buckets
    .map((bucket) => [...bucket.values()])
    .filter((bucket) => bucket.length > 0);
}

function weigh(page: PagePlan): number {
  return Math.max(1, page.span.end - page.span.start);
}
