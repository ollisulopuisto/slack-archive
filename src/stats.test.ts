import { describe, it, expect } from "vitest";

import { createStats, profileEvents } from "./stats.js";

/** 2020-05-15T10:30:00Z is a Friday. */
const FRIDAY = "1589538600.000100";
/** 2021-01-02T23:05:00Z is a Saturday. */
const SATURDAY = "1609628700.000200";

function statsOf(
  ...channels: Array<[string, string, Array<any>]>
) {
  const stats = createStats({ customEmoji: new Set(["glitch_crab", "piggy"]) });
  for (const [id, name, messages] of channels) {
    stats.addChannel({ id, name }, messages);
  }
  return stats.result();
}

describe("createStats", () => {
  it("counts messages, people and channels", () => {
    const result = statsOf(
      ["C1", "offtopic", [{ ts: FRIDAY, user: "U1", text: "moi" }]],
      ["C2", "yleinen", [{ ts: SATURDAY, user: "U2", text: "hei" }]],
    );

    expect(result.messages).toBe(2);
    expect(result.channels).toBe(2);
    expect(Object.keys(result.byUser).sort()).toEqual(["U1", "U2"]);
  });

  it("buckets by year, weekday and hour in local time", () => {
    const result = statsOf(["C1", "offtopic", [{ ts: FRIDAY, user: "U1" }]]);

    expect(result.byYear["2020"]).toBe(1);
    expect(result.byMonth["2020-05"]).toBe(1);
    expect(result.byHour.reduce((a, b) => a + b, 0)).toBe(1);
    expect(result.byWeekday.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts thread replies as messages too", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        {
          ts: FRIDAY,
          user: "U1",
          reply_count: 2,
          replies: [
            { ts: SATURDAY, user: "U2" },
            { ts: SATURDAY, user: "U1" },
          ],
        },
      ],
    ]);

    expect(result.messages).toBe(3);
    expect(result.byUser.U1.messages).toBe(2);
    expect(result.byUser.U1.threadsStarted).toBe(1);
    expect(result.byUser.U2.replies).toBe(1);
  });

  it("remembers the first and last time somebody spoke", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        { ts: SATURDAY, user: "U1" },
        { ts: FRIDAY, user: "U1" },
      ],
    ]);

    expect(result.byUser.U1.first).toBe(FRIDAY);
    expect(result.byUser.U1.last).toBe(SATURDAY);
  });

  it("counts files and reactions received", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        {
          ts: FRIDAY,
          user: "U1",
          files: [{ id: "F1" }, { id: "F2" }],
          reactions: [
            { name: "+1", count: 3 },
            { name: "joy", count: 2 },
          ],
        },
      ],
    ]);

    expect(result.byUser.U1.files).toBe(2);
    expect(result.byUser.U1.reactionsReceived).toBe(5);
    expect(result.reactions).toBe(5);
    expect(result.emoji["+1"]).toBe(3);
  });

  it("ranks the channels a person actually used", () => {
    const result = statsOf(
      [
        "C1",
        "offtopic",
        [
          { ts: FRIDAY, user: "U1" },
          { ts: FRIDAY, user: "U1" },
        ],
      ],
      ["C2", "yleinen", [{ ts: FRIDAY, user: "U1" }]],
    );

    expect(result.byUser.U1.channels).toEqual([
      { id: "C1", name: "offtopic", messages: 2 },
      { id: "C2", name: "yleinen", messages: 1 },
    ]);
  });

  it("ignores a message with no usable timestamp", () => {
    const result = statsOf(["C1", "offtopic", [{ ts: "", user: "U1" }]]);

    expect(result.messages).toBe(0);
  });

  it("does not credit a channel_join to somebody's message count", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        { ts: FRIDAY, user: "U1", subtype: "channel_join", text: "joined" },
        { ts: FRIDAY, user: "U1", text: "moi" },
      ],
    ]);

    expect(result.messages).toBe(1);
    expect(result.byUser.U1.messages).toBe(1);
  });
});

describe("the day/hour cube", () => {
  // The drill-down is year -> month -> day -> hour, and every level of that is
  // a sum of the same buckets. Storing only the leaves means the four levels
  // can never disagree with each other.
  it("records one bucket per day and hour, sparsely", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        { ts: FRIDAY, user: "U1" },
        { ts: FRIDAY, user: "U1" },
        { ts: SATURDAY, user: "U2" },
      ],
    ]);

    const days = Object.keys(result.byDayHour).sort();
    expect(days).toHaveLength(2);
    expect(
      Object.values(result.byDayHour[days[0]]).reduce((a, b) => a + b, 0),
    ).toBe(2);
    // Sparse: an hour with nothing in it is absent, not a zero.
    expect(Object.keys(result.byDayHour[days[1]])).toHaveLength(1);
  });

  it("keeps a cube per person and per channel as well", () => {
    const result = statsOf(
      ["C1", "offtopic", [{ ts: FRIDAY, user: "U1" }]],
      ["C2", "yleinen", [{ ts: SATURDAY, user: "U1" }]],
    );

    expect(Object.keys(result.byUser.U1.byDayHour)).toHaveLength(2);
    expect(Object.keys(result.byChannel.C1.byDayHour)).toHaveLength(1);
    expect(result.byChannel.C2.name).toBe("yleinen");
    expect(result.byChannel.C1.messages).toBe(1);
  });

  it("agrees with the totals it is drawn beside", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        { ts: FRIDAY, user: "U1" },
        { ts: SATURDAY, user: "U2" },
        { ts: SATURDAY, user: "U2" },
      ],
    ]);

    const fromCube = Object.values(result.byDayHour)
      .flatMap((hours) => Object.values(hours))
      .reduce((a, b) => a + b, 0);

    expect(fromCube).toBe(result.messages);
  });

  it("counts who posted in a channel", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [
        { ts: FRIDAY, user: "U1" },
        { ts: FRIDAY, user: "U2" },
        { ts: SATURDAY, user: "U2" },
      ],
    ]);

    expect(result.byChannel.C1.byUser).toEqual({ U1: 1, U2: 2 });
  });
});

describe("reactions", () => {
  const reacted = (name: string, users: Array<string>) => ({
    ts: FRIDAY,
    user: "U9",
    reactions: [{ name, users, count: users.length }],
  });

  it("separates the workspace's own emoji from Slack's", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [reacted("glitch_crab", ["U1", "U2"]), reacted("+1", ["U1"])],
    ]);

    expect(result.emojiStats.glitch_crab.custom).toBe(true);
    expect(result.emojiStats["+1"].custom).toBe(false);
    expect(result.customReactions).toBe(2);
    expect(result.reactions).toBe(3);
  });

  it("counts who gave a reaction, not only how many there were", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [reacted("piggy", ["U1", "U2"]), reacted("piggy", ["U1"])],
    ]);

    expect(result.emojiStats.piggy.count).toBe(3);
    expect(result.emojiStats.piggy.givers).toEqual({ U1: 2, U2: 1 });
    expect(result.byUser.U1.reactionsGiven).toBe(2);
    expect(result.byUser.U1.emojiGiven).toEqual({ piggy: 2 });
  });

  // Slack truncates the users array on a heavily-reacted message but keeps
  // count honest, so the two disagree and the total has to come from count.
  it("takes the total from count even when the user list is short", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [{ ts: FRIDAY, user: "U9", reactions: [{ name: "piggy", users: ["U1"], count: 40 }] }],
    ]);

    expect(result.emojiStats.piggy.count).toBe(40);
    expect(result.emojiStats.piggy.givers).toEqual({ U1: 1 });
  });

  it("remembers when an emoji was first and last used", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [reacted("piggy", ["U1"]), { ...reacted("piggy", ["U2"]), ts: SATURDAY }],
    ]);

    expect(result.emojiStats.piggy.first).toBe(FRIDAY);
    expect(result.emojiStats.piggy.last).toBe(SATURDAY);
    expect(Object.keys(result.emojiStats.piggy.byYear).sort()).toEqual([
      "2020",
      "2021",
    ]);
  });

  it("survives a reaction with no users array at all", () => {
    const result = statsOf([
      "C1",
      "offtopic",
      [{ ts: FRIDAY, user: "U9", reactions: [{ name: "piggy", count: 2 }] }],
    ]);

    expect(result.emojiStats.piggy.count).toBe(2);
    expect(result.emojiStats.piggy.givers).toEqual({});
  });
});

describe("profileEvents", () => {
  it("turns the archive into one dated story per person", () => {
    const stats = createStats();
    stats.addChannel({ id: "C1", name: "offtopic" }, [
      { ts: FRIDAY, user: "U1", subtype: "channel_join" },
      { ts: SATURDAY, user: "U1", text: "moi" },
      { ts: "1700000000.000300", user: "U1", text: "vielä" },
    ]);

    const events = profileEvents("U1", stats.result(), {
      U1: [
        {
          nick: "dst",
          first: "2016-10-06T00:00:00.000Z",
          last: "2016-11-22T00:00:00.000Z",
          sources: ["mention"],
        },
      ],
    });

    expect(events.map((e) => e.kind)).toEqual([
      "name",
      "joined",
      "first-message",
      "last-message",
    ]);
    expect(events[0].detail).toContain("dst");
    expect(events[1].detail).toContain("offtopic");

    // One message means first and last are the same moment, and the timeline
    // should say so once rather than twice.
    const oneMessage = createStats();
    oneMessage.addChannel({ id: "C1", name: "offtopic" }, [
      { ts: SATURDAY, user: "U1", text: "moi" },
    ]);
    expect(
      profileEvents("U1", oneMessage.result(), {}).map((e) => e.kind),
    ).toEqual(["first-message"]);
  });

  it("is empty for somebody the archive has never seen", () => {
    expect(profileEvents("U9", createStats().result(), {})).toEqual([]);
  });
});
