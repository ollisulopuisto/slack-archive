import fs from "fs-extra";
import path from "path";
import trash from "trash";
import { rimraf } from "rimraf";

import { DATA_DIR, KEEP_BACKUPS, NO_BACKUP, OUT_DIR } from "./config.js";

let backupDir = `${DATA_DIR}_backup_${Date.now()}`;

export async function createBackup() {
  if (NO_BACKUP || !fs.existsSync(DATA_DIR)) {
    return;
  }

  const hasFiles = fs.readdirSync(DATA_DIR);

  if (hasFiles.length === 0) {
    return;
  }

  console.log(`Existing data directory found. Creating backup: ${backupDir}`);

  await fs.copy(DATA_DIR, backupDir);

  console.log(`Backup created.\n`);
}

export async function deleteBackup() {
  if (!fs.existsSync(backupDir)) {
    return;
  }

  console.log(
    `Cleaning up backup: If anything went wrong, you'll find it in your system's trash.`,
  );

  try {
    // NB: trash doesn't work on many Linux distros
    await trash(backupDir);
    return;
  } catch (error) {
    console.log("Moving backup to trash failed.");
  }

  if (!process.env["TRASH_HARDER"]) {
    console.log(`Set TRASH_HARDER=1 to delete files permanently.`);
    return;
  }

  try {
    await rimraf(backupDir);
  } catch (error) {
    console.log(`Deleting backup permanently failed. Aborting here.`);
  }
}

/**
 * Keep the newest `KEEP_BACKUPS` backups and delete the rest.
 *
 * This used to ask, and in automatic mode it used to see that nobody was there
 * to answer and return without deleting anything. That is backwards: automatic
 * mode is the unattended one, running every night, and a copy of the entire
 * data directory per run is roughly a gigabyte a night that nothing ever
 * reclaimed. Stranded `data_backup_*` directories on two different machines is
 * how it showed up.
 *
 * A bounded retention is what both modes wanted, so it is no longer a question:
 * how many to keep is `--keep-backups`, decided once, rather than a prompt that
 * can only be answered by whoever happens to be watching.
 */
export async function deleteOlderBackups() {
  for (const dir of listBackups().slice(KEEP_BACKUPS)) {
    try {
      console.log(`Deleting old backup: ${path.basename(dir)}`);
      fs.removeSync(dir);
    } catch (error) {
      console.log(`Could not delete old backup ${dir}:`, error);
    }
  }
}

/** Existing backup directories, newest first. */
function listBackups(): Array<string> {
  const backups: Array<{ dir: string; timestamp: number }> = [];

  let entries: Array<string> = [];

  try {
    entries = fs.readdirSync(OUT_DIR);
  } catch (error) {
    return [];
  }

  for (const entry of entries) {
    const match = entry.match(/^data_backup_(\d+)$/);
    if (!match) continue;

    const dir = path.join(OUT_DIR, entry);

    // Called, not merely read: `const { isDirectory } = fs.statSync(dir)` hands
    // back the function itself, which is always truthy, so a FILE named
    // data_backup_1234 used to count as a backup and get deleted with them.
    if (!fs.statSync(dir).isDirectory()) continue;

    backups.push({ dir, timestamp: Number(match[1]) });
  }

  // By timestamp, not by name. They are the same order today - millisecond
  // timestamps have had 13 digits since 2001 and will until 2286 - but the
  // question being asked is which is newest.
  return backups
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((backup) => backup.dir);
}
