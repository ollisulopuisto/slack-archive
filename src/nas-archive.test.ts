import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(
  path.join(here, "../scripts/nas-archive.sh"),
  "utf8",
);

describe("nas-archive.sh in this repository", () => {
  it("does not name a host, a volume, or a workspace", () => {
    // The committed copy used to be one machine's deploy: a public IP, the
    // SMB path, the VPS user, the workspace. Anyone who can read the repo
    // could read that. Configuration belongs in a file that is not the script.
    expect(script).not.toContain("/volume2");
    expect(script).not.toContain("ubuntu@");
    expect(script).not.toContain("morttinen");
    expect(script).not.toContain("mörttinen");
    expect(script).not.toContain("79.76");
  });

  it("reads the token from outside the archive tree", () => {
    // /volume2 is an SMB share. The Slack token used to live next to the
    // messages there, while the SSH key was kept under /root for exactly that
    // reason. The token is the more valuable secret.
    expect(script).toMatch(/SLACK_TOKEN_FILE|\/run\/secrets\/slack-token/);
    expect(script).not.toMatch(/ARCHIVE\/\.token/);
  });

  it("includes incremental media sync to remote storage box", () => {
    expect(script).toContain("sync_media");
    expect(script).toContain("MEDIA_KEY");
    expect(script).toContain("MEDIA_DEST");
  });

  it("forces readable permissions on uploaded media", () => {
    // Without -p/--chmod, rsync leaves a new file's mode up to the receiving
    // side's umask. Interactively that was 0775; over the cron-launched
    // nightly run against the Hetzner storage box it came out 0000 - every
    // attachment archived since incremental sync went live was uploaded
    // unreadable, a 404 on the public proxy indistinguishable from a file
    // that was never downloaded at all.
    const syncMedia = script.slice(
      script.indexOf("sync_media() {"),
      script.indexOf("\n}", script.indexOf("sync_media() {")),
    );

    expect(syncMedia).toContain("--chmod=");
    expect(syncMedia).toMatch(/\+rX|a\+r/);
  });

  it("trims the log on every exit, not only a successful run", () => {
    // The trim used to be the script's last line, reached only when the
    // docker run succeeded. A run that kept failing (e.g. dockerd down)
    // exited earlier via `exit "$status"` and skipped it, so the log grew
    // without bound across every failed run - 39MB and counting in
    // production before this was caught.
    const onExit = script.slice(
      script.indexOf("on_exit() {"),
      script.indexOf("\n}", script.indexOf("on_exit() {")),
    );

    expect(onExit).toMatch(/tail -n 5000/);
    expect((script.match(/tail -n 5000/g) || []).length).toBe(1);
  });
});

// The OCR steps are shell, and what matters about them is what they DO to the
// files on this machine, so these run the real functions. rsync and docker are
// replaced by stand-ins that copy a fixture or record how they were called.
describe("the OCR steps of nas-archive.sh", () => {
  /** One function's text out of the script, from its name to its closing brace. */
  function fn(name: string) {
    const start = script.indexOf(`${name}() {`);
    const end = script.indexOf("\n}\n", start) + 3;

    expect(start, `${name} is in the script`).toBeGreaterThan(-1);

    return script.slice(start, end);
  }

  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-nas-"));
    fs.mkdirSync(path.join(dir, "archive", "data"), { recursive: true });
    fs.mkdirSync(path.join(dir, "logs"));
    fs.writeFileSync(path.join(dir, "key"), "not a key");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Run steps under stand-ins; returns the log and what rsync was called with. */
  function run(steps: string, env: Record<string, string> = {}, standIns = "") {
    const config = {
      OCR_HOST: "ocr@example.invalid",
      OCR_KEY: path.join(dir, "key"),
      OCR_DIR: "ocr-dir",
      OCR_PORT: "22",
      OCR_KNOWN_HOSTS: "",
      ...env,
    };
    const assignments = Object.entries(config)
      .map(([name, value]) => `${name}='${value}'`)
      .join("\n");

    const harness = `
set -eu
ARCHIVE='${path.join(dir, "archive")}'
ROOT='${dir}'
WORKSPACE=w
LOG='${path.join(dir, "log")}'
RUN_AS=1000:1000
GROUP_ADD_ARGS=""
IMAGE=image
: > "$LOG"
log() { echo "$*" >> "$LOG"; }
${assignments}
${standIns}
${fn("ocr_configured")}
${fn("fetch_ocr")}
${fn("push_ocr_inputs")}
${steps}
`;

    execFileSync("sh", ["-c", harness], { encoding: "utf8" });

    const read = (file: string) =>
      fs.existsSync(path.join(dir, file))
        ? fs.readFileSync(path.join(dir, file), "utf8")
        : "";

    return { log: read("log"), calls: read("rsync-calls") };
  }

  // rsync that "downloads" REMOTE (a file in the temp directory) to its last
  // argument, or fails the way rsync does when the source is missing.
  const downloading = `
rsync() {
  echo "$*" >> '${"${dir}"}/rsync-calls'
  for last; do :; done
  [ -f "$REMOTE" ] || return 23
  cp "$REMOTE" "$last"
}`;

  function fetchWith(remote: string | null, local: string | null) {
    const ocr = path.join(dir, "archive", "data", "ocr.jsonl");
    const remotePath = path.join(dir, "remote.jsonl");

    if (remote !== null) fs.writeFileSync(remotePath, remote);
    if (local !== null) fs.writeFileSync(ocr, local);

    const result = run(
      "fetch_ocr",
      {},
      `REMOTE='${remotePath}'\n${downloading.replace("${dir}", dir)}`,
    );

    return {
      ...result,
      ocr: fs.existsSync(ocr) ? fs.readFileSync(ocr, "utf8") : null,
      leftover: fs.existsSync(`${ocr}.fetched`),
    };
  }

  const lines = (n: number) =>
    Array.from({ length: n }, (_, i) => `{"id":"F${i}","text":"t"}\n`).join("");

  it("fetches the readings when this machine has none", () => {
    const result = fetchWith(lines(3), null);

    expect(result.ocr).toBe(lines(3));
    expect(result.log).toContain("OCR FETCH OK: 3 readings");
    expect(result.leftover).toBe(false);
  });

  it("replaces the readings with a longer set from the OCR machine", () => {
    const result = fetchWith(lines(5), lines(2));

    expect(result.ocr).toBe(lines(5));
  });

  it("keeps its own readings when the OCR machine has fewer", () => {
    // Hours of work are in that file. A restored backup or an empty disk on
    // the other machine must not be allowed to replace it.
    const result = fetchWith(lines(2), lines(5));

    expect(result.ocr).toBe(lines(5));
    expect(result.log).toContain("OCR FETCH KEPT");
    expect(result.leftover).toBe(false);
  });

  it("carries on when nothing has been read yet", () => {
    // rsync exits 23 for a source that is not there. The archive run goes on
    // with whatever it has - the step must not stop it.
    const result = fetchWith(null, lines(4));

    expect(result.ocr).toBe(lines(4));
    expect(result.log).toContain("OCR FETCH SKIP: exit 23");
  });

  it("does nothing, and says nothing, when no OCR machine is configured", () => {
    const result = run("fetch_ocr\npush_ocr_inputs", { OCR_HOST: "" });

    expect(result.log).toBe("");
    expect(result.calls).toBe("");
  });

  it("says so when the key is missing, and does not call rsync", () => {
    const result = run(
      "fetch_ocr\npush_ocr_inputs",
      { OCR_KEY: path.join(dir, "no-such-key") },
      downloading.replace("${dir}", dir),
    );

    expect(result.log).toContain("OCR FETCH SKIP: no key");
    expect(result.log).toContain("OCR PUSH SKIP: no key");
    expect(result.calls).toBe("");
  });

  describe("sending the files reading needs", () => {
    // docker stand-in: prints the list the image would print.
    const listing = (names: Array<string>) => `
DOCKER='${"${dir}"}/fake-docker'
cat > "$DOCKER" <<'LIST'
#!/bin/sh
printf '%s\\n' ${names.map((name) => `'${name}'`).join(" ")}
LIST
chmod +x "$DOCKER"
rsync() { echo "$*" >> '${"${dir}"}/rsync-calls'; }`;

    function push(names: Array<string>) {
      fs.writeFileSync(
        path.join(dir, "archive", "data", "channels.json"),
        "[]",
      );

      return run(
        "push_ocr_inputs",
        {},
        listing(names).replace(/\$\{dir\}/g, dir),
      );
    }

    it("sends exactly the files the image listed, and nothing it did not", () => {
      const result = push(["channels.json", "C1.json"]);
      const [call] = result.calls.trim().split("\n");

      expect(call).toContain("--files-from=");
      expect(call).toContain("ocr@example.invalid:ocr-dir/data/");
      expect(call).not.toContain("--delete");
      expect(result.log).toContain("OCR PUSH START 2 files");
      expect(result.log).toContain("OCR PUSH OK");

      const listFile = /--files-from=(\S+)/.exec(call)![1];
      expect(fs.readFileSync(listFile, "utf8")).toBe(
        "channels.json\nC1.json\n",
      );
    });

    it("sends nothing when there is no channels.json to read from", () => {
      const result = run(
        "push_ocr_inputs",
        {},
        listing(["channels.json"]).replace(/\$\{dir\}/g, dir),
      );

      expect(result.log).toContain("OCR PUSH SKIP: no channels.json");
      expect(result.calls).toBe("");
    });
  });

  it("runs the OCR steps in the right places in the script", () => {
    // Before the archive run, because both indexes it builds use the readings;
    // after the media sync, and before the site is published.
    const fetch = script.indexOf("\nfetch_ocr || true");
    const archiveRun = script.indexOf(
      'if "$DOCKER" run --rm \\\n    --name "$CONTAINER_NAME"',
    );
    const push = script.indexOf("push_ocr_inputs || true");
    const media = script.indexOf("sync_media || true");
    const publish = script.indexOf("publish_site || true");

    expect(fetch).toBeGreaterThan(-1);
    expect(fetch).toBeLessThan(archiveRun);
    expect(push).toBeGreaterThan(media);
    expect(push).toBeLessThan(publish);
  });

  it("does not name a host, and keeps the OCR machine in the config", () => {
    expect(script).toContain("OCR_HOST");
    expect(script).toContain("OCR_KEY");
    expect(script).not.toMatch(/oracle/i);
  });
});
