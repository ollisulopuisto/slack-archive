import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

const state = vi.hoisted(() => ({ outDir: "", automatic: true, keep: 2 }));

vi.mock("./config.js", () => ({
  get AUTOMATIC_MODE() {
    return state.automatic;
  },
  get NO_BACKUP() {
    return false;
  },
  get OUT_DIR() {
    return state.outDir;
  },
  get DATA_DIR() {
    return path.join(state.outDir, "data");
  },
  get KEEP_BACKUPS() {
    return state.keep;
  },
}));

// vi.mock is hoisted above the imports, so ./config.js is already faked when
// backup.js loads.
import { deleteOlderBackups } from "./backup.js";

beforeEach(() => {
  state.outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "slack-archive-backup-"),
  );
  state.automatic = true;
  state.keep = 2;
});

afterEach(() => {
  fs.removeSync(state.outDir);
  vi.restoreAllMocks();
});

/** Backups are named data_backup_<Date.now()>; oldest first here. */
function makeBackups(...timestamps: Array<number>) {
  for (const ts of timestamps) {
    fs.outputFileSync(
      path.join(state.outDir, `data_backup_${ts}`, "users.json"),
      "{}",
    );
  }
}

/** Backup DIRECTORIES still on disk. A file named like one is not a backup. */
function remaining() {
  return fs
    .readdirSync(state.outDir)
    .filter(
      (entry) =>
        entry.startsWith("data_backup_") &&
        fs.statSync(path.join(state.outDir, entry)).isDirectory(),
    )
    .sort();
}

describe("deleteOlderBackups", () => {
  // Each run copies the whole data directory - 1.5 GB for a workspace of any
  // size. Automatic mode used to see itself and return without deleting
  // anything, which is exactly backwards: automatic mode is the one that runs
  // unattended, every night, forever, with nobody watching the disk fill.
  it("keeps only the newest backups in automatic mode", async () => {
    makeBackups(1000, 2000, 3000, 4000, 5000);

    await deleteOlderBackups();

    expect(remaining()).toEqual(["data_backup_4000", "data_backup_5000"]);
  });

  it("keeps the same number when a human is watching", async () => {
    state.automatic = false;
    makeBackups(1000, 2000, 3000);

    await deleteOlderBackups();

    expect(remaining()).toEqual(["data_backup_2000", "data_backup_3000"]);
  });

  it("honours a different retention", async () => {
    state.keep = 1;
    makeBackups(1000, 2000, 3000);

    await deleteOlderBackups();

    expect(remaining()).toEqual(["data_backup_3000"]);
  });

  it("keeps everything when asked to keep more than there are", async () => {
    state.keep = 5;
    makeBackups(1000, 2000);

    await deleteOlderBackups();

    expect(remaining()).toEqual(["data_backup_1000", "data_backup_2000"]);
  });

  // Timestamps are milliseconds since the epoch, so they are the same length
  // today - but "newest" has to mean newest, not "sorts last".
  it("orders by timestamp rather than by name", async () => {
    makeBackups(999999999999, 1000000000000, 1000000000001);

    await deleteOlderBackups();

    expect(remaining()).toEqual([
      "data_backup_1000000000000",
      "data_backup_1000000000001",
    ]);
  });

  it("leaves anything that is not a backup directory alone", async () => {
    makeBackups(1000, 2000, 3000);
    fs.outputFileSync(path.join(state.outDir, "data_backup_notadir"), "x");
    fs.outputFileSync(path.join(state.outDir, "index.html"), "x");
    fs.outputFileSync(path.join(state.outDir, "data", "users.json"), "{}");

    await deleteOlderBackups();

    const entries = fs.readdirSync(state.outDir).sort();
    expect(entries).toContain("data_backup_notadir");
    expect(entries).toContain("index.html");
    expect(entries).toContain("data");
    expect(remaining()).toEqual(["data_backup_2000", "data_backup_3000"]);
  });

  it("does nothing when there are no backups", async () => {
    await expect(deleteOlderBackups()).resolves.toBeUndefined();
  });
});
