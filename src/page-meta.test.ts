import { describe, expect, it } from "vitest";

import {
  channelPageMeta,
  channelStatsMeta,
  indexMeta,
  profileMeta,
} from "./page-meta.js";

describe("page titles", () => {
  it("says which channel and which days a page holds", () => {
    // Every page in this archive was called "Slack". A tab, a browser history
    // entry and an unfurl all read that title, and all three said nothing.
    expect(
      channelPageMeta({
        name: "offtopic",
        first: "1555060000.000000",
        last: "1557060000.000000",
        index: 2,
        total: 12,
        messages: 342,
        team: "Mörttisen Maansiirto Ky",
      }),
    ).toEqual({
      title: "#offtopic · 12.4.2019 - 5.5.2019",
      description:
        "342 messages from #offtopic, page 3 of 12 of the Mörttisen Maansiirto Ky archive.",
    });
  });

  it("copes with a page whose timestamps are unreadable", () => {
    const meta = channelPageMeta({
      name: "offtopic",
      index: 0,
      total: 1,
      messages: 0,
    });

    expect(meta.title).toBe("#offtopic");
  });

  it("names a person and what the archive has of them", () => {
    expect(
      profileMeta({
        name: "tsippadai",
        messages: 243999,
        names: 29,
        channels: 22,
        first: "1475060000.000000",
        last: "1787060000.000000",
      }),
    ).toEqual({
      title: "tsippadai · in the archive",
      description:
        "243 999 messages, 29 names, 22 channels, 28.9.2016 - 18.8.2026.",
    });
  });

  it("names the workspace on the front page", () => {
    expect(indexMeta("Mörttisen Maansiirto Ky").title).toBe(
      "Mörttisen Maansiirto Ky · Slack archive",
    );
  });

  it("falls back to something true when it knows no team", () => {
    expect(indexMeta(undefined).title).toBe("Slack archive");
  });

  it("titles a channel's numbers as numbers", () => {
    expect(channelStatsMeta("offtopic", 51234).title).toBe(
      "#offtopic · in numbers",
    );
  });
});
