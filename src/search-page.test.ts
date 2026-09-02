import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

describe("the search page's scripts", () => {
  const template = fs.readFileSync(
    path.join(here, "../static/search.html"),
    "utf8",
  );
  const search = fs.readFileSync(path.join(here, "search.ts"), "utf8");

  it("does not compile JSX in the browser and does not fetch a CDN", () => {
    expect(template).not.toContain("text/babel");
    expect(template).not.toContain("babel");
    expect(search).not.toContain("jsdelivr");
    expect(search).not.toContain("cdn.");
    expect(search).not.toContain("getScript(");
  });

  it("loads the app as a file, so a CSP can forbid inline script", () => {
    expect(template).toContain("<!-- search-app -->");
    expect(search).toContain('"<!-- search-app -->"');
  });
});
