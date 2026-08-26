import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { useTimezone } from "./timezone.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin", "slack-archive.js");
const before = process.env.TZ;

afterEach(() => {
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
});

describe("the rendering timezone", () => {
  it("is stated rather than inherited when one is given", () => {
    useTimezone("Europe/Helsinki");

    expect(process.env.TZ).toBe("Europe/Helsinki");
  });

  it("leaves the machine's own alone when there is nothing to state", () => {
    process.env.TZ = "America/New_York";
    useTimezone("");
    useTimezone(undefined);

    expect(process.env.TZ).toBe("America/New_York");
  });

  it("refuses a zone node would silently read as UTC", () => {
    // An unknown TZ does not throw in node - it formats in UTC and says
    // nothing, which is exactly the failure this flag exists to stop: a
    // publish that restates ten years of timestamps and reports success.
    expect(() => useTimezone("Europe/Hensinki")).toThrow(/Europe\/Hensinki/);
  });

  it("is checked before the CLI is loaded, not after", () => {
    // node caches the zone the first time it formats a date, so a --timezone
    // handled inside the CLI would be too late for anything imported above
    // it. The bad zone below must be refused before the archiver starts - if
    // it gets as far as asking for a token, the check ran too late.
    let output = "";

    expect(() => {
      try {
        execFileSync(process.execPath, [bin, "--timezone", "Europe/Hensinki"], {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (error) {
        const failure = error as { stderr?: string; stdout?: string };
        output = `${failure.stdout || ""}${failure.stderr || ""}`;
        throw error;
      }
    }).toThrow();

    expect(output).toContain("Unknown timezone Europe/Hensinki");
    expect(output).not.toContain("Slack token");
  });
});
