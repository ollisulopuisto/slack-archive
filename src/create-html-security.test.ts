import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "create-html.tsx"),
  "utf8",
);

describe("the rendered pages", () => {
  it("do not put Slack's private file URL on the page", () => {
    // url_private carries ?t= tokens and only works while Slack still has the
    // file. The archived copy is what the page should link.
    expect(source).not.toMatch(/href = file\.url_private/);
  });

  it("does not inline scroll.js", () => {
    expect(source).not.toMatch(
      /dangerouslySetInnerHTML=\{\{ __html: messagesJs \}\}/,
    );
  });

  it("does not inline the old-link redirect", () => {
    expect(source).not.toMatch(/selfHealingRedirect/);
  });
});
