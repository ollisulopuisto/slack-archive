import { describe, expect, it } from "vitest";

import { planChannel, shareOutPages } from "./render-plan.js";

const span = (i: number) => ({ start: i * 100, end: i * 100 + 90 });
const messages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ts: `${2000 + n - i}.000100` }));
const options = {
  chunkSize: 10,
  formatTimestamp: (m: { ts?: string }) => m.ts || "",
};

describe("planChannel()", () => {
  it("gives each page the byte range of its own messages", () => {
    const plan = planChannel(
      "C1",
      messages(25),
      messages(25).map((_, i) => span(i)),
      options,
    );

    expect(plan.pages).toHaveLength(3);
    expect(plan.pages[0].span).toEqual({ start: 0, end: 990 });
    expect(plan.pages[1].span).toEqual({ start: 1000, end: 1990 });
    // The last page is short, and stops at the last message rather than at a
    // round number.
    expect(plan.pages[2].span).toEqual({ start: 2000, end: 2490 });
  });

  it("records the oldest message of each page, which is what a permalink needs", () => {
    const plan = planChannel(
      "C1",
      messages(25),
      messages(25).map((_, i) => span(i)),
      options,
    );

    expect(plan.pages.map((page) => page.oldestTs)).toEqual([
      "2016.000100",
      "2006.000100",
      "2001.000100",
    ]);
  });

  it("describes every chunk on every page, because the page control lists them all", () => {
    const plan = planChannel(
      "C1",
      messages(25),
      messages(25).map((_, i) => span(i)),
      options,
    );

    expect(plan.chunksInfo).toHaveLength(3);
    expect(plan.chunksInfo[2].count).toBe(5);
  });

  it("still gives a channel nobody posted in one page to say so", () => {
    const plan = planChannel("C1", [], [], options);

    expect(plan.pages).toEqual([{ index: 0, span: { start: 0, end: 0 } }]);
    expect(plan.chunksInfo).toEqual([]);
  });
});

describe("shareOutPages()", () => {
  const bigChannel = planChannel(
    "BIG",
    messages(100),
    messages(100).map((_, i) => span(i)),
    options,
  );
  const smallChannel = planChannel(
    "SMALL",
    messages(10),
    messages(10).map((_, i) => span(i)),
    options,
  );

  it("splits one channel across workers, which whole-channel buckets could not", () => {
    const buckets = shareOutPages([bigChannel], 4);

    expect(buckets).toHaveLength(4);
    expect(buckets.every((b) => b[0].channelId === "BIG")).toBe(true);
    expect(buckets.reduce((n, b) => n + b[0].pages.length, 0)).toBe(10);
  });

  it("gives every page to exactly one worker", () => {
    const buckets = shareOutPages([bigChannel, smallChannel], 3);
    const seen = buckets.flatMap((bucket) =>
      bucket.flatMap((plan) =>
        plan.pages.map((p) => `${plan.channelId}-${p.index}`),
      ),
    );

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(11);
  });

  it("sends a channel's chunk list once per worker, not once per page", () => {
    const [bucket] = shareOutPages([bigChannel], 1);

    expect(bucket).toHaveLength(1);
    expect(bucket[0].pages).toHaveLength(10);
    expect(bucket[0].chunksInfo).toHaveLength(10);
  });

  it("does not hand out empty buckets", () => {
    expect(shareOutPages([smallChannel], 8).length).toBeLessThanOrEqual(1);
  });
});
