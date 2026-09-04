import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// The shipped file, the way the browser gets it: the same tests read the
// search page's scripts and the front page's self-heal, because a test that
// re-implements the logic in TypeScript would be testing the test.
const script = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../static/channel.js",
  ),
  "utf8",
);

describe("the channel entry page's infinite scroll", () => {
  it("fetches the server-rendered chunks from the channel's own directory", () => {
    expect(script).toContain('channelId + "/chunk-" + i + ".json"');
  });

  it("resolves permalinks against the chunk boundaries in pages.js", () => {
    expect(script).toContain("window.ARCHIVE_CHUNKS");
    expect(script).toContain("oldestTs");
    expect(script).toContain("newestTs");
  });

  it("walks the newer chunks when a thread reply is not in its range's chunk", () => {
    // A reply's timestamp can sit above its parent's chunk; the parent is in
    // a newer chunk, so a miss must keep walking up, not stop at the first
    // chunk without the message.
    expect(script).toContain("tryAt(i + 1)");
  });

  it("writes the visible message back into the URL", () => {
    expect(script).toContain('history.replaceState(null, "", "#" + ts)');
  });

  it("keeps the reader put when older messages are inserted above", () => {
    expect(script).toContain("scrollBy");
    expect(script).toContain("loadChunk(maxLoaded + 1)");
    expect(script).toContain("loadChunk(minLoaded - 1)");
  });

  it("lands a bare visit on the newest message, as the static pages did", () => {
    expect(script).toContain("documentElement.scrollHeight");
  });

  it("degrades to the static pages without the network", () => {
    // file:// has no fetch for these files: the reader is handed the static
    // pages instead of a blank channel.
    expect(script).toContain('"file:"');
    expect(script).toContain('channelId + "-0.html"');
  });

  it("survives one broken chunk without sinking the loaded conversation", () => {
    expect(script).toContain("chunk-broken");
  });

  it("answers the back button from the hash, not from a pixel position", () => {
    expect(script).toContain("scrollRestoration");
    expect(script).toContain("popstate");
  });
});
