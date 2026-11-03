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

  it("links to the media browser in the sidebar and front page", () => {
    expect(source).toContain("href={`${root}search.html?mode=media`}");
  });

  it("secures all target=_blank links with rel noopener noreferrer", () => {
    // Links opening in a new tab without noopener/noreferrer expose the archive
    // to reverse tabnabbing and window.opener access.
    const blankLinks = source.match(/<a[^>]*target="_blank"[^>]*>/g) || [];
    expect(blankLinks.length).toBeGreaterThan(0);
    for (const link of blankLinks) {
      expect(link).toMatch(/rel="(?:noopener noreferrer|noreferrer)"/);
    }
  });
});
