import { describe, expect, it } from "vitest";

import { monthsToPages, groupByYear, fillMonths } from "./calendar-nav.js";

// Newest first, as the archive stores them: page 0 holds the newest messages.
const messages = [
  { ts: "1748736000.000000" }, // 2025-06-01
  { ts: "1746057600.000000" }, // 2025-05-01
  { ts: "1743465600.000000" }, // 2025-04-01
  { ts: "1717200000.000000" }, // 2024-06-01
  { ts: "1714521600.000000" }, // 2024-05-01
];

describe("monthsToPages()", () => {
  it("sends a month to the page where that month begins", () => {
    // Pages run newest to oldest, so the START of a month is on the
    // highest-numbered page that still holds it - which is where a reader
    // asking for "May 2025" wants to land.
    const months = monthsToPages(messages as never, 2);

    expect(months).toEqual([
      { month: "2024-05", page: 2 },
      { month: "2024-06", page: 1 },
      { month: "2025-04", page: 1 },
      { month: "2025-05", page: 0 },
      { month: "2025-06", page: 0 },
    ]);
  });

  it("puts a month that spans pages at its earliest page", () => {
    const spanning = [
      { ts: "1748736000.000000" }, // 2025-06-01, page 0
      { ts: "1748822400.000000" }, // 2025-06-02, page 0
      { ts: "1748908800.000000" }, // 2025-06-03, page 1
    ];

    expect(monthsToPages(spanning as never, 2)).toEqual([
      { month: "2025-06", page: 1 },
    ]);
  });

  it("has nothing to say about an empty channel", () => {
    expect(monthsToPages([], 1000)).toEqual([]);
  });

  it("ignores a message with no usable timestamp", () => {
    expect(
      monthsToPages([{ ts: "" }, { ts: "nonsense" }] as never, 10),
    ).toEqual([]);
  });
});

describe("groupByYear()", () => {
  it("gives a year its months, newest year first", () => {
    const grouped = groupByYear([
      { month: "2024-05", page: 2 },
      { month: "2024-06", page: 1 },
      { month: "2025-04", page: 1 },
    ]);

    expect(grouped).toEqual([
      { year: "2025", months: [{ month: "2025-04", page: 1, label: "Apr" }] },
      {
        year: "2024",
        months: [
          { month: "2024-05", page: 2, label: "May" },
          { month: "2024-06", page: 1, label: "Jun" },
        ],
      },
    ]);
  });
});

describe("fillMonths()", () => {
  it("keeps the months with no messages, so a gap is visible rather than implied", () => {
    // A chip that is simply absent is ambiguous: was the channel quiet, or was
    // the archiver not running? Drawn and disabled, the month is at least a
    // question the page has answered.
    const filled = fillMonths([
      { month: "2022-01", page: 5 },
      { month: "2022-04", page: 2 },
    ]);

    expect(filled).toEqual([
      { month: "2022-01", page: 5 },
      { month: "2022-02" },
      { month: "2022-03" },
      { month: "2022-04", page: 2 },
    ]);
  });

  it("spans years without inventing months outside the channel's life", () => {
    const filled = fillMonths([
      { month: "2021-11", page: 3 },
      { month: "2022-02", page: 1 },
    ]);

    expect(filled.map((m) => m.month)).toEqual([
      "2021-11",
      "2021-12",
      "2022-01",
      "2022-02",
    ]);
  });

  it("has nothing to fill for one month, or none", () => {
    expect(fillMonths([{ month: "2022-01", page: 0 }])).toEqual([
      { month: "2022-01", page: 0 },
    ]);
    expect(fillMonths([])).toEqual([]);
  });
});
