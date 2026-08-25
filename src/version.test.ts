import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// The official semver.org regex. npm parses package.json's version with it, so
// this is the exact bar the field has to clear.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function packageVersion(): string {
  return fs.readJsonSync(path.join(ROOT, "package.json")).version;
}

/** The CalVer this build is called, from the one place it is declared. */
function declaredVersion(): string {
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const heading = changelog.match(/^## \[v?([0-9.]+)\]/m);

  expect(heading, "no '## [version]' heading in CHANGELOG.md").toBeTruthy();

  return heading![1];
}

describe("package.json version", () => {
  it("is valid semver", () => {
    // Four dot-separated numbers is not semver, and npm does not merely warn:
    // arborist compares an installed copy against a new one with semver.lt,
    // which throws `Invalid Version`. That aborts `npx github:...` for anyone
    // who has run it before, on every subsequent commit to main.
    expect(packageVersion()).toMatch(SEMVER);
  });

  it("agrees with the version the CHANGELOG declares", () => {
    // CalVer YY.MM.DD.BUILD -> semver YY.M.D+BUILD. Leading zeros are illegal
    // in a semver number, so the month and day lose theirs, and the build
    // number becomes build metadata - the only place semver has for a fourth
    // component. The CHANGELOG stays the source of truth; this only keeps
    // package.json from drifting away from it silently, the way it sat at
    // 26.06.14.124 for six releases.
    const [yy, mm, dd, build] = declaredVersion().split(".");

    expect(packageVersion()).toBe(`${yy}.${Number(mm)}.${Number(dd)}+${build}`);
  });
});
