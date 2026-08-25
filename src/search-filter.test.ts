import { describe, it, expect } from "vitest";

import {
  excludedUserIds,
  isChannelSearchable,
  isMessageSearchable,
} from "./search-filter.js";

const USERS = {
  U1: { id: "U1", name: "historia" },
  U2: { id: "U2", name: "backlog", profile: { display_name: "Backlog" } },
  U3: { id: "U3", name: "olli" },
} as any;

describe("excludedUserIds", () => {
  it("resolves handles to ids, case-insensitively", () => {
    expect([...excludedUserIds(["Historia", "backlog"], USERS)].sort()).toEqual([
      "U1",
      "U2",
    ]);
  });

  it("takes an id directly", () => {
    expect([...excludedUserIds(["U3"], USERS)]).toEqual(["U3"]);
  });

  it("matches a display name too", () => {
    expect([...excludedUserIds(["Backlog"], USERS)]).toEqual(["U2"]);
  });

  it("ignores a name nobody has, rather than guessing", () => {
    expect([...excludedUserIds(["nobody"], USERS)]).toEqual([]);
  });

  it("is empty for an empty list", () => {
    expect([...excludedUserIds([], USERS)]).toEqual([]);
  });
});

describe("isChannelSearchable", () => {
  const kinds = new Set(["im", "mpim"]);

  it("keeps public and private channels", () => {
    expect(isChannelSearchable({ id: "C1", name: "offtopic" }, kinds)).toBe(true);
    expect(
      isChannelSearchable({ id: "C2", name: "salahommat", is_private: true }, kinds),
    ).toBe(true);
  });

  it("drops direct and group messages", () => {
    expect(isChannelSearchable({ id: "D1", is_im: true }, kinds)).toBe(false);
    expect(isChannelSearchable({ id: "G1", is_mpim: true }, kinds)).toBe(false);
  });

  // Slack marks a DM is_private as well, and a classifier that asks "private?"
  // first calls every DM a private channel. channelKind resolves the order.
  it("drops a DM even though Slack also marks it private", () => {
    expect(
      isChannelSearchable({ id: "D2", is_im: true, is_private: true }, kinds),
    ).toBe(false);
  });

  it("keeps everything when nothing is excluded", () => {
    expect(isChannelSearchable({ id: "D1", is_im: true }, new Set())).toBe(true);
  });
});

describe("isMessageSearchable", () => {
  it("drops a message from an excluded author", () => {
    expect(isMessageSearchable({ u: "U1" }, new Set(["U1"]))).toBe(false);
  });

  it("keeps everyone else", () => {
    expect(isMessageSearchable({ u: "U3" }, new Set(["U1"]))).toBe(true);
  });

  it("keeps a message with no author rather than dropping it silently", () => {
    expect(isMessageSearchable({}, new Set(["U1"]))).toBe(true);
  });
});
