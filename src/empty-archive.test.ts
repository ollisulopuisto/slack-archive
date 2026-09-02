import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { emptyArchive } from "./empty-archive.js";

describe("emptyArchive", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-empty-"));
    fs.writeFileSync(path.join(dir, ".token"), "xoxp-secret");
    fs.writeFileSync(path.join(dir, "index.html"), "<html>");
    fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data", "users.json"), "{}");
  });

  afterEach(() => fs.removeSync(dir));

  it("deletes the archive and keeps the token", () => {
    emptyArchive(dir);

    expect(fs.existsSync(path.join(dir, ".token"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".token"), "utf8")).toBe(
      "xoxp-secret",
    );
    expect(fs.existsSync(path.join(dir, "index.html"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "data"))).toBe(false);
  });
});
