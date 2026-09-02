import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

// The module imports node-fetch rather than using the global, so that is what
// has to be mocked - stubbing globalThis.fetch changes nothing here. vi.mock is
// hoisted above these imports, so both of them get the mocked module.
vi.mock("node-fetch", () => ({ default: vi.fn() }));

import fetch from "node-fetch";
import { config } from "./config.js";
import { downloadURL, shouldSendSlackToken } from "./download-files.js";

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

describe("shouldSendSlackToken", () => {
  it("is true only for Slack's own file hosts", () => {
    expect(
      shouldSendSlackToken("https://files.slack.com/files-pri/T1-F1/x.png"),
    ).toBe(true);
    expect(shouldSendSlackToken("https://slack-files.com/files-pri/T1/x")).toBe(
      true,
    );
  });

  it("is false for everything else, including Slack's public CDN", () => {
    // Avatars and emoji live on slack-edge and do not need the token. An
    // attacker-controlled url_private must never see it either.
    expect(
      shouldSendSlackToken("https://emoji.slack-edge.com/T1/party.png"),
    ).toBe(false);
    expect(shouldSendSlackToken("https://evil.example/steal")).toBe(false);
    expect(shouldSendSlackToken("not a url")).toBe(false);
  });
});

describe("downloadURL authorization", () => {
  beforeEach(() => {
    config.token = "xoxp-secret-token";
  });

  afterEach(() => {
    config.token = process.env.SLACK_TOKEN;
  });

  it("does not send the Slack token to a host that is not Slack's file store", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNG").buffer,
    } as any);

    await downloadURL("https://evil.example/x.png", path.join(dir, "x.png"));

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as any;
    expect(headers?.Authorization).toBeUndefined();
  });

  it("sends the token to files.slack.com", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("PNG").buffer,
    } as any);

    await downloadURL(
      "https://files.slack.com/files-pri/T1-F1/x.png",
      path.join(dir, "x.png"),
    );

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as any;
    expect(headers?.Authorization).toBe("Bearer xoxp-secret-token");
  });

  it("does not follow a redirect off Slack with the token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: {
          get: (name: string) =>
            name === "location" ? "https://evil.example/x" : null,
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("PNG").buffer,
      } as any);

    await downloadURL(
      "https://files.slack.com/files-pri/T1-F1/x.png",
      path.join(dir, "x.png"),
      { force: true },
    );

    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://evil.example/x");
    const headers = vi.mocked(fetch).mock.calls[1][1]?.headers as any;
    expect(headers?.Authorization).toBeUndefined();
  });
});
