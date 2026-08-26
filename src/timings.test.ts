import { describe, expect, it, beforeEach } from "vitest";

import {
  clearTimings,
  formatDuration,
  reportTimings,
  timed,
} from "./timings.js";

describe("timings", () => {
  beforeEach(() => clearTimings());

  it("reads as minutes and seconds, which is how long these take", () => {
    expect(formatDuration(1400)).toBe("1s");
    expect(formatDuration(65000)).toBe("1m05s");
    expect(formatDuration(1_320_000)).toBe("22m00s");
  });

  it("keeps the time even when the phase throws", async () => {
    await expect(
      timed("counting", async () => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");

    expect(reportTimings("Failed")).toContain("Failed in");
  });

  it("says nothing about phases too short to matter", async () => {
    await timed("blink", async () => undefined);

    expect(reportTimings("Rendered")).toBe("Rendered in 0s: ");
  });
});
