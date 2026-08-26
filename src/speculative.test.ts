import { describe, expect, it } from "vitest";

import { speculativeTotals, estimatesByYear } from "./speculative.js";

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
