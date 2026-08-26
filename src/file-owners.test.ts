import { describe, expect, it } from "vitest";

import { skipsFiles } from "./file-owners.js";

const users = {
  U1: { id: "U1", name: "backlog" },
  U2: { id: "U2", name: "jaricurry" },
} as never;

describe("skipsFiles()", () => {
  it("knows a bot that reposts what the archive already holds", () => {
    const skip = skipsFiles(["backlog"], users);

    expect(skip.has("U1")).toBe(true);
    expect(skip.has("U2")).toBe(false);
  });

  it("takes ids as readily as handles", () => {
    expect(skipsFiles(["U2"], users).has("U2")).toBe(true);
  });

  it("skips nobody when told nobody", () => {
    expect(skipsFiles([], users).size).toBe(0);
  });
});
