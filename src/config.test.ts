import { describe, it, expect } from "vitest";

import { normalizeBaseUrl } from "./config.js";

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
