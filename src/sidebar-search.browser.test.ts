import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { chromium, type Browser } from "playwright-core";

import { contentSecurityPolicy } from "./csp.js";

// Every archive page has a search box at the top of the sidebar: a GET form to
// search.html. The page's own Content-Security-Policy decides whether the
// browser lets that form submit at all - with form-action 'none' typing a word
// and pressing Enter did nothing. That is the browser's decision, so it is
// tested in a real browser with the policy the pages ship with.
function page(csp: string): string {
  return `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head><body>
<form class="channel-search" action="search.html" method="get" role="search">
<input type="search" name="q" aria-label="Search every message">
<button type="submit" aria-label="Search">⌕</button>
</form></body></html>`;
}

let browser: Browser;
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/search.html") {
      res.end("<!doctype html><title>Message Search</title>");
      return;
    }
    const csp = url.searchParams.get("csp") || contentSecurityPolicy({});
    res.end(page(csp));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
});

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

describe("sidebar search box", () => {
  it("takes the query to the search page when Enter is pressed", async () => {
    const tab = await browser.newPage();
    await tab.goto(`${base}/index.html`);
    await tab.fill('input[name="q"]', "moneta");
    await tab.press('input[name="q"]', "Enter");
    await tab.waitForURL(/\/search\.html\?q=moneta$/, { timeout: 5000 });
    expect(new URL(tab.url()).searchParams.get("q")).toBe("moneta");
    await tab.close();
  });

  it("is blocked by a policy that forbids forms, which is what broke it", async () => {
    const strict = contentSecurityPolicy({}).replace(
      /form-action [^;]+/,
      "form-action 'none'",
    );
    const tab = await browser.newPage();
    await tab.goto(`${base}/index.html?csp=${encodeURIComponent(strict)}`);
    const violation = tab.evaluate(
      () =>
        new Promise<string>((resolve) =>
          document.addEventListener("securitypolicyviolation", (e) =>
            resolve(e.violatedDirective),
          ),
        ),
    );
    await tab.fill('input[name="q"]', "moneta");
    // requestSubmit, not a key press: Playwright would wait for a navigation
    // the policy never lets start.
    await tab.evaluate(() => document.querySelector("form")!.requestSubmit());
    expect(await violation).toBe("form-action");
    expect(new URL(tab.url()).pathname).toBe("/index.html");
    await tab.close();
  });
});
