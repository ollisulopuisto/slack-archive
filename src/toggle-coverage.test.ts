import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "create-html.tsx"),
  "utf8",
);

/** The page components that show numbers the missing days would change. */
const PAGES_WITH_NUMBERS = [
  "IndexPage",
  "StatsPage",
  "ChannelPage",
  "ProfilePage",
  "BotsPage",
];

describe("the speculative toggle", () => {
  it("is on every page that carries a speculative number", () => {
    // A page with a speculative number and no toggle is the worst of both: a
    // number that cannot be revealed, and one that never changes so nobody
    // learns it could. The front page shipped exactly that for one render.
    const missing = PAGES_WITH_NUMBERS.filter((page) => {
      const start = source.indexOf(`const ${page}: React.FunctionComponent`);
      const body = source.slice(start, source.indexOf("\n};", start));

      return body.includes("speculative=") && !body.includes("SpeculateToggle");
    });

    expect(missing).toEqual([]);
  });

  it("is never on a page with nothing to speculate about", () => {
    const start = source.indexOf("const NamesPage: React.FunctionComponent");
    const body = source.slice(start, source.indexOf("\n};", start));

    expect(body).not.toContain("SpeculateToggle");
  });
});
