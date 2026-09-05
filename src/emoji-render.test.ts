import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

import { EMOJIS_DIR } from "./config.js";
import { splitEmoji } from "./emoji-render.js";
import { getEmojiIndex } from "./emoji.js";

const INDEX = {
  unicode: { tada: "🎉" },
  custom: { "handshake-3d": "emojis/handshake-3d.png" },
};

describe("splitEmoji()", () => {
  it("makes a custom emoji a part of its own, to be drawn as a picture", () => {
    // The search page prints the raw message text, so this was the one place
    // in the archive where :handshake-3d: stayed :handshake-3d:.
    expect(splitEmoji("kiitos :handshake-3d:", INDEX)).toEqual([
      { kind: "text", text: "kiitos " },
      { kind: "image", name: "handshake-3d", ref: "emojis/handshake-3d.png" },
    ]);
  });

  it("keeps a standard emoji inside the text, because it is a character", () => {
    expect(splitEmoji("no :tada: sitten", INDEX)).toEqual([
      { kind: "text", text: "no 🎉 sitten" },
    ]);
  });

  it("leaves a shortcode nothing was downloaded for exactly as typed", () => {
    // Better the shortcode than an empty box: the text still says what was
    // meant. The rendered pages do the same.
    expect(splitEmoji("mitä :no-such-emoji-here:", INDEX)).toEqual([
      { kind: "text", text: "mitä :no-such-emoji-here:" },
    ]);
  });

  it("is not fooled by a time of day", () => {
    // 12:30:45 contains :30:, which is the shape of a shortcode and a clock.
    expect(
      splitEmoji("klo 12:30:45", { custom: { "30": "emojis/30.png" } }),
    ).toEqual([{ kind: "text", text: "klo 12:30:45" }]);
  });

  it("finds every emoji in a line, not only the first", () => {
    expect(
      splitEmoji(":handshake-3d: ja :handshake-3d:", INDEX).filter(
        (part) => part.kind === "image",
      ),
    ).toHaveLength(2);
  });

  it("matches a shortcode however it was capitalised", () => {
    expect(splitEmoji(":Handshake-3D:", INDEX)).toEqual([
      { kind: "image", name: "handshake-3d", ref: "emojis/handshake-3d.png" },
    ]);
  });

  it("handles emoji with skin tone modifiers", () => {
    expect(
      splitEmoji("hei :male-police-officer::skin-tone-4:!", {
        unicode: { "male-police-officer::skin-tone-4": "👮🏽‍♂️" },
      }),
    ).toEqual([{ kind: "text", text: "hei 👮🏽‍♂️!" }]);
  });

  it("handles back-to-back emoji shortcodes", () => {
    expect(splitEmoji(":tada::tada:", INDEX)).toEqual([
      { kind: "text", text: "🎉🎉" },
    ]);
  });

  it("knows nothing without an index, and says so by saying nothing", () => {
    // An archive built before html/emoji.js existed still opens; its search
    // results read the way they always did.
    expect(splitEmoji("kiitos :handshake-3d:", {})).toEqual([
      { kind: "text", text: "kiitos :handshake-3d:" },
    ]);
  });
});

describe("getEmojiIndex()", () => {
  const file = path.join(EMOJIS_DIR, "test-emoji-index.png");

  beforeEach(() => fs.outputFileSync(file, "x"));
  afterEach(() => fs.removeSync(file));

  it("names every custom emoji on disk the way the pages refer to it", () => {
    expect(getEmojiIndex().custom!["test-emoji-index"]).toBe(
      "emojis/test-emoji-index.png",
    );
  });

  it("carries the standard emoji as the characters they mean", () => {
    expect(getEmojiIndex().unicode!["tada"]).toBe("🎉");
  });

  it("includes skin-tone variations in the unicode index", () => {
    expect(getEmojiIndex().unicode!["male-police-officer::skin-tone-4"]).toBe(
      "👮🏽‍♂️",
    );
    expect(getEmojiIndex().unicode!["+1::skin-tone-2"]).toBe("👍🏻");
  });
});

describe("the search page", () => {
  const template = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../static/search.html",
    ),
    "utf8",
  );
  const search = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "search.ts"),
    "utf8",
  );

  it("renders a result's text through the emoji splitter", () => {
    // The whole point of the index and the module below is this one line: a
    // result that prints message.m_text raw shows shortcodes again.
    const app = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "search-app.tsx"),
      "utf8",
    );

    expect(app).toContain("<EmojiText text={message.m_text} query={query} />");
  });

  it("has both halves filled in when it is built", () => {
    // A placeholder nothing replaces is an HTML comment, and the page then
    // fails silently: no emoji, no error, no way to tell which half is missing.
    for (const placeholder of [
      "<!-- emoji-index -->",
      "<!-- emoji-render -->",
    ]) {
      expect(template).toContain(placeholder);
      expect(search).toContain(`"${placeholder}"`);
    }
  });
});
