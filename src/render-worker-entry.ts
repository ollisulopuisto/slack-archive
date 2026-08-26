import { parentPort, workerData } from "worker_threads";

import { Channel } from "./interfaces.js";
import { RenderContext } from "./render-context.js";
import { ChannelPlan } from "./render-plan.js";
import { renderPages, setRenderContext } from "./create-html.js";

/**
 * One worker's share of the pages.
 *
 * It renders with the context the parent built - counted once, there - and
 * reads only the byte ranges of the pages it was given. It reports nothing
 * back: the permalink index is derived from the plan by the parent, in page
 * order, which is one fewer thing that can arrive out of sequence.
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

renderPages(channels, plans).then(() => {
  parentPort?.postMessage("done");
});
