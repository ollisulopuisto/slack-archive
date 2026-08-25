import { describe, it, expect } from "vitest";

import { createStats, profileEvents } from "./stats.js";

/** 2020-05-15T10:30:00Z is a Friday. */
const FRIDAY = "1589538600.000100";
/** 2021-01-02T23:05:00Z is a Saturday. */
const SATURDAY = "1609628700.000200";

function statsOf(...channels: Array<[string, string, Array<any>]>) {
  const stats = createStats();
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
