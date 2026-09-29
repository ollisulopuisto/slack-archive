import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, type Browser } from "playwright-core";

// A permalink has to survive being opened. channel.js scrolls to the #ts and
// then writes whatever message sits at its reading line back into the URL, so
// if the jump lands a message below that line the URL silently changes to the
// message above it. The link in the search results then opens on a different
// message, and a copied link drifts one message older each time it is opened.
//
// That is geometry - style.css deciding where the jump lands, channel.js
// deciding where the line is - so it is tested in a real browser with the
// shipped files, not by reading their text.
const staticDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../static",
);
const css = fs.readFileSync(path.join(staticDir, "style.css"), "utf8");
const script = fs.readFileSync(path.join(staticDir, "channel.js"), "utf8");

const tsAt = (i: number) => `${1691040000 + i * 60}.000100`;

const gutters = Array.from(
  { length: 200 },
  (_, i) =>
    `<div class="message-gutter" id="${tsAt(i)}"><div></div><div>` +
    `<span class="sender">user${i}</span> ` +
    `<a class="timestamp" href="#${tsAt(i)}">t</a><br>` +
    `<div class="text"><div>message ${i}</div></div></div></div>`,
).join("");

const boundaries = { C1: [{ oldestTs: tsAt(0), newestTs: tsAt(199) }] };

// The entry page's shape as renderChannelEntry draws it: sticky header with
// name, creator, stats link, topic and month picker, then the empty list.
const page = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width">
<style>${css}</style></head><body><div class="page">
<div class="header"><h1>general</h1>
<span class="created">Created by someone on a day</span>
<span class="created"><a href="#">Ten years of this channel</a></span>
<p class="topic">topic</p>
<div class="pagination"><details class="calendar"><summary>Jump to a month</summary></details></div>
</div>
<div class="messages-list" id="channel-messages" data-channel-id="C1" data-chunks="1"></div>
<script>window.ARCHIVE_CHUNKS = ${JSON.stringify(boundaries)};</script>
<script>${script}</script>
</div></body></html>`;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

describe("opening a permalink on the channel entry page", () => {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    it(`keeps the linked message in the URL (${viewport.name})`, async () => {
      const tab = await browser.newPage({ viewport });
      await tab.route("http://archive.test/**", (route) =>
        route.request().url().endsWith(".json")
          ? route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({ html: gutters }),
            })
          : route.fulfill({ contentType: "text/html", body: page }),
      );

      const target = tsAt(100);
      await tab.goto(`http://archive.test/C1.html#${target}`);
      await tab.waitForFunction(
        (ts) => document.getElementById(ts) !== null,
        target,
      );
      // Past the scroll handler's 300 ms throttle, so a rewrite would be seen.
      await tab.waitForTimeout(800);

      const after = await tab.evaluate((ts) => {
        const header = document.querySelector(".header")!;
        return {
          hash: location.hash,
          top: document.getElementById(ts)!.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
        };
      }, target);

      expect(after.hash).toBe(`#${target}`);
      // And it is on screen below the sticky header, not under it.
      expect(after.top).toBeGreaterThanOrEqual(after.headerBottom);
      await tab.close();
    }, 20000);
  }
});
