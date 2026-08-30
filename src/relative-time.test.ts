import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The shipped file itself, evaluated: a second copy of this logic in TypeScript
// would be the one under test while the browser ran the other one.
const source = fs.readFileSync(
  path.join(here, "../static/relative-time.js"),
  "utf8",
);
const relativeTime = new Function(`${source}; return relativeTime;`)() as (
  iso: string,
  now: Date,
) => string;

const NOW = new Date("2026-08-26T12:00:00.000Z");

describe("relativeTime()", () => {
  it("says how long ago the archive was generated", () => {
    expect(relativeTime("2026-08-23T12:00:00.000Z", NOW)).toBe("3 days ago");
    expect(relativeTime("2026-08-26T09:00:00.000Z", NOW)).toBe("3 hours ago");
    expect(relativeTime("2026-08-26T11:30:00.000Z", NOW)).toBe(
      "30 minutes ago",
    );
    expect(relativeTime("2026-06-26T12:00:00.000Z", NOW)).toBe("2 months ago");
    expect(relativeTime("2025-08-26T12:00:00.000Z", NOW)).toBe("1 year ago");
  });

  it("keeps the singular singular", () => {
    expect(relativeTime("2026-08-25T12:00:00.000Z", NOW)).toBe("1 day ago");
  });

  it("does not report a page as generated in the future", () => {
    // The NAS clock and the reader's clock are not the same clock.
    expect(relativeTime("2026-08-26T12:00:10.000Z", NOW)).toBe("just now");
  });

  it("says nothing at all when it has nothing", () => {
    expect(relativeTime("", NOW)).toBe("");
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});
