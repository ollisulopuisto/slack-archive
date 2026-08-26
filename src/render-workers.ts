import os from "os";
import { Worker } from "worker_threads";

import { Channel } from "./interfaces.js";
import { RenderContext } from "./render-context.js";
import { ChannelPlan } from "./render-plan.js";

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
export function defaultWorkerCount(requested?: number): number {
  if (requested && requested > 0) return requested;

  // One core left for the operating system, and a ceiling: past about eight
  // the disk and the writes are the limit, not the CPU.
  return Math.max(1, Math.min(8, (os.cpus()?.length || 2) - 1));
}

export async function renderPagesInWorkers(
  context: RenderContext,
  channels: Array<Channel>,
  buckets: Array<Array<ChannelPlan>>,
): Promise<void> {
  const workerUrl = new URL("./render-worker-entry.js", import.meta.url);

  await Promise.all(
    buckets.map(
      (plans, i) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(workerUrl, {
            // The same flags this process was given: the worker builds its own
            // config from them, and --html-exclude-kinds decides what may be
            // written at all.
            argv: process.argv.slice(2),
            workerData: { context, channels, plans, worker: i },
          });

          worker.on("error", reject);
          worker.on("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`A render worker exited with ${code}`)),
          );
        }),
    ),
  );
}
