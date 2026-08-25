import { describe, it, expect } from "vitest";

import {
  mineNames,
  recordNames,
  slackTimestampToIso,
  snapshotNames,
  UserNames,
} from "./user-names.js";

describe("slackTimestampToIso", () => {
  it("converts a Slack timestamp", () => {
    expect(slackTimestampToIso("1475062758.000002")).toBe(
      "2016-09-28T11:39:18.000Z",
    );
  });

  it("refuses what is not a timestamp", () => {
    for (const value of [undefined, "", "0", "-1", "nope"]) {
      expect(slackTimestampToIso(value)).toBeNull();
    }
  });
});

describe("mineNames", () => {
  it("reads the name out of an old-style mention", () => {
    expect(
      mineNames({ ts: "1475062758.000002", text: "moi <@U2GV75QA2|selim>" }),
    ).toEqual([
      {
        userId: "U2GV75QA2",
        nick: "selim",
        seen: "2016-09-28T11:39:18.000Z",
        source: "mention",
      },
    ]);
  });

  it("finds every mention in one message", () => {
    const found = mineNames({
      ts: "1475062758.000002",
      text: "<@U1|aame> ja <@U2|vappu> ja taas <@U1|aame>",
    });

    expect(found.map((f) => `${f.userId}:${f.nick}`)).toEqual([
      "U1:aame",
      "U2:vappu",
      "U1:aame",
    ]);
  });

  it("ignores a modern mention, which carries no name", () => {
    expect(mineNames({ ts: "1700000000.0", text: "moi <@U2GV75QA2>" })).toEqual(
      [],
    );
  });

  it("takes the username field when a message carries one", () => {
    const found = mineNames({
      ts: "1475062758.000002",
      user: "U1",
      username: "closingbell",
    });

    expect(found).toEqual([
      {
        userId: "U1",
        nick: "closingbell",
        seen: "2016-09-28T11:39:18.000Z",
        source: "username",
      },
    ]);
  });

  it("mines thread replies too", () => {
    const found = mineNames({
      ts: "1475062758.000002",
      text: "<@U1|aame>",
      replies: [
        { ts: "1475062800.0", text: "<@U2|vappu>" },
        { ts: "1475062900.0", text: "<@U3|dst>", replies: [] },
      ],
    });

    expect(found.map((f) => f.nick)).toEqual(["aame", "vappu", "dst"]);
  });

  it("skips a message with no usable timestamp", () => {
    expect(mineNames({ ts: "", text: "<@U1|aame>" })).toEqual([]);
  });

  it("skips an empty name", () => {
    expect(mineNames({ ts: "1475062758.0", text: "<@U1|>" })).toEqual([]);
  });
});

describe("snapshotNames", () => {
  it("records what people are called today", () => {
    const found = snapshotNames(
      {
        U1: {
          id: "U1",
          name: "handle",
          profile: { display_name: "Näytettävä", real_name: "Oikea Nimi" },
        },
      } as any,
      "2026-08-25T00:00:00.000Z",
    );

    expect(found.map((f) => f.nick)).toEqual([
      "Näytettävä",
      "Oikea Nimi",
      "handle",
    ]);
    expect(found.every((f) => f.source === "profile")).toBe(true);
  });

  it("skips blanks, which Slack uses for an unset display name", () => {
    const found = snapshotNames(
      {
        U1: { id: "U1", name: "handle", profile: { display_name: "  " } },
      } as any,
      "2026-08-25T00:00:00.000Z",
    );

    expect(found.map((f) => f.nick)).toEqual(["handle"]);
  });
});

describe("recordNames", () => {
  it("keeps one entry per name and widens its window", () => {
    const history = recordNames({}, [
      {
        userId: "U1",
        nick: "dst",
        seen: "2016-10-06T00:00:00.000Z",
        source: "mention",
      },
      {
        userId: "U1",
        nick: "dst",
        seen: "2016-11-22T00:00:00.000Z",
        source: "mention",
      },
    ]);

    expect(history.U1).toEqual([
      {
        nick: "dst",
        first: "2016-10-06T00:00:00.000Z",
        last: "2016-11-22T00:00:00.000Z",
        sources: ["mention"],
      },
    ]);
  });

  it("orders a person's names oldest first", () => {
    const history = recordNames({}, [
      {
        userId: "U1",
        nick: "btngbldrgrndn",
        seen: "2025-01-15T00:00:00.000Z",
        source: "mention",
      },
      {
        userId: "U1",
        nick: "dst",
        seen: "2016-10-06T00:00:00.000Z",
        source: "mention",
      },
      {
        userId: "U1",
        nick: "katthufvud",
        seen: "2016-11-24T00:00:00.000Z",
        source: "mention",
      },
    ]);

    expect(history.U1.map((n) => n.nick)).toEqual([
      "dst",
      "katthufvud",
      "btngbldrgrndn",
    ]);
  });

  it("collects the sources a name was seen in, without duplicates", () => {
    const history = recordNames({}, [
      {
        userId: "U1",
        nick: "dst",
        seen: "2016-10-06T00:00:00.000Z",
        source: "mention",
      },
      {
        userId: "U1",
        nick: "dst",
        seen: "2026-08-25T00:00:00.000Z",
        source: "profile",
      },
      {
        userId: "U1",
        nick: "dst",
        seen: "2026-08-26T00:00:00.000Z",
        source: "profile",
      },
    ]);

    expect(history.U1[0].sources).toEqual(["mention", "profile"]);
    expect(history.U1[0].last).toBe("2026-08-26T00:00:00.000Z");
  });

  it("adds to what is already on disk without losing it", () => {
    const existing: UserNames = {
      U1: {
        nick: "selim",
        first: "2016-09-28T00:00:00.000Z",
        last: "2016-10-11T00:00:00.000Z",
        sources: ["mention"],
      },
    } as any as UserNames;
    const history = recordNames({ U1: [(existing as any).U1] }, [
      {
        userId: "U1",
        nick: "jaricurry",
        seen: "2016-10-11T00:00:00.000Z",
        source: "mention",
      },
      {
        userId: "U2",
        nick: "vappu",
        seen: "2016-10-09T00:00:00.000Z",
        source: "mention",
      },
    ]);

    expect(history.U1.map((n) => n.nick)).toEqual(["selim", "jaricurry"]);
    expect(history.U2.map((n) => n.nick)).toEqual(["vappu"]);
  });

  it("does not mutate the history it was given", () => {
    const before: UserNames = {
      U1: [
        {
          nick: "dst",
          first: "2016-10-06T00:00:00.000Z",
          last: "2016-10-06T00:00:00.000Z",
          sources: ["mention"],
        },
      ],
    };

    recordNames(before, [
      {
        userId: "U1",
        nick: "dst",
        seen: "2026-08-25T00:00:00.000Z",
        source: "profile",
      },
      {
        userId: "U1",
        nick: "katthufvud",
        seen: "2016-11-24T00:00:00.000Z",
        source: "mention",
      },
    ]);

    expect(before.U1).toHaveLength(1);
    expect(before.U1[0].last).toBe("2016-10-06T00:00:00.000Z");
    expect(before.U1[0].sources).toEqual(["mention"]);
  });
});
