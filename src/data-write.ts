import fs from "fs-extra";
import path from "path";
import { differenceBy } from "lodash-es";

import { retry } from "./retry.js";
import { SearchFile } from "./interfaces.js";
import { writeJsonArraySync, writeSearchDataSync } from "./big-json.js";

/**
 * An archive is written by one process and read by another.
 *
 * The renderer writes it, a verifier inspects it, a web server serves it, a
 * person opens it years later - often as different users. A umask of 0077
 * inside a container produces files only the writing uid can read, and the
 * symptom is not an error at write time but a publish that stops the next day
 * saying it "could not read search.js to check it". So the mode is set,
 * explicitly, rather than inherited from whatever the environment happened to
 * have. Same reasoning as chmod-after-mkdir: what is inherited is not
 * guaranteed, and what is not guaranteed will differ somewhere.
 *
 * Secrets pass `mode` and say so; nothing else has to think about it.
 */
const READABLE_FILE = 0o644;
const TRAVERSABLE_DIR = 0o755;

export async function write(
  filePath: string,
  data: any,
  options: { mode?: number } = {},
) {
  await retry({ name: `Writing ${filePath}` }, () => {
    ensureReadableDirs(filePath);
    fs.outputFileSync(filePath, data);
    fs.chmodSync(filePath, options.mode ?? READABLE_FILE);
  });
}

/** Every directory this write had to create, traversable by whoever reads. */
function ensureReadableDirs(filePath: string) {
  const missing: Array<string> = [];
  let dir = path.dirname(path.resolve(filePath));

  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    missing.push(dir);
    dir = path.dirname(dir);
  }

  fs.ensureDirSync(path.dirname(filePath));

  for (const created of missing.reverse()) {
    try {
      fs.chmodSync(created, TRAVERSABLE_DIR);
    } catch {
      // Somebody else's directory, or a filesystem with its own ideas. The
      // write itself is what matters.
    }
  }
}

/**
 * Write an array as JSON without ever building the whole file as one string.
 * A channel's messages outgrew V8's string limit; see `json-array.ts`.
 */
export async function writeJsonArray(filePath: string, items: unknown[]) {
  await retry({ name: `Writing ${filePath}` }, () => {
    ensureReadableDirs(filePath);
    writeJsonArraySync(filePath, items);
    fs.chmodSync(filePath, READABLE_FILE);
  });
}

/**
 * Write `search.js` without building the whole file as one string. See
 * `big-json.ts`.
 */
export async function writeSearchData(filePath: string, data: SearchFile) {
  await retry({ name: `Writing ${filePath}` }, () => {
    ensureReadableDirs(filePath);
    writeSearchDataSync(filePath, data);
    fs.chmodSync(filePath, READABLE_FILE);
  });
}

export async function writeAndMerge(filePath: string, newData: any) {
  await retry({ name: `Writing ${filePath}` }, () => {
    let dataToWrite = newData;

    if (fs.existsSync(filePath)) {
      const oldData = fs.readJSONSync(filePath);

      if (Array.isArray(oldData)) {
        if (newData && newData[0] && newData[0].id) {
          // Take the old data, exclude aything that is in the new data,
          // and then add the new data
          dataToWrite = [
            ...differenceBy(oldData, newData, (v: any) => v.id),
            ...newData,
          ];
        } else {
          dataToWrite = [...oldData, ...newData];
        }
      } else if (typeof newData === "object") {
        dataToWrite = { ...oldData, ...newData };
      } else {
        console.error(`writeAndMerge: Did not understand type of data`, {
          filePath,
          newData,
        });
      }
    }

    ensureReadableDirs(filePath);
    fs.outputFileSync(filePath, JSON.stringify(dataToWrite, undefined, 2));
    fs.chmodSync(filePath, READABLE_FILE);
  });
}
