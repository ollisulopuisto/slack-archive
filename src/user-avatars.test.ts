import { describe, it, expect } from "vitest";

import { mineAvatars, recordAvatars, UserAvatars } from "./user-avatars.js";

const URL_2021 =
  "https://avatars.slack-edge.com/2021-10-04/2570123_abc_512.jpg";
const URL_2024 =
  "https://avatars.slack-edge.com/2024-02-01/2570123_def_512.jpg";

describe("mineAvatars", () => {
  it("reads the date out of the avatar url", () => {
    expect(
      mineAvatars({
        ts: "1700000000.0",
        attachments: [{ author_id: "U1", author_icon: URL_2021 }],
      }),
    ).toEqual([
      { userId: "U1", date: "2021-10-04", url: URL_2021, seen: "1700000000.0" },
    ]);
  });

  it("ignores an unfurl's icon, which is a website's logo", () => {
    expect(
      mineAvatars({
        ts: "1700000000.0",
        attachments: [
          { author_icon: "https://hs.fi/logo.png", author_name: "HS" },
          {
            author_id: "U1",
            author_icon: "https://pbs.twimg.com/profile_images/1/x_normal.jpg",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("mines replies too", () => {
    const found = mineAvatars({
      ts: "1700000000.0",
      replies: [
        {
          ts: "1700000100.0",
          attachments: [{ author_id: "U2", author_icon: URL_2024 }],
        },
      ],
    });

    expect(found.map((f) => f.userId)).toEqual(["U2"]);
  });
});

describe("recordAvatars", () => {
  it("treats one picture quoted twice as one avatar", () => {
    const history = recordAvatars({}, [
      { userId: "U1", date: "2021-10-04", url: URL_2021, seen: "1700000200.0" },
      { userId: "U1", date: "2021-10-04", url: URL_2021, seen: "1700000100.0" },
    ]);

    expect(history.U1).toHaveLength(1);
    // The earliest sighting is the closest we get to when they changed it.
    expect(history.U1[0].seen).toBe("1700000100.0");
  });

  it("orders a person's faces oldest first", () => {
    const history = recordAvatars({}, [
      { userId: "U1", date: "2024-02-01", url: URL_2024, seen: "1700000000.0" },
      { userId: "U1", date: "2021-10-04", url: URL_2021, seen: "1600000000.0" },
    ]);

    expect(history.U1.map((a) => a.date)).toEqual(["2021-10-04", "2024-02-01"]);
  });

  it("adds to what is on disk without mutating it", () => {
    const before: UserAvatars = {
      U1: [{ date: "2021-10-04", url: URL_2021, seen: "1700000000.0" }],
    };

    const after = recordAvatars(before, [
      { userId: "U1", date: "2024-02-01", url: URL_2024, seen: "1700000100.0" },
    ]);

    expect(before.U1).toHaveLength(1);
    expect(after.U1).toHaveLength(2);
  });
});
