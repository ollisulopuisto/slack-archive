import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

// The module imports node-fetch rather than using the global, so that is what
// has to be mocked - stubbing globalThis.fetch changes nothing here. vi.mock is
// hoisted above these imports, so both of them get the mocked module.
vi.mock("node-fetch", () => ({ default: vi.fn() }));

import fetch from "node-fetch";
import { downloadURL } from "./download-files.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-dl-"));
});

afterEach(() => {
  fs.removeSync(dir);
  vi.mocked(fetch).mockReset();
});

describe("downloadURL", () => {
  it("writes what the server sent", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNGDATA").buffer,
    } as any);

    const filePath = path.join(dir, "avatar.png");
    await downloadURL("https://example/avatar.png", filePath);

    expect(fs.readFileSync(filePath, "utf8")).toBe("PNGDATA");
  });

  // Slack answers 403 with a 243-byte XML document for avatars and files whose
  // links have expired. Written to disk under the requested name, that is an
  // error page called avatar.png - a broken image that looks downloaded, and
  // which the existence check then skips forever on later runs.
  it("writes nothing when the server refuses", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      arrayBuffer: async () =>
        new TextEncoder().encode("<Error>AccessDenied</Error>").buffer,
    } as any);

    const filePath = path.join(dir, "avatar.png");
    await downloadURL("https://example/avatar.png", filePath);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("leaves an existing file alone unless forced", async () => {
    const filePath = path.join(dir, "avatar.png");
    fs.outputFileSync(filePath, "OLD");
    await downloadURL("https://example/avatar.png", filePath);

    expect(fetch).not.toHaveBeenCalled();
    expect(fs.readFileSync(filePath, "utf8")).toBe("OLD");
  });
});
