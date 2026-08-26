import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";

import { SLACK_ARCHIVE_DATA_PATH } from "./config.js";
import { getSlackArchiveData, setSlackArchiveData } from "./archive-data.js";

const AUTH = {
  ok: true,
  url: "https://morttisenmaansiirto.slack.com/",
  team_id: "T2GVD377F",
} as never;

describe("setSlackArchiveData()", () => {
  let existing: string | undefined;

  beforeEach(() => {
    existing = fs.existsSync(SLACK_ARCHIVE_DATA_PATH)
      ? fs.readFileSync(SLACK_ARCHIVE_DATA_PATH, "utf8")
      : undefined;
    fs.outputFileSync(
      SLACK_ARCHIVE_DATA_PATH,
      JSON.stringify({
        channels: { C1: { messages: 5, fullyDownloaded: true } },
        auth: AUTH,
      }),
    );
  });

  afterEach(() => {
    if (existing === undefined) fs.removeSync(SLACK_ARCHIVE_DATA_PATH);
    else fs.outputFileSync(SLACK_ARCHIVE_DATA_PATH, existing);
  });

  it("keeps who the archive belongs to when this run never asked", async () => {
    // A run with --no-slack-connect has no auth to report, and writing that
    // absence threw away the team URL - which is what tells the pages that a
    // link to morttisenmaansiirto.slack.com is a link to THIS archive.
    await setSlackArchiveData({
      channels: { C2: { messages: 1, fullyDownloaded: false } },
    });

    const data = await getSlackArchiveData();

    expect(data.auth).toEqual(AUTH);
    expect(Object.keys(data.channels)).toEqual(["C1", "C2"]);
  });

  it("takes a fresh answer when there is one", async () => {
    const newAuth = { ...(AUTH as object), user: "btngbldrgrndn" } as never;

    await setSlackArchiveData({ channels: {}, auth: newAuth });

    expect((await getSlackArchiveData()).auth).toEqual(newAuth);
  });
});
