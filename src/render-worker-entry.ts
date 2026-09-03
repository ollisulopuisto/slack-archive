import { parentPort, workerData } from "worker_threads";

import { Channel } from "./interfaces.js";
import { RenderContext } from "./render-context.js";
import { ChannelPlan } from "./render-plan.js";
import { renderPages, setRenderContext } from "./create-html.js";
import { ChunkData } from "./chunk-types.js";

/**
 * One worker's share of the pages.
 *
 * It renders with the context the parent built - counted once, there - and
 * reads only the byte ranges of the pages it was given. It reports chunk data
 * back to the parent process, which writes the files (to avoid file contention
 * across workers).
 */
const { context, channels, plans } = workerData as {
  context: RenderContext;
  channels: Array<Channel>;
  plans: Array<ChannelPlan>;
  worker: number;
};

// Several workers writing spinner frames to one terminal is illegible.
process.env.SLACK_ARCHIVE_QUIET = "1";

setRenderContext(context);

renderPages(
  channels,
  plans,
  async (channelId: string, chunkIndex: number, chunkData: ChunkData) => {
    parentPort?.postMessage({
      type: "chunk",
      channelId,
      chunkIndex,
      chunkData,
    });
  },
).then(() => {
  parentPort?.postMessage({ type: "done" });
});
