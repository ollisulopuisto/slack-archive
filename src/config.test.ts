import { describe, it, expect } from "vitest";

import { normalizeBaseUrl, searchIndexes } from "./config.js";

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
