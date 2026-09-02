import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "./csp.js";

describe("contentSecurityPolicy", () => {
  it("allows scripts only from this origin, including no inline ones", () => {
    const csp = contentSecurityPolicy({});

    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it("lets a separate files origin serve images and media", () => {
    const csp = contentSecurityPolicy({
      filesBaseUrl: "https://cdn.example/media/",
    });

    expect(csp).toContain("https://cdn.example");
    expect(csp).toMatch(/img-src[^;]*https:\/\/cdn\.example/);
    expect(csp).toMatch(/media-src[^;]*https:\/\/cdn\.example/);
  });

  it("does not open img-src to the world when files stay beside the pages", () => {
    expect(contentSecurityPolicy({ filesBaseUrl: "" })).not.toContain("https:");
  });
});
