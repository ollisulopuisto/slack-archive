import { describe, it, expect } from "vitest";

import {
  recordStatuses,
  snapshotStatuses,
  UserStatuses,
} from "./user-status.js";

const NOW = "2026-08-26T08:00:00.000Z";
const LATER = "2026-08-27T08:00:00.000Z";

describe("snapshotStatuses", () => {
  it("records a status with its emoji", () => {
    expect(
      snapshotStatuses(
        {
          U1: {
            id: "U1",
            profile: { status_text: "kaljalla", status_emoji: ":beer:" },
          },
        } as any,
        NOW,
      ),
    ).toEqual([
      {
        userId: "U1",
        text: "kaljalla",
        emoji: ":beer:",
        kind: "status",
        seen: NOW,
      },
    ]);
  });

  it("records an emoji-only status", () => {
    const [seen] = snapshotStatuses(
      { U1: { id: "U1", profile: { status_emoji: ":palmtree:" } } } as any,
      NOW,
    );
    expect(seen).toEqual({
      userId: "U1",
      text: "",
      emoji: ":palmtree:",
      kind: "status" as const,
      seen: NOW,
    });
  });

  // A cleared status is a real state, but the gap between two statuses already
  // says it, and a row per blank would bury the ones that say something.
  it("skips somebody with no status at all", () => {
    expect(
      snapshotStatuses(
        {
          U1: { id: "U1", profile: { status_text: "  ", status_emoji: "" } },
        } as any,
        NOW,
      ),
    ).toEqual([]);
  });

  it("copes with a user carrying no profile", () => {
    expect(snapshotStatuses({ U1: { id: "U1" } } as any, NOW)).toEqual([]);
  });
});

describe("recordStatuses", () => {
  it("widens a status it already knows rather than repeating it", () => {
    const history = recordStatuses({}, [
      {
        userId: "U1",
        text: "kaljalla",
        emoji: ":beer:",
        kind: "status",
        seen: NOW,
      },
      {
        userId: "U1",
        text: "kaljalla",
        emoji: ":beer:",
        kind: "status",
        seen: LATER,
      },
    ]);

    expect(history.U1).toEqual([
      {
        text: "kaljalla",
        emoji: ":beer:",
        kind: "status",
        first: NOW,
        last: LATER,
      },
    ]);
  });

  it("treats the same text with a different emoji as a different status", () => {
    const history = recordStatuses({}, [
      {
        userId: "U1",
        text: "lomalla",
        emoji: ":palmtree:",
        kind: "status",
        seen: NOW,
      },
      {
        userId: "U1",
        text: "lomalla",
        emoji: ":snowflake:",
        kind: "status",
        seen: LATER,
      },
    ]);

    expect(history.U1).toHaveLength(2);
  });

  it("keeps them oldest first", () => {
    const history = recordStatuses({}, [
      { userId: "U1", text: "toinen", emoji: "", kind: "status", seen: LATER },
      { userId: "U1", text: "eka", emoji: "", kind: "status", seen: NOW },
    ]);

    expect(history.U1.map((s) => s.text)).toEqual(["eka", "toinen"]);
  });

  it("adds to what is on disk without mutating it", () => {
    const before: UserStatuses = {
      U1: [{ text: "eka", emoji: "", first: NOW, last: NOW }],
    };

    const after = recordStatuses(before, [
      { userId: "U1", text: "toinen", emoji: "", kind: "status", seen: LATER },
    ]);

    expect(before.U1).toHaveLength(1);
    expect(after.U1).toHaveLength(2);
  });
});

describe("titles", () => {
  it("records the profile title as its own kind of status", () => {
    // "value creator", "Euroopan viimeinen uusliberalisti" - in this workspace
    // the title field is used exactly like the status line, and nothing was
    // reading it.
    const sightings = snapshotStatuses(
      {
        U1: {
          id: "U1",
          profile: {
            status_text: "kaljalla",
            status_emoji: ":beer:",
            title: "value creator",
          },
        },
      } as never,
      "2026-08-26T00:00:00.000Z",
    );

    expect(sightings).toEqual([
      {
        userId: "U1",
        text: "kaljalla",
        emoji: ":beer:",
        kind: "status",
        seen: "2026-08-26T00:00:00.000Z",
      },
      {
        userId: "U1",
        text: "value creator",
        emoji: "",
        kind: "title",
        seen: "2026-08-26T00:00:00.000Z",
      },
    ]);
  });

  it("keeps a title and a status with the same words apart", () => {
    const history = recordStatuses({}, [
      {
        userId: "U1",
        text: "hommissa",
        emoji: "",
        kind: "status",
        seen: "2026-01-01T00:00:00.000Z",
      },
      {
        userId: "U1",
        text: "hommissa",
        emoji: "",
        kind: "title",
        seen: "2026-01-01T00:00:00.000Z",
      },
    ]);

    expect(history.U1.map((entry) => entry.kind)).toEqual(["status", "title"]);
  });

  it("says nothing about an empty title", () => {
    const sightings = snapshotStatuses(
      { U1: { id: "U1", profile: { title: "  " } } } as never,
      "2026-08-26T00:00:00.000Z",
    );

    expect(sightings).toEqual([]);
  });
});
