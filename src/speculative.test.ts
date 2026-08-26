import { describe, expect, it } from "vitest";

import {
  speculativeTotals,
  estimatesByYear,
  shareOfMissing,
  shareOfRange,
} from "./speculative.js";

const estimates = {
  "2022-02": { estimate: 100, low: 80, high: 120, missingDays: 28 },
  "2022-03": { estimate: 200, low: 150, high: 250, missingDays: 31 },
  "2024-06": { estimate: 50, low: 40, high: 60, missingDays: 30 },
};

describe("estimatesByYear()", () => {
  it("adds a year's missing months together", () => {
    expect(estimatesByYear(estimates)).toEqual({
      "2022": { estimate: 300, low: 230, high: 370, missingDays: 59 },
      "2024": { estimate: 50, low: 40, high: 60, missingDays: 30 },
    });
  });
});

describe("speculativeTotals()", () => {
  it("says what the archive might hold, without touching what it does hold", () => {
    const totals = speculativeTotals(
      { messages: 1000, reactions: 250 },
      estimates,
    );

    expect(totals.messages).toBe(1350);
    // Reactions are estimated at the rate the archive actually shows: a
    // quarter of a message each.
    expect(totals.reactions).toBe(338);
  });

  it("has nothing to add when nothing is missing", () => {
    expect(speculativeTotals({ messages: 10, reactions: 2 }, {})).toEqual({
      messages: 10,
      reactions: 2,
      missingMessages: 0,
      missingReactions: 0,
    });
  });

  it("does not divide by an empty archive", () => {
    expect(
      speculativeTotals({ messages: 0, reactions: 0 }, estimates).reactions,
    ).toBe(0);
  });
});

describe("shareOfMissing()", () => {
  it("gives somebody the share of the gap they had of the archive", () => {
    expect(shareOfMissing(250, 1000, 400)).toBe(100);
  });

  it("has nothing to share out when nothing is missing or nobody talked", () => {
    expect(shareOfMissing(250, 1000, 0)).toBe(0);
    expect(shareOfMissing(0, 0, 400)).toBe(0);
  });
});

describe("a share of the missing days", () => {
  const range = { estimate: 1000, low: 800, high: 1300 };

  it("carries the interval the total was measured with", () => {
    // A tenth of the archive is assumed to be a tenth of what is missing, so
    // the low and high ends move with the total's, not with a made-up spread.
    expect(shareOfRange(100, 1000, range)).toEqual({
      estimate: 100,
      low: 80,
      high: 130,
    });
  });

  it("keeps the range wide enough to be visibly uncertain", () => {
    // The reason this exists: with low === high the number swaps and then sits
    // there, and a page full of estimates reads as a page full of facts.
    const share = shareOfRange(250, 1000, range)!;

    expect(share.high).toBeGreaterThan(share.low);
  });

  it("is nothing at all when there is nothing to share out", () => {
    expect(shareOfRange(0, 1000, range)).toBeUndefined();
    expect(shareOfRange(100, 0, range)).toBeUndefined();
    expect(
      shareOfRange(1, 1000000, { estimate: 1, low: 0, high: 2 }),
    ).toBeUndefined();
  });
});
