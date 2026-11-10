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

  it("refuses non-http(s) schemes like javascript:, data:, or file: in filesBaseUrl", () => {
    const jsCsp = contentSecurityPolicy({
      filesBaseUrl: "javascript:alert(1)",
    });
    expect(jsCsp).not.toContain("javascript:");

    const dataCsp = contentSecurityPolicy({
      filesBaseUrl: "data:text/html,<script>alert(1)</script>",
    });
    // data: is in img-src for inline avatars, but must not be added to media-src or duplicated
    expect(dataCsp).toMatch(/media-src 'self'(;|$)/);

    const fileCsp = contentSecurityPolicy({
      filesBaseUrl: "file:///etc/passwd",
    });
    expect(fileCsp).not.toContain("file:");
  });

  it("lets the sidebar search box submit to the search page, and nowhere else", () => {
    // Every page has a GET form to search.html. form-action 'none' blocked it,
    // so typing in the box and pressing Enter did nothing.
    const csp = contentSecurityPolicy({});

    expect(csp).toMatch(/form-action 'self'(;|$)/);
    expect(csp).not.toMatch(/form-action[^;]*'none'/);
    expect(csp).not.toMatch(/form-action[^;]*https?:/);
  });
});
