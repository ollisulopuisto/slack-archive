import { describe, expect, it } from "vitest";

import { estimateMissingByMonth } from "./estimate.js";

/** Monthly totals for a year, Jan..Dec. */
function year(y: number, values: Array<number>): Record<string, number> {
  const out: Record<string, number> = {};
  values.forEach((v, i) => {
    out[`${y}-${String(i + 1).padStart(2, "0")}`] = v;
  });
  return out;
}

// A workspace with a strong summer dip: July is always a third of the rest.
const seasonal = [90, 90, 90, 90, 90, 90, 30, 90, 90, 90, 90, 90];

describe("estimateMissingByMonth()", () => {
  it("uses the same month in other years, not a flat line", () => {
    const monthly = { ...year(2020, seasonal), ...year(2022, seasonal) };
    const gap = { from: "2021-06-01", to: "2021-08-31", days: 92 };

    const estimate = estimateMissingByMonth(monthly, [gap]);

    // June and August at the normal level, July down with the season.
    expect(estimate["2021-07"].estimate).toBeLessThan(
      estimate["2021-06"].estimate / 2,
    );
    expect(estimate["2021-06"].estimate).toBeCloseTo(90, -1);
  });

  it("follows the trend, not just the shape", () => {
    // The workspace doubled between 2020 and 2022; the missing 2021 should sit
    // between them rather than at either end.
    const monthly = {
      ...year(
        2020,
        seasonal.map((v) => v),
      ),
      ...year(
        2022,
        seasonal.map((v) => v * 4),
      ),
    };
    const gap = { from: "2021-01-01", to: "2021-12-31", days: 365 };

    const june = estimateMissingByMonth(monthly, [gap])["2021-06"].estimate;

    expect(june).toBeGreaterThan(90);
    expect(june).toBeLessThan(360);
  });

  it("prorates a month the gap only partly covers", () => {
    const monthly = { ...year(2020, seasonal), ...year(2022, seasonal) };
    const gap = { from: "2021-06-16", to: "2021-06-30", days: 15 };

    const june = estimateMissingByMonth(monthly, [gap])["2021-06"];

    expect(june.missingDays).toBe(15);
    expect(june.estimate).toBeCloseTo(45, -1);
  });

  it("widens the interval when the other years disagree about that month", () => {
    const agree = { ...year(2020, seasonal), ...year(2022, seasonal) };
    const disagree = {
      ...year(2020, seasonal),
      ...year(
        2022,
        seasonal.map((v, i) => (i === 5 ? v * 6 : v)),
      ),
    };
    const gap = { from: "2021-06-01", to: "2021-06-30", days: 30 };

    const calm = estimateMissingByMonth(agree, [gap])["2021-06"];
    const wild = estimateMissingByMonth(disagree, [gap])["2021-06"];

    expect(wild.high - wild.low).toBeGreaterThan(calm.high - calm.low);
    expect(calm.low).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the level either side when no other year has that month", () => {
    const monthly = { "2021-05": 100, "2021-09": 140 };
    const gap = { from: "2021-06-01", to: "2021-08-31", days: 92 };

    const estimate = estimateMissingByMonth(monthly, [gap]);

    expect(estimate["2021-07"].estimate).toBeGreaterThan(90);
    expect(estimate["2021-07"].estimate).toBeLessThan(150);
  });

  it("says nothing when there is nothing to reason from", () => {
    expect(
      estimateMissingByMonth({}, [
        { from: "2021-06-01", to: "2021-06-30", days: 30 },
      ]),
    ).toEqual({});
  });
});
