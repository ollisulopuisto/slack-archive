import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const script = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../static/self-heal.js",
  ),
  "utf8",
);

describe("the old-link redirect on the front page", () => {
  it("reads the base from the page, so it can live in a file", () => {
    // Inlining the base baked a script into every front page and forced the
    // CSP to allow unsafe-inline. The prefix is on <html data-archive-base>.
    expect(script).toContain("data-archive-base");
    expect(script).not.toContain("${");
  });

  it("marks the hop, so a page that still cannot find it stops there", () => {
    expect(script).toContain("resolved=1");
  });
});
