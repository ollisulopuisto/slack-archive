import { describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import semver from "semver";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = fs
  .readFileSync(path.join(root, ".node-version"), "utf8")
  .trim();
const lock = fs.readJsonSync(path.join(root, "package-lock.json"));

describe(".node-version", () => {
  it("satisfies every engines range in the lockfile", () => {
    // npm does not fail on an OPTIONAL dependency whose engines exclude the
    // running node - it skips it silently and installs everything else. That
    // is how 22.11.0 got here: it is inside the hole in rolldown's
    // `^20.19.0 || >=22.12.0`, so vitest's native binding was never installed
    // and the whole test job died on a module not found, in a place with
    // nothing to do with the version that caused it.
    const unmet = Object.entries(
      lock.packages as Record<string, { engines?: { node?: string } }>,
    )
      .filter(([name]) => name !== "")
      .filter(([, meta]) => meta.engines?.node)
      .filter(
        ([, meta]) =>
          !semver.satisfies(version, meta.engines!.node!, {
            includePrerelease: true,
          }),
      )
      .map(([name, meta]) => `${name} needs ${meta.engines!.node}`);

    expect(unmet).toEqual([]);
  });

  it("is the major the image ships", () => {
    // A test run on a different major than production cannot cover the one
    // thing `npm run smoke` exists for: whether the emitted ESM loads.
    const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
    const images = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map(
      (match) => match[1],
    );

    expect(images.length).toBeGreaterThan(0);
    for (const major of images) {
      expect(major).toBe(semver.major(version).toString());
    }
  });
});
