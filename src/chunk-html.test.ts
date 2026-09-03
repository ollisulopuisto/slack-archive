import { beforeEach, describe, expect, it } from "vitest";

import { chunkMessagesHtml, setRenderContext } from "./create-html.js";
import { emptyRenderContext } from "./render-context.js";

// 2020-03-01 00:00 UTC is 1583020800; the others hang off it.
const FEB_29 = "1582934400.000000"; // 2020-02-29 00:00 UTC
const MAR_11 = "1583884800.000000"; // 2020-03-11 00:00 UTC
const MAR_12 = "1583971200.000000"; // 2020-03-12 00:00 UTC

const MARCH_GAP = [{ from: "2020-03-01", to: "2020-03-10", days: 10 }];

// Newest first, as the archive stores them.
const MESSAGES = [
  { ts: MAR_12, text: "newest" },
  { ts: MAR_11, text: "middle" },
  { ts: FEB_29, text: "oldest" },
];

beforeEach(() => {
  setRenderContext(emptyRenderContext());
});

describe("chunkMessagesHtml()", () => {
  it("renders the messages oldest first, each with its own anchor", () => {
    const html = chunkMessagesHtml(MESSAGES as never, "C1");

    expect(html.indexOf(`id="${FEB_29}"`)).toBeLessThan(
      html.indexOf(`id="${MAR_12}"`),
    );
    expect(html).toContain("newest");
  });

  it("draws a gap divider where the archive stops and starts again", () => {
    setRenderContext({ ...emptyRenderContext(), gaps: MARCH_GAP });

    const html = chunkMessagesHtml(MESSAGES as never, "C1");

    expect(html).toContain("days missing from the archive here");
    expect(html.indexOf("days missing")).toBeGreaterThan(
      html.indexOf(`id="${FEB_29}"`),
    );
  });

  it("draws the divider at the top of a chunk, using the message that sits in the chunk below", () => {
    setRenderContext({ ...emptyRenderContext(), gaps: MARCH_GAP });

    const html = chunkMessagesHtml(
      [MESSAGES[0], MESSAGES[1]] as never,
      "C1",
      FEB_29,
    );

    expect(html).toContain("days missing from the archive here");
    expect(html.indexOf("days missing")).toBeLessThan(
      html.indexOf(`id="${MAR_11}"`),
    );
  });

  it("says so, rather than staying silent, when the channel was never used", () => {
    expect(chunkMessagesHtml([], "C1")).toContain(
      "No messages were ever sent!",
    );
  });
});
