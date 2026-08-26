import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "prune-images.sh",
);

const REPO = "ghcr.io/ollisulopuisto/slack-archive";

/** Five builds, newest first, as `docker images` would list them. */
const IMAGES = [
  ["2026-08-27 09:00:00 +0300 EEST", "26.08.27.190"],
  ["2026-08-26 09:00:00 +0300 EEST", "26.08.26.186"],
  ["2026-08-25 09:00:00 +0300 EEST", "26.08.25.145"],
  ["2026-08-24 09:00:00 +0300 EEST", "26.08.24.120"],
  ["2026-08-23 09:00:00 +0300 EEST", "26.08.23.101"],
];

let home = "";

/** A docker that lists the images above and records what it was asked to do. */
function fakeDocker(listing = IMAGES) {
  const bin = path.join(home, "docker");
  const lines = listing.map(([created, tag]) => `${created}|${REPO}:${tag}`);

  fs.writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> "${path.join(home, "calls.txt")}"
if [ "$1" = "images" ]; then
${lines.map((line) => `  echo '${line}'`).join("\n")}
fi
exit 0
`,
    { mode: 0o755 },
  );

  return bin;
}

function run(pin: string, keep?: string) {
  return execFileSync("sh", [script, pin, ...(keep ? [keep] : [])], {
    encoding: "utf8",
    env: { ...process.env, DOCKER: fakeDocker() },
  });
}

function removed() {
  return fs
    .readFileSync(path.join(home, "calls.txt"), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("rmi "))
    .map((line) => line.slice(4).trim());
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "prune-"));
});

afterEach(() => {
  fs.removeSync(home);
});

describe("pruning old images of the archiver", () => {
  it("keeps the newest three and removes the rest", () => {
    run(`${REPO}:26.08.27.190`);

    expect(removed()).toEqual([`${REPO}:26.08.24.120`, `${REPO}:26.08.23.101`]);
  });

  it("never removes the pinned image, however old it is", () => {
    // The pin is what the next run starts. An upgrade that has been overtaken
    // by three later experiments is still the thing in production, and a prune
    // that deletes it turns a nightly job into a pull-or-nothing.
    const output = run(`${REPO}:26.08.23.101`);

    expect(removed()).toEqual([`${REPO}:26.08.24.120`]);
    expect(output).toContain(
      "kept ghcr.io/ollisulopuisto/slack-archive:26.08.23.101 (pinned)",
    );
  });

  it("removes nothing when there is nothing above the limit", () => {
    execFileSync("sh", [script, `${REPO}:26.08.27.190`, "9"], {
      encoding: "utf8",
      env: { ...process.env, DOCKER: fakeDocker() },
    });

    expect(removed()).toEqual([]);
  });

  it("leaves untagged layers to the dangling prune", () => {
    // `<none>:<none>` is not a name rmi can be trusted with: it matches every
    // untagged layer at once, including ones another image still needs.
    execFileSync("sh", [script, `${REPO}:26.08.27.190`, "1"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER: fakeDocker([
          ...IMAGES,
          ["2026-08-22 09:00:00 +0300 EEST", "<none>"],
        ]),
      },
    });

    expect(removed()).not.toContain(`${REPO}:<none>`);
    expect(fs.readFileSync(path.join(home, "calls.txt"), "utf8")).toContain(
      "image prune -f --filter dangling=true",
    );
  });
});
