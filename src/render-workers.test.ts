import { describe, expect, it } from "vitest";

import { defaultWorkerCount, shareOut } from "./render-workers.js";

const channel = (id: string) => ({ id, name: id }) as never;

describe("shareOut()", () => {
  it("balances by messages, not by channels", () => {
    // One channel here holds 713 510 messages and the smallest holds 75.
    // Splitting the list evenly would leave one worker rendering for two
    // minutes while the others finished in seconds.
    const buckets = shareOut(
      [channel("big"), channel("a"), channel("b"), channel("c")],
      { big: 700000, a: 250000, b: 250000, c: 200000 },
      2,
    );

    const load = buckets.map((bucket) =>
      bucket.reduce(
        (n, c) =>
          n +
          ({ big: 700000, a: 250000, b: 250000, c: 200000 } as never)[c.id!],
        0,
      ),
    );

    expect(Math.max(...load) - Math.min(...load)).toBeLessThan(300000);
  });

  it("gives every channel to exactly one worker", () => {
    const channels = ["a", "b", "c", "d", "e"].map(channel);
    const buckets = shareOut(channels, {}, 3);

    expect(
      buckets
        .flat()
        .map((c) => c.id)
        .sort(),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not hand out empty buckets", () => {
    expect(shareOut([channel("a")], {}, 4)).toHaveLength(1);
  });
});

describe("defaultWorkerCount()", () => {
  it("takes what it is told", () => {
    expect(defaultWorkerCount(3)).toBe(3);
  });

  it("leaves a core for the machine and never asks for more than eight", () => {
    const chosen = defaultWorkerCount();

    expect(chosen).toBeGreaterThanOrEqual(1);
    expect(chosen).toBeLessThanOrEqual(8);
  });
});
