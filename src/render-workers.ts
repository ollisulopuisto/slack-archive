import os from "os";
import { Worker } from "worker_threads";

import { Channel } from "./interfaces.js";
import { RenderContext } from "./render-context.js";
import { SearchPageIndex } from "./interfaces.js";

/**
 * The channel pages, rendered on more than one core.
 *
 * Measured on this archive: 2m32s of a 3m11s run is this one loop, and the
 * whole of it is one core out of ten. Nothing in a page depends on any other
 * page - since the render context stopped being fifteen mutable globals, a
 * page is a function of (context, channel, chunk) - so the only thing standing
 * between it and every core was that it was written as a for loop.
 *
 * Each worker reads the message files for its own channels. That parses the
 * JSON twice in total, once for counting and once for rendering, which costs
 * about twenty seconds of CPU spread across the workers and buys back two
 * minutes of wall clock.
 */
export interface RenderedElsewhere {
  /** What each worker recorded about which page a timestamp landed on. */
  pages: SearchPageIndex;
}

export function defaultWorkerCount(requested?: number): number {
  if (requested && requested > 0) return requested;

  // One core left for the operating system, and a ceiling: past about eight
  // the disk and the writes are the limit, not the CPU.
  return Math.max(1, Math.min(8, (os.cpus()?.length || 2) - 1));
}

/**
 * Split the channels so each worker gets a similar amount of WORK, which is
 * messages, not channels. One channel here holds 713 510 messages and the
 * smallest holds 75; a round-robin by count would leave one worker rendering
 * for two minutes while nine sat idle.
 */
export function shareOut(
  channels: Array<Channel>,
  weights: Record<string, number>,
  workers: number,
): Array<Array<Channel>> {
  const buckets: Array<Array<Channel>> = Array.from(
    { length: workers },
    () => [],
  );
  const load = new Array(workers).fill(0);

  const heaviestFirst = [...channels].sort(
    (a, b) => (weights[b.id!] || 0) - (weights[a.id!] || 0),
  );

  for (const channel of heaviestFirst) {
    const lightest = load.indexOf(Math.min(...load));
    buckets[lightest].push(channel);
    load[lightest] += (weights[channel.id!] || 0) + 1;
  }

  return buckets.filter((bucket) => bucket.length > 0);
}

export async function renderChannelsInWorkers(
  context: RenderContext,
  buckets: Array<Array<Channel>>,
): Promise<RenderedElsewhere> {
  const workerUrl = new URL("./render-worker-entry.js", import.meta.url);
  const pages: SearchPageIndex = {};

  const runs = buckets.map(
    (channels, i) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(workerUrl, {
          // The same flags this process was given: the worker builds its own
          // config from them, and --html-exclude-kinds decides what may be
          // written at all.
          argv: process.argv.slice(2),
          workerData: { context, channels, worker: i },
        });

        worker.on("message", (message: SearchPageIndex) => {
          for (const [channelId, timestamps] of Object.entries(message || {})) {
            pages[channelId] = timestamps;
          }
        });
        worker.on("error", reject);
        worker.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`A render worker exited with ${code}`)),
        );
      }),
  );

  await Promise.all(runs);

  return { pages };
}
