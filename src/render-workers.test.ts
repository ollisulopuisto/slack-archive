import { describe, expect, it } from "vitest";

import { defaultWorkerCount } from "./render-workers.js";

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
