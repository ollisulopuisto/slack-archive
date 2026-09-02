import { describe, expect, it } from "vitest";

import { archiveLinkContext } from "./slack-links.js";
import { escapeHtml, renderMessageHtml } from "./message-html.js";

const empty = {
  users: {} as any,
  linkContext: archiveLinkContext({}),
  base: "../",
};

describe("escapeHtml", () => {
  it("turns markup into text", () => {
    expect(escapeHtml("<img src=x onerror=alert(1)>")).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
  });
});

describe("renderMessageHtml", () => {
  it("does not keep raw HTML from a message", () => {
    // escapeHTML: false plus dangerouslySetInnerHTML meant any workspace
    // member could post an <img onerror> and run script in the archive.
    const html = renderMessageHtml("<img src=x onerror=alert(1)>", empty);

    expect(html).not.toMatch(/<img src=x/i);
    expect(html).toContain("&lt;img");
  });

  it("escapes a display name used in a mention", () => {
    // slack-markdown inserts the user callback as HTML, even when escapeHTML
    // is on, so a display name of <img...> is enough on its own.
    const html = renderMessageHtml("<@U1>", {
      ...empty,
      users: {
        U1: {
          id: "U1",
          profile: { display_name: "<img src=x onerror=alert(1)>" },
        },
      } as any,
    });

    expect(html).not.toMatch(/<img src=x/i);
    expect(html).toContain("@");
    expect(html).toContain("&lt;img");
  });
});
