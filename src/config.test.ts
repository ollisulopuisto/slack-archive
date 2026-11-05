import { describe, it, expect } from "vitest";

import path from "path";
import {
  AVATARS_DIR,
  DATA_DIR,
  FILES_DIR,
  HTML_DIR,
  getAvatarFilePath,
  getAvatarHistoryFilePath,
  getChannelDataFilePath,
  getChannelEntryPath,
  getChannelStatsFilePath,
  getChannelUploadFilePath,
  getChunkDirPath,
  getChunkFilePath,
  getHTMLFilePath,
  getProfileFilePath,
  normalizeBaseUrl,
  searchIndexes,
} from "./config.js";

describe("normalizeBaseUrl", () => {
  it("leaves an unset value empty, so attachments stay relative", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
  });

  it("adds the separating slash", () => {
    expect(normalizeBaseUrl("https://morttinen.pylly.club/media")).toBe(
      "https://morttinen.pylly.club/media/",
    );
  });

  it("does not double one that is already there", () => {
    expect(normalizeBaseUrl("https://morttinen.pylly.club/media/")).toBe(
      "https://morttinen.pylly.club/media/",
    );
    expect(normalizeBaseUrl("https://morttinen.pylly.club/media///")).toBe(
      "https://morttinen.pylly.club/media/",
    );
  });
});

describe("getChannelUploadFilePath traversal protection", () => {
  it("neutralizes traversal characters in channelId and fileName", () => {
    const safePath = getChannelUploadFilePath(
      "../../evilChannel",
      "../../evilFile.png",
    );
    expect(safePath).toBe(path.join(FILES_DIR, "evilChannel", "evilFile.png"));
  });

  it("falls back to safe path if components are purely traversal dots", () => {
    const safePath = getChannelUploadFilePath("..", "..");
    expect(safePath).toBe(path.join(FILES_DIR, "unknown", "file"));
  });
});

describe("getChunkDirPath", () => {
  it("returns the correct directory path for a channel", () => {
    expect(getChunkDirPath("C12345")).toContain("slack-archive/html/C12345");
  });

  it("neutralizes traversal characters in channelId", () => {
    const safePath = getChunkDirPath("../../evilChannel");
    expect(safePath).toBe(path.join(HTML_DIR, "evilChannel"));
  });

  it("falls back to safe directory if channelId is purely traversal dots", () => {
    const safePath = getChunkDirPath("..");
    expect(safePath).toBe(path.join(HTML_DIR, "unknown"));
  });
});

describe("getChunkFilePath", () => {
  it("returns the correct file path for a channel and chunk index", () => {
    expect(getChunkFilePath("C12345", 0)).toContain(
      "slack-archive/html/C12345/chunk-0.json",
    );
    expect(getChunkFilePath("C12345", 5)).toContain(
      "slack-archive/html/C12345/chunk-5.json",
    );
  });

  it("handles negative or invalid chunk index safely", () => {
    expect(getChunkFilePath("C12345", -1)).toBe(
      path.join(HTML_DIR, "C12345", "chunk-0.json"),
    );
  });
});

describe("getChannelDataFilePath traversal protection", () => {
  it("neutralizes traversal in channelId", () => {
    const safePath = getChannelDataFilePath("../../evilChannel");
    expect(safePath).toBe(path.join(DATA_DIR, "evilChannel.json"));
  });

  it("falls back to unknown.json for purely traversal dots", () => {
    const safePath = getChannelDataFilePath("..");
    expect(safePath).toBe(path.join(DATA_DIR, "unknown.json"));
  });
});

describe("getChannelStatsFilePath traversal protection", () => {
  it("neutralizes traversal in channelId", () => {
    const safePath = getChannelStatsFilePath("../../evilChannel");
    expect(safePath).toBe(path.join(HTML_DIR, "channel-evilChannel.html"));
  });

  it("falls back to channel-unknown.html for purely traversal dots", () => {
    const safePath = getChannelStatsFilePath("..");
    expect(safePath).toBe(path.join(HTML_DIR, "channel-unknown.html"));
  });
});

describe("getProfileFilePath traversal protection", () => {
  it("neutralizes traversal in userId", () => {
    const safePath = getProfileFilePath("../../evilUser");
    expect(safePath).toBe(path.join(HTML_DIR, "user-evilUser.html"));
  });

  it("falls back to user-unknown.html for purely traversal dots", () => {
    const safePath = getProfileFilePath("..");
    expect(safePath).toBe(path.join(HTML_DIR, "user-unknown.html"));
  });
});

describe("getChannelEntryPath traversal protection", () => {
  it("neutralizes traversal in channelId", () => {
    const safePath = getChannelEntryPath("../../evilChannel");
    expect(safePath).toBe(path.join(HTML_DIR, "evilChannel.html"));
  });

  it("falls back to unknown.html for purely traversal dots", () => {
    const safePath = getChannelEntryPath("..");
    expect(safePath).toBe(path.join(HTML_DIR, "unknown.html"));
  });
});

describe("getHTMLFilePath traversal protection", () => {
  it("neutralizes traversal in channelId", () => {
    const safePath = getHTMLFilePath("../../evilChannel", 1);
    expect(safePath).toBe(path.join(HTML_DIR, "evilChannel-1.html"));
  });

  it("falls back to unknown-0.html for purely traversal dots and handles negative index", () => {
    const safePath = getHTMLFilePath("..", -5);
    expect(safePath).toBe(path.join(HTML_DIR, "unknown-0.html"));
  });
});

describe("searchIndexes", () => {
  it("builds both indexes when nothing is said", () => {
    // The default has to keep a folder-of-files archive searchable: a database
    // read over HTTP range requests cannot be read from file://, and an
    // archive somebody unzips and double-clicks is what this project is for.
    expect(searchIndexes("")).toEqual({ db: true, js: true });
  });

  it("builds only the database when asked for it", () => {
    // The published site is served over HTTPS and read on phones, where the
    // 100 MB JavaScript index is what kills the tab.
    expect(searchIndexes("db")).toEqual({ db: true, js: false });
  });

  it("builds only the JavaScript index when asked for it", () => {
    expect(searchIndexes("js")).toEqual({ db: false, js: true });
  });

  it("refuses a word it does not know rather than guessing", () => {
    // Silently building nothing, or the wrong one, is a search page that
    // loads and then cannot answer anything.
    expect(() => searchIndexes("sqlite")).toThrow(/--search-index/);
  });
});

describe("getAvatarFilePath traversal protection", () => {
  it("neutralizes traversal characters in userId", () => {
    const safePath = getAvatarFilePath("../../evil", ".png");
    expect(safePath).toBe(path.join(AVATARS_DIR, "evil.png"));
  });

  it("neutralizes traversal characters in extension", () => {
    const safePath = getAvatarFilePath("U123", "/../../evil.png");
    expect(safePath).toBe(path.join(AVATARS_DIR, "U123.evil.png"));
  });

  it("falls back to safe path if user id is purely traversal dots", () => {
    const safePath = getAvatarFilePath("..", ".png");
    expect(safePath).toBe(path.join(AVATARS_DIR, "avatar.png"));
  });
});

describe("getAvatarHistoryFilePath traversal protection", () => {
  it("neutralizes traversal characters in userId and date", () => {
    const safePath = getAvatarHistoryFilePath(
      "../../evilUser",
      "../../evilDate",
      ".jpg",
    );
    expect(safePath).toBe(
      path.join(AVATARS_DIR, "history", "evilUser", "evilDate.jpg"),
    );
  });

  it("falls back to safe path if components are purely traversal dots", () => {
    const safePath = getAvatarHistoryFilePath("..", "..", ".jpg");
    expect(safePath).toBe(
      path.join(AVATARS_DIR, "history", "unknown", "avatar.jpg"),
    );
  });
});
