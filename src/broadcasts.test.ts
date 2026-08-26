import { describe, expect, it } from "vitest";

import { withoutBroadcastCopies } from "./broadcasts.js";

const reply = { ts: "100.2", user: "U2", text: "the reply" };
const parent = {
  ts: "100.1",
  user: "U1",
  text: "the question",
  replies: [reply],
};
const broadcast = {
  ts: "100.2",
  user: "U2",
  text: "the reply",
  subtype: "thread_broadcast",
  thread_ts: "100.1",
};

describe("withoutBroadcastCopies()", () => {
  it("shows a reply sent to the channel once, in its thread", () => {
    // Slack stores "also send to channel" twice: as a top-level message and
    // inside the parent. Rendering both puts the message on the page twice
    // with the same id, which is invalid HTML and an ambiguous permalink.
    const page = withoutBroadcastCopies([parent, broadcast] as never);

    expect(page.map((m) => m.ts)).toEqual(["100.1"]);
  });

  it("keeps it when its thread is not on this page", () => {
    // Pages are chunks of a channel: a thread answered a week later has its
    // parent on another page, and dropping the copy here would lose it.
    const page = withoutBroadcastCopies([broadcast] as never);

    expect(page.map((m) => m.ts)).toEqual(["100.2"]);
  });

  it("leaves ordinary messages alone, including ordinary thread parents", () => {
    const other = { ts: "100.3", user: "U3", text: "unrelated" };

    expect(
      withoutBroadcastCopies([parent, other] as never).map((m) => m.ts),
    ).toEqual(["100.1", "100.3"]);
  });

  it("does not drop a message that merely shares a timestamp prefix", () => {
    const lookalike = { ts: "100.20", user: "U9", text: "different message" };

    expect(
      withoutBroadcastCopies([parent, lookalike] as never).map((m) => m.ts),
    ).toEqual(["100.1", "100.20"]);
  });
});
