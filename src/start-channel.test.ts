import { describe, expect, it } from "vitest";

import { pickStartChannel } from "./start-channel.js";

const channels = [
  { id: "C1", name: "aardvark" },
  { id: "C2", name: "offtopic" },
  { id: "C3", name: "linkit" },
] as never as Array<{ id: string; name: string }>;

const messages = { C1: 40, C2: 713643, C3: 8000 };

describe("pickStartChannel()", () => {
  it("takes the one the archive was told to open with", () => {
    expect(pickStartChannel(channels, messages, "offtopic")?.id).toBe("C2");
  });

  it("does not mind a # or the wrong case", () => {
    expect(pickStartChannel(channels, messages, "#OffTopic")?.id).toBe("C2");
    expect(pickStartChannel(channels, messages, " C2 ")?.id).toBe("C2");
  });

  it("opens with the busiest channel when nobody said", () => {
    // Better than the first in the list, which is an accident of sorting: a
    // reader arriving at an archive wants the room people were in.
    expect(pickStartChannel(channels, messages, "")?.id).toBe("C2");
  });

  it("falls back rather than sending a reader nowhere", () => {
    // Named a channel this site does not publish - a private one, say.
    expect(pickStartChannel(channels, messages, "salahommat")?.id).toBe("C2");
  });

  it("copes with an archive that has no messages anywhere", () => {
    expect(pickStartChannel(channels, {}, "")?.id).toBe("C1");
  });

  it("has nothing to open when there are no channels", () => {
    expect(pickStartChannel([], {}, "offtopic")).toBeUndefined();
  });
});
