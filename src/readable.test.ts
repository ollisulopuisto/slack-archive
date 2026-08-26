import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { write } from "./data-write.js";

describe("what the archive writes", () => {
  let dir: string;
  let umask: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "readable-"));
    // A container with a restrictive umask is exactly the case that broke the
    // NAS publish: the file arrives, and the next process cannot read it.
    umask = process.umask(0o077);
  });

  afterEach(() => {
    process.umask(umask);
    fs.removeSync(dir);
  });

  it("is readable by whoever comes next, whatever the umask was", async () => {
    const file = path.join(dir, "search.js");

    await write(file, "window.search_data = {};");

    // 0o004: readable by others. An archive is written by one process and read
    // by another - a verifier, a web server, a person - and a file only the
    // writer can read is a file that stopped a publish today.
    expect(fs.statSync(file).mode & 0o044).toBe(0o044);
  });

  it("makes the directories it creates traversable too", async () => {
    const file = path.join(dir, "nested", "deep", "search.js");

    await write(file, "x");

    expect(fs.statSync(path.join(dir, "nested")).mode & 0o055).toBe(0o055);
    expect(fs.statSync(path.join(dir, "nested", "deep")).mode & 0o055).toBe(
      0o055,
    );
  });
});
