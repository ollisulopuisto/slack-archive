import { describe, expect, it } from "vitest";
import fs from "fs";
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
});
