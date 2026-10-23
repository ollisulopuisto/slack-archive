import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { channelKind } from "./channels.js";
import { isOcrAllowedKind } from "./ocr.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "../scripts/list-ocr-inputs.mjs");

let archive: string;

beforeEach(() => {
  archive = fs.mkdtempSync(path.join(os.tmpdir(), "slack-archive-ocr-in-"));
  fs.mkdirSync(path.join(archive, "data"));
});

afterEach(() => {
  fs.removeSync(archive);
});

function list(channels: Array<Record<string, unknown>>, files: Array<string>) {
  fs.writeJsonSync(path.join(archive, "data", "channels.json"), channels);

  for (const file of files) {
    fs.writeFileSync(path.join(archive, "data", file), "[]");
  }

  return execFileSync("node", [script, archive], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

describe("list-ocr-inputs.mjs", () => {
  it("lists channels.json and the files of channels that may be read", () => {
    const lines = list(
      [
        { id: "C1" },
        { id: "G1", is_private: true },
        { id: "D1", is_im: true },
        { id: "M1", is_mpim: true, is_private: true },
      ],
      ["C1.json", "G1.json", "D1.json", "M1.json"],
    );

    expect(lines).toEqual(["channels.json", "C1.json", "G1.json"]);
  });

  it("never lists a direct message, whatever else it is flagged as", () => {
    const lines = list(
      [{ id: "D1", is_im: true, is_private: true }],
      ["D1.json"],
    );

    expect(lines).toEqual(["channels.json"]);
  });

  it("leaves out a channel that has no message file", () => {
    const lines = list([{ id: "C1" }, { id: "C2" }], ["C1.json"]);

    expect(lines).toEqual(["channels.json", "C1.json"]);
  });

  it("skips an entry with no id", () => {
    const lines = list([{ name: "nameless" }, { id: "C1" }], ["C1.json"]);

    expect(lines).toEqual(["channels.json", "C1.json"]);
  });

  it("agrees with isOcrAllowedKind about every kind of channel", () => {
    // The rule is written twice, because the script runs where the compiled
    // code does not. This is what stops the two from drifting apart.
    const channels = [
      { id: "CPUB" },
      { id: "CPRIV", is_private: true },
      { id: "CIM", is_im: true },
      { id: "CMPIM", is_mpim: true },
      { id: "CBOTH", is_im: true, is_private: true },
    ];
    const lines = list(
      channels,
      channels.map((channel) => `${channel.id}.json`),
    );

    for (const channel of channels) {
      const listed = lines.includes(`${channel.id}.json`);
      const allowed = isOcrAllowedKind(channelKind(channel as never));

      expect(listed, channel.id).toBe(allowed);
    }
  });
});
