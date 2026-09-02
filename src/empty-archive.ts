import fs from "fs-extra";
import path from "path";

/**
 * Wipe an archive directory without deleting the token.
 *
 * "Do not merge" used to `emptyDirSync` the whole tree, which took `.token`
 * with it. The current run still had the token in memory; the next one
 * prompted, or in automatic mode archived nothing.
 */
export function emptyArchive(dir: string, keep: Array<string> = [".token"]) {
  const preserved = new Set(keep);

  for (const entry of fs.readdirSync(dir)) {
    if (preserved.has(entry)) continue;

    fs.removeSync(path.join(dir, entry));
  }
}
