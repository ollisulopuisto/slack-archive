import { describe, it, expect } from "vitest";

import {
  excludedUserIds,
  isChannelSearchable,
  isMessageSearchable,
  toSearchMessages,
} from "./search-filter.js";

const USERS = {
  U1: { id: "U1", name: "historia" },
  U2: { id: "U2", name: "backlog", profile: { display_name: "Backlog" } },
  U3: { id: "U3", name: "olli" },
} as any;

describe("excludedUserIds", () => {
  it("resolves handles to ids, case-insensitively", () => {
    expect([...excludedUserIds(["Historia", "backlog"], USERS)].sort()).toEqual(
      ["U1", "U2"],
    );
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
    expect(isChannelSearchable({ id: "C1", name: "offtopic" }, kinds)).toBe(
      true,
    );
    expect(
      isChannelSearchable(
        { id: "C2", name: "salahommat", is_private: true },
        kinds,
      ),
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
    expect(isChannelSearchable({ id: "D1", is_im: true }, new Set())).toBe(
      true,
    );
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

// isMessageSearchable reads `u`, the mapped short field. An archive message
// calls the same thing `user`, and ArchiveMessage has an index signature, so
// reading `.u` off one is legal and always undefined - the guard then returns
// true for every message and excludes nothing while reporting that it did.
// That shipped: a rebuild kept all 61 421 Slackbot messages.
//
// These pin the precondition, since the type system cannot.
describe("isMessageSearchable operates on mapped messages", () => {
  const hidden = new Set(["USLACKBOT"]);

  it("excludes a mapped message from a hidden user", () => {
    expect(
      isMessageSearchable({ u: "USLACKBOT", m: "x", t: "1" }, hidden),
    ).toBe(false);
  });

  it("does NOT recognise the raw archive field, which is why order matters", () => {
    const rawShape = { user: "USLACKBOT", text: "x", ts: "1" } as any;
    expect(isMessageSearchable(rawShape, hidden)).toBe(true);
  });

  it("keeps a message with no user at all", () => {
    expect(isMessageSearchable({ m: "x", t: "1" }, hidden)).toBe(true);
  });
});

describe("toSearchMessages", () => {
  const opts = (
    over: Partial<{ hiddenUsers: Set<string>; includeBots: boolean }> = {},
  ) => ({
    hiddenUsers: new Set<string>(),
    includeBots: false,
    ...over,
  });

  it("maps an archive message to an index entry", () => {
    expect(
      toSearchMessages([{ ts: "1.0", user: "U1", text: "moi" }], opts()),
    ).toEqual([{ m: "moi", u: "U1", t: "1.0" }]);
  });

  // The bug this function exists to prevent: the filter has to see the MAPPED
  // shape. Reading `.u` off an archive message is legal, always undefined, and
  // keeps everything.
  it("drops a hidden user's message", () => {
    expect(
      toSearchMessages(
        [
          { ts: "1.0", user: "U1", text: "bot chatter" },
          { ts: "2.0", user: "U2", text: "moi" },
        ],
        opts({ hiddenUsers: new Set(["U1"]) }),
      ).map((message) => message.u),
    ).toEqual(["U2"]);
  });

  it("drops anything posted through an app unless bots are wanted", () => {
    const messages = [
      { ts: "1.0", user: "U1", bot_id: "B1", text: "beep" },
      { ts: "2.0", user: "U2", text: "moi" },
    ];

    expect(toSearchMessages(messages, opts())).toHaveLength(1);
    expect(
      toSearchMessages(messages, opts({ includeBots: true })),
    ).toHaveLength(2);
  });

  it("carries attachments through, so an uncaptioned image stays findable", () => {
    const [message] = toSearchMessages(
      [
        {
          ts: "1.0",
          user: "U1",
          text: "",
          files: [
            {
              id: "F1",
              name: "kissa.png",
              title: "Kissa",
              filetype: "png",
              mimetype: "image/png",
            },
            { notAFile: true },
          ],
        },
      ],
      opts(),
    );

    expect(message.files).toEqual([
      {
        id: "F1",
        name: "kissa.png",
        title: "Kissa",
        filetype: "png",
        mimetype: "image/png",
      },
    ]);
  });

  it("leaves files off a message that has none", () => {
    const [message] = toSearchMessages(
      [{ ts: "1.0", user: "U1", text: "moi" }],
      opts(),
    );
    expect(message.files).toBeUndefined();
  });
});
