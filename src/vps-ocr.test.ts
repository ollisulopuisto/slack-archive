import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "../scripts/vps-ocr.sh");
const source = fs.readFileSync(script, "utf8");

// vps-ocr.sh is run for real, against stand-ins for podman, sshfs and the rest
// that record how they were called. What the script decides - what it mounts,
// what it runs, when it refuses - is the thing worth checking, and it is not
// visible in the text of the script.
let dir: string;
let home: string;
let work: string;
let calls: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-vps-"));
  home = path.join(dir, "home");
  work = path.join(home, "ocr");
  calls = path.join(dir, "calls");

  fs.mkdirSync(path.join(home, ".slack-archive"), { recursive: true });
  fs.mkdirSync(path.join(work, "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(calls, "");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A command that records its arguments, and exits as asked. */
function standIn(name: string, body = "exit 0") {
  const file = path.join(dir, "bin", name);

  fs.writeFileSync(
    file,
    `#!/bin/sh\necho "${name} $*" >> '${calls}'\n${body}\n`,
  );
  fs.chmodSync(file, 0o755);
}

function config(lines: Record<string, string> = {}) {
  const values = {
    IMAGE: "ghcr.io/example/slack-archive:26.10.23.260",
    BOX: "sub@box.invalid",
    BOX_KEY: "/keys/box",
    WORK: work,
    CONCURRENCY: "2",
    ...lines,
  };

  fs.writeFileSync(
    path.join(home, ".slack-archive", "vps-ocr.conf"),
    Object.entries(values)
      .map(([name, value]) => `${name}="${value}"`)
      .join("\n"),
  );
}

function run(extraEnv: Record<string, string> = {}) {
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${path.join(dir, "bin")}:/usr/bin:/bin`,
      HOME: home,
      ...extraEnv,
    },
  });

  return {
    status: result.status,
    stderr: result.stderr,
    calls: fs.readFileSync(calls, "utf8").split("\n").filter(Boolean),
    log: fs.existsSync(path.join(work, "ocr.log"))
      ? fs.readFileSync(path.join(work, "ocr.log"), "utf8")
      : "",
  };
}

/** The usual machine: nothing mounted, no OCR image yet, everything works. */
function ordinaryMachine(options: { imageExists?: boolean } = {}) {
  standIn(
    "podman",
    `[ "$1 $2" = "image exists" ] && exit ${options.imageExists ? 0 : 1}\nexit 0`,
  );
  standIn("sshfs");
  standIn("mountpoint", "exit 1");
  standIn("fusermount3");
  standIn("nice", `shift 2\nexec "$@"`);
  fs.writeFileSync(path.join(work, "data", "channels.json"), "[]");
}

describe("vps-ocr.sh", () => {
  it("reads through a read-only mount, as this user, and writes to the data directory", () => {
    config();
    ordinaryMachine();

    const result = run();
    const podmanRun = result.calls.find((call) =>
      call.startsWith("podman run"),
    )!;
    const sshfs = result.calls.find((call) => call.startsWith("sshfs"))!;

    expect(result.status).toBe(0);

    // The pictures: the storage box, mounted read only, never written to.
    expect(sshfs).toContain("sub@box.invalid:.");
    expect(sshfs).toContain("-p 23");
    expect(sshfs).toMatch(/-o ro,/);
    expect(sshfs).toContain("IdentityFile=/keys/box");
    expect(sshfs).toContain("StrictHostKeyChecking=yes");
    expect(sshfs).toContain(path.join(work, "files"));

    // The run: the OCR image, as the mount's owner, with the pictures read only.
    expect(podmanRun).toContain("--userns=keep-id");
    expect(podmanRun).toContain("OCR_CONCURRENCY=2");
    expect(podmanRun).toContain(
      `${path.join(work, "data")}:/app/slack-archive/data`,
    );
    expect(podmanRun).toContain(
      `${path.join(work, "files")}:/app/slack-archive/html/files:ro`,
    );
    expect(podmanRun).toContain("slack-archive-ocr:26.10.23.260");
    expect(podmanRun).toMatch(/node lib\/ocr-images\.js$/);
  });

  it("builds the OCR image once, with Tesseract and the two languages", () => {
    config();
    ordinaryMachine({ imageExists: false });

    const result = run();
    const dockerfile = fs.readFileSync(
      path.join(work, "build", "Dockerfile"),
      "utf8",
    );

    expect(result.calls.some((call) => call.startsWith("podman build"))).toBe(
      true,
    );
    expect(
      result.calls.find((call) => call.startsWith("podman build")),
    ).toContain("-t slack-archive-ocr:26.10.23.260");
    expect(dockerfile).toContain(
      "FROM ghcr.io/example/slack-archive:26.10.23.260",
    );
    expect(dockerfile).toContain("tesseract-ocr-fin");
    expect(dockerfile).toContain("tesseract-ocr-eng");
    expect(dockerfile).toMatch(/USER node\s*$/);
  });

  it("does not build it again when it is already there", () => {
    config();
    ordinaryMachine({ imageExists: true });

    const result = run();

    expect(result.calls.some((call) => call.startsWith("podman build"))).toBe(
      false,
    );
    expect(result.calls.some((call) => call.startsWith("podman run"))).toBe(
      true,
    );
  });

  it("lets go of the mount afterwards", () => {
    config();
    ordinaryMachine();

    const result = run();

    expect(result.calls.some((call) => call.startsWith("fusermount3 -u"))).toBe(
      true,
    );
  });

  it("leaves a mount alone that it did not make", () => {
    config();
    ordinaryMachine();
    standIn("mountpoint", "exit 0");

    const result = run();

    expect(result.calls.some((call) => call.startsWith("sshfs"))).toBe(false);
    expect(result.calls.some((call) => call.startsWith("fusermount3"))).toBe(
      false,
    );
  });

  it("lets go of the mount, and says so, when the reading fails", () => {
    config();
    ordinaryMachine();
    standIn(
      "podman",
      `[ "$1 $2" = "image exists" ] && exit 0\n[ "$1" = "run" ] && exit 3\nexit 0`,
    );

    const result = run();

    expect(result.status).toBe(3);
    expect(result.log).toContain("DONE WITH FAILURES: exit 3");
    expect(result.calls.some((call) => call.startsWith("fusermount3 -u"))).toBe(
      true,
    );
  });

  it("carries on with the image it has when it cannot pull", () => {
    config();
    ordinaryMachine({ imageExists: true });
    standIn(
      "podman",
      `[ "$1 $2" = "image exists" ] && exit 0\n[ "$1" = "pull" ] && exit 1\nexit 0`,
    );

    const result = run();

    expect(result.status).toBe(0);
    expect(result.log).toContain("PULL WARN");
    expect(result.calls.some((call) => call.startsWith("podman run"))).toBe(
      true,
    );
  });

  it("refuses :latest, and an image with no tag", () => {
    for (const image of [
      "ghcr.io/example/slack-archive:latest",
      "ghcr.io/example/slack-archive",
    ]) {
      config({ IMAGE: image });
      ordinaryMachine();

      const result = run();

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("must name a version");
      expect(result.calls).toEqual([]);
    }
  });

  it("does nothing until the NAS has sent something to read", () => {
    config();
    ordinaryMachine();
    fs.rmSync(path.join(work, "data", "channels.json"));

    const result = run();

    expect(result.status).toBe(0);
    expect(result.log).toContain("SKIP: no channels.json");
    expect(result.calls).toEqual([]);
  });

  it("says what is missing when there is no config", () => {
    ordinaryMachine();

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no config at");
  });

  it("does not run twice at once", () => {
    config();
    ordinaryMachine();

    // Hold the lock from outside, the way a run in progress would.
    const holder = spawnSync(
      "bash",
      [
        "-c",
        `exec 9> '${path.join(work, ".lock")}'; flock -n 9 && VPS_OCR_CONF='${path.join(home, ".slack-archive", "vps-ocr.conf")}' HOME='${home}' PATH='${path.join(dir, "bin")}:/usr/bin:/bin' bash '${script}'`,
      ],
      { encoding: "utf8" },
    );

    // The script opens the lock file afresh, and flock refuses a second open
    // of a file that the first still holds.
    expect(holder.status).toBe(0);
    expect(fs.readFileSync(path.join(work, "ocr.log"), "utf8")).toContain(
      "SKIP: a previous run is still going",
    );
  });

  it("names no host and no volume of its own", () => {
    expect(source).not.toMatch(/oracle|hetzner|your-storagebox|\/volume\d/i);
  });
});
