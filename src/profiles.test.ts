import { describe, expect, it } from "vitest";

import { profilePageIds } from "./profiles.js";
import { UserStats } from "./stats.js";

function person(userId: string, extra: Partial<UserStats> = {}): UserStats {
  return {
    userId,
    isBot: false,
    messages: 1,
    ...extra,
  } as UserStats;
}

describe("profilePageIds()", () => {
  it("is everyone a page was written for", () => {
    expect([...profilePageIds({ U1: person("U1"), U2: person("U2") })]).toEqual(
      ["U1", "U2"],
    );
  });

  it("leaves out bots - they share one page rather than having their own", () => {
    const ids = profilePageIds({
      U1: person("U1"),
      USLACK: person("USLACK", { isBot: true }),
    });

    expect(ids.has("USLACK")).toBe(false);
  });

  it("leaves out anyone with nothing to show", () => {
    // Someone whose only messages are in the channels this render excludes.
    const ids = profilePageIds({ U1: person("U1", { messages: 0 }) });

    expect(ids.size).toBe(0);
  });
});
