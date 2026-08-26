import { describe, expect, it } from "vitest";

import { findGaps, gapBetween } from "./gaps.js";

/** A day count for every day from `from` to `to`, all busy. */
function busy(from: string, to: string): Record<string, number> {
  const days: Record<string, number> = {};
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day <= new Date(`${to}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    days[day.toISOString().slice(0, 10)] = 10;
  }
  return days;
}

describe("findGaps()", () => {
  it("finds a stretch with nothing in it", () => {
    const days = { ...busy("2022-01-01", "2022-01-31") };
    for (let d = 10; d <= 20; d++) delete days[`2022-01-${d}`];

    expect(findGaps(days, 7)).toEqual([
      { from: "2022-01-10", to: "2022-01-20", days: 11 },
    ]);
  });

  it("ignores a quiet weekend", () => {
    const days = { ...busy("2022-01-01", "2022-01-31") };
    delete days["2022-01-08"];
    delete days["2022-01-09"];

    expect(findGaps(days, 7)).toEqual([]);
  });

  it("counts a day recorded as zero as missing", () => {
    const days = { ...busy("2022-01-01", "2022-01-31") };
    for (let d = 10; d <= 20; d++) days[`2022-01-${d}`] = 0;

    expect(findGaps(days, 7)[0].days).toBe(11);
  });

  it("never reports the silence before the first message or after the last", () => {
    expect(findGaps({ "2020-06-01": 5 }, 7)).toEqual([]);
    expect(findGaps({}, 7)).toEqual([]);
  });

  it("returns gaps oldest first", () => {
    const days = { ...busy("2022-01-01", "2022-12-31") };
    for (const month of ["02", "07"]) {
      for (let d = 1; d <= 28; d++) {
        delete days[`2022-${month}-${String(d).padStart(2, "0")}`];
      }
    }

    expect(findGaps(days, 7).map((gap) => gap.from)).toEqual([
      "2022-02-01",
      "2022-07-01",
    ]);
  });
});

describe("gapBetween()", () => {
  const gaps = [
    { from: "2022-02-01", to: "2022-09-10", days: 222 },
    { from: "2024-05-03", to: "2024-09-10", days: 131 },
  ];

  it("finds the gap two neighbouring messages straddle", () => {
    expect(gapBetween(gaps, "2022-01-31", "2022-09-11")?.days).toBe(222);
  });

  it("is nothing when the two messages are on the same side of it", () => {
    expect(gapBetween(gaps, "2022-09-11", "2022-09-12")).toBeUndefined();
    expect(gapBetween(gaps, "2021-01-01", "2022-01-31")).toBeUndefined();
  });

  it("does not care which message is given first", () => {
    expect(gapBetween(gaps, "2024-09-11", "2024-05-02")?.days).toBe(131);
  });

  it("is nothing without both days", () => {
    expect(gapBetween(gaps, "", "2022-09-11")).toBeUndefined();
  });
});
