import { describe, expect, it } from "vitest";

import { selfHealingRedirect } from "./self-heal.js";

describe("the old-link redirect on the front page", () => {
  it("sends the reader to a real address", () => {
    // It shipped with a literal ${base} in the URL, so every permalink from
    // before the archive had per-page URLs - the ones pasted around Slack and
    // the ones the bot generates - landed on /${base}C123-4.html and 404ed.
    const script = selfHealingRedirect("html/");

    expect(script).toContain('"html/" + channel');
    expect(script).not.toContain("${");
  });

  it("works from a page that is already beside the others", () => {
    expect(selfHealingRedirect("")).toContain('"" + channel');
  });

  it("marks the hop, so a page that still cannot find it stops there", () => {
    // One hop, then an honest landing. Without the mark a message that is
    // genuinely missing bounces between the two pages forever.
    expect(selfHealingRedirect("html/")).toContain("resolved=1");
  });
});
