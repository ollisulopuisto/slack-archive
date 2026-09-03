import { ElementSpan } from "./big-json.js";
import { ChunksInfo } from "./interfaces.js";
import { MonthPage, monthsToPages } from "./calendar-nav.js";

/**
 * Which chunks exist, where their messages are in the file, and who renders
 * them.
 *
 * The first attempt at rendering on several cores gave each worker a whole
 * channel, which cannot work here: one channel holds 65% of this archive, so
 * one worker rendered seven hundred pages while the rest finished in seconds.
 * A chunk does not depend on any other chunk - it needs its own thousand
 * messages and `chunksInfo`, which is three numbers per chunk - so the unit of
 * work is a chunk.
 *
 * What made that impractical before was reading: a chunk's messages lived in a
 * 367 MB array that had to be parsed whole. Elements of a JSON array are
 * contiguous, so a chunk is one byte range, and a worker can read a megabyte
 * instead of a third of a gigabyte.
 */
export interface ChunkPlan {
  index: number;
  span: ElementSpan;
  /** The oldest message on the chunk: what the permalink index records. */
  oldestTs?: string;
  /** The newest message on the chunk, so a permalink has both ends of its range. */
  newestTs?: string;
  /** The message just older than this chunk, so a gap divider can sit on the boundary. */
  adjacentOlderTs?: string;
}

/** Same structure as ChunkPlan, used for static HTML page fallback. */
export type PagePlan = ChunkPlan;

export interface ChannelPlan {
  channelId: string;
  chunksInfo: ChunksInfo;
  chunks: Array<ChunkPlan>; // for infinite scroll
  pages: Array<PagePlan>; // for static fallback
  /** Every month this channel has messages in, and where that month starts. */
  months: Array<MonthPage>;
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
  const chunks: Array<ChunkPlan> = [];
  const pages: Array<PagePlan> = [];

  // A channel nobody ever posted in still gets its chunk, saying so.
  if (messages.length === 0) {
    return {
      channelId,
      chunksInfo,
      chunks: [{ index: 0, span: { start: 0, end: 0 } }],
      pages: [{ index: 0, span: { start: 0, end: 0 } }],
      months: [],
    };
  }

  for (let start = 0; start < messages.length; start += chunkSize) {
    const last = Math.min(start + chunkSize, messages.length) - 1;

    chunksInfo.push({
      oldest: formatTimestamp(messages[last]),
      newest: formatTimestamp(messages[start]),
      count: last - start + 1,
    });

    const chunkPlan: ChunkPlan = {
      index: chunks.length,
      span: { start: spans[start].start, end: spans[last].end },
      oldestTs: messages[last]?.ts,
      newestTs: messages[start]?.ts,
      // The message right after this chunk's oldest one: the gap between the
      // two is drawn at the top of this chunk, where the reader meets it.
      adjacentOlderTs: messages[last + 1]?.ts,
    };
    chunks.push(chunkPlan);
    pages.push(chunkPlan);
  }

  return {
    channelId,
    chunksInfo,
    chunks,
    pages,
    months: monthsToPages(messages as never, chunkSize),
  };
}

/**
 * Share the chunks out, by bytes rather than by count.
 *
 * A chunk of links and one-word replies is not the same work as a chunk of
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
    .flatMap((plan) => plan.chunks.map((chunk) => ({ plan, chunk })))
    .sort((a, b) => weigh(b.chunk) - weigh(a.chunk));

  for (const { plan, chunk } of heaviestFirst) {
    const lightest = load.indexOf(Math.min(...load));
    const bucket = buckets[lightest];
    const existing = bucket.get(plan.channelId);

    if (existing) {
      existing.chunks.push(chunk);
      existing.pages.push(chunk);
    } else {
      // chunksInfo travels once per worker per channel, not once per chunk:
      // a channel with 714 chunks carries 714 entries in it.
      bucket.set(plan.channelId, {
        channelId: plan.channelId,
        chunksInfo: plan.chunksInfo,
        months: plan.months,
        chunks: [chunk],
        pages: [chunk],
      });
    }

    load[lightest] += weigh(chunk);
  }

  return buckets
    .map((bucket) => [...bucket.values()])
    .filter((bucket) => bucket.length > 0);
}

function weigh(chunk: ChunkPlan): number {
  return Math.max(1, chunk.span.end - chunk.span.start);
}
