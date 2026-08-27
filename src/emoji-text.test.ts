import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";

import { EMOJIS_DIR } from "./config.js";
import { renderEmojiInHtml } from "./emoji-text.js";

describe("emoji in message text", () => {
  const file = path.join(EMOJIS_DIR, "handshake-3d.png");

  beforeEach(() => fs.outputFileSync(file, "x"));
  afterEach(() => fs.removeSync(file));

  it("shows a custom emoji as the picture it is", () => {
    // Reactions have rendered custom emoji since the beginning; message text
    // showed the shortcode. The same emoji was a picture below the message and
    // `:handshake-3d:` inside it.
    expect(renderEmojiInHtml("<div>kiitos :handshake-3d:</div>", "../")).toBe(
      '<div>kiitos <img class="emoji" src="../emojis/handshake-3d.png" alt=":handshake-3d:" title=":handshake-3d:"></div>',
    );
  });

  it("shows a standard emoji as its character", () => {
    expect(renderEmojiInHtml("<div>:tada:</div>", "")).toBe("<div>🎉</div>");
  });

  it("leaves a shortcode nothing was downloaded for alone", () => {
    // Better the shortcode than an empty box: the text still says what was
    // meant, which is more than a missing image does.
    expect(renderEmojiInHtml("<div>:no-such-emoji-here:</div>", "")).toBe(
      "<div>:no-such-emoji-here:</div>",
    );
  });

  it("does not touch what is inside a tag", () => {
    // A link to a page whose name contains a colon pair is a URL, not an
    // emoji, and rewriting it silently breaks the link.
    const html = '<a href="https://example.com/:tada:/x">:tada:</a>';

    expect(renderEmojiInHtml(html, "")).toBe(
      '<a href="https://example.com/:tada:/x">🎉</a>',
    );
  });

  it("does not touch code, which is quoted for a reason", () => {
    expect(renderEmojiInHtml("<code>a[:tada:]</code>", "")).toBe(
      "<code>a[:tada:]</code>",
    );
    expect(renderEmojiInHtml("<pre>x = :tada:</pre>", "")).toBe(
      "<pre>x = :tada:</pre>",
    );
  });

  it("is not fooled by a time of day", () => {
    // 12:30:45 contains :30:, and :30: is a shortcode shape. The digits either
    // side are what say it is a clock.
    expect(renderEmojiInHtml("<div>klo 12:30:45</div>", "")).toBe(
      "<div>klo 12:30:45</div>",
    );
  });

  it("renders every emoji in a line, not only the first", () => {
    expect(renderEmojiInHtml("<div>:tada: ja :tada:</div>", "")).toBe(
      "<div>🎉 ja 🎉</div>",
    );
  });
});
