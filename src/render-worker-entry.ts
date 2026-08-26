import { parentPort, workerData } from "worker_threads";

import { Channel } from "./interfaces.js";
import { RenderContext } from "./render-context.js";
import { renderChannelPages, setRenderContext } from "./create-html.js";
import { getPageIndex } from "./search.js";

/**
 * One worker's share of the channel pages.
 *
 * It renders with the context the parent built - counted once, there - and
 * reports back the only thing it learned that the parent needs: which
 * timestamp starts which page, for the permalink index.
 */
const { context, channels } = workerData as {
  context: RenderContext;
  channels: Array<Channel>;
  worker: number;
};

// Several workers writing spinner frames to one terminal is illegible.
process.env.SLACK_ARCHIVE_QUIET = "1";

setRenderContext(context);

renderChannelPages(channels).then(() => {
  parentPort?.postMessage(getPageIndex());
});
