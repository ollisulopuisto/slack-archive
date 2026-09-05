import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";

import { EMOJIS_DIR } from "./config.js";

const { downloadURL } = vi.hoisted(() => ({
  downloadURL: vi.fn(async (_url: string, _filePath: string) => "downloaded"),
}));

vi.mock("./download-files.js", () => ({ downloadURL }));

import {
  cleanEmojiName,
  downloadAllEmoji,
  getEmojiRef,
  getEmojiUnicode,
  isEmojiUnicode,
} from "./emoji.js";

describe("getEmojiRef()", () => {
  const file = path.join(EMOJIS_DIR, "test-emoji-ref.png");

  beforeEach(() => fs.outputFileSync(file, "x"));
  afterEach(() => fs.removeSync(file));

  it("is relative to the html directory, not an absolute local path", () => {
    // An absolute /Users/... src is a broken image on every machine but the
    // one that rendered it - and the archive is published to a website.
    expect(getEmojiRef("test-emoji-ref")).toBe("emojis/test-emoji-ref.png");
  });

  it("is undefined for an emoji that was never downloaded", () => {
    expect(getEmojiRef("no-such-emoji-anywhere")).toBeUndefined();
  });
});

describe("downloadAllEmoji()", () => {
  beforeEach(() => downloadURL.mockClear());

  it("downloads every custom emoji, not only the ones in reactions", async () => {
    await downloadAllEmoji({
      party: "https://emoji.slack.com/party.gif",
      dart: "https://emoji.slack.com/dart.png",
    });

    expect(downloadURL).toHaveBeenCalledTimes(2);
    expect(downloadURL.mock.calls.map((call) => call[0])).toEqual([
      "https://emoji.slack.com/party.gif",
      "https://emoji.slack.com/dart.png",
    ]);
    expect(downloadURL.mock.calls[0][1]).toBe(
      path.join(EMOJIS_DIR, "party.gif"),
    );
  });

  it("strips a query string from the filename", async () => {
    // path.extname("x.gif?cache=1") is ".gif?cache=1". File downloads already
    // drop the query; emoji downloads did not, and the page then looked for
    // party.gif while disk had party.gif?cache=1.
    await downloadAllEmoji({
      party: "https://emoji.slack.com/party.gif?cache=1",
    });

    expect(downloadURL.mock.calls[0][1]).toBe(
      path.join(EMOJIS_DIR, "party.gif"),
    );
  });

  it("stores an alias under its own name, so :salut-2: renders too", async () => {
    await downloadAllEmoji({
      salut: "https://emoji.slack.com/salut.png",
      "salut-2": "alias:salut",
    });

    const paths = downloadURL.mock.calls.map((call) => call[1]);
    expect(paths).toContain(path.join(EMOJIS_DIR, "salut.png"));
    expect(paths).toContain(path.join(EMOJIS_DIR, "salut-2.png"));
  });

  it("skips an alias to a standard emoji rather than warning about it", async () => {
    await downloadAllEmoji({ shipit: "alias:squirrel" });

    expect(downloadURL).not.toHaveBeenCalled();
  });
});

describe("cleanEmojiName()", () => {
  it("strips wrapping colons and lowercases", () => {
    expect(cleanEmojiName(":Tada:")).toBe("tada");
    expect(cleanEmojiName(":+1:")).toBe("+1");
    expect(cleanEmojiName(":male-police-officer::skin-tone-4:")).toBe(
      "male-police-officer::skin-tone-4",
    );
  });
});

describe("isEmojiUnicode() and getEmojiUnicode()", () => {
  it("recognises standard emoji without skin tone modifiers", () => {
    expect(isEmojiUnicode("tada")).toBe(true);
    expect(isEmojiUnicode(":tada:")).toBe(true);
    expect(getEmojiUnicode("tada")).toBe("🎉");
  });

  it("recognises aliases from short_names", () => {
    expect(isEmojiUnicode("+1")).toBe(true);
    expect(isEmojiUnicode("thumbsup")).toBe(true);
    expect(getEmojiUnicode("+1")).toBe("👍");
    expect(getEmojiUnicode("thumbsup")).toBe("👍");
  });

  it("recognises skin tone variations", () => {
    expect(isEmojiUnicode("male-police-officer::skin-tone-4")).toBe(true);
    expect(isEmojiUnicode(":male-police-officer::skin-tone-4:")).toBe(true);
    expect(getEmojiUnicode("male-police-officer::skin-tone-4")).toBe("👮🏽‍♂️");
    expect(getEmojiUnicode(":male-police-officer::skin-tone-4:")).toBe("👮🏽‍♂️");

    expect(isEmojiUnicode("+1::skin-tone-2")).toBe(true);
    expect(getEmojiUnicode("+1::skin-tone-2")).toBe("👍🏻");
    expect(isEmojiUnicode("thumbsup::skin-tone-5")).toBe(true);
    expect(getEmojiUnicode("thumbsup::skin-tone-5")).toBe("👍🏾");
  });

  it("returns false / empty string for unknown names", () => {
    expect(isEmojiUnicode("not-an-emoji")).toBe(false);
    expect(getEmojiUnicode("not-an-emoji")).toBe("");
  });
});

