import { describe, expect, it } from "vitest";

import { archiveLinkContext, rewriteSlackLinks } from "./slack-links.js";

const context = archiveLinkContext({
  teamUrl: "https://morttisenmaansiirto.slack.com/",
  teamId: "T2GVD377F",
  files: { F0AL2LJ8L2Z: "C2GVD3L85/F0AL2LJ8L2Z.md" },
  filesBaseUrl: "",
  channels: new Set(["C2GVD3L85"]),
});

describe("rewriteSlackLinks()", () => {
  it("sends a message permalink to the archive, not to Slack", () => {
    // Somebody quoting a 2024 message in 2026 linked it in Slack, and Slack
    // has thrown that message away. The archive still has it.
    expect(
      rewriteSlackLinks(
        `<a href="https://morttisenmaansiirto.slack.com/archives/C2GVD3L85/p1722426397188379">tuo</a>`,
        context,
      ),
    ).toBe(
      `<a href="../index.html?c=C2GVD3L85&amp;ts=1722426397.188379">tuo</a>`,
    );
  });

  it("keeps the thread parameters out of the way but the message right", () => {
    expect(
      rewriteSlackLinks(
        `<a href="https://morttisenmaansiirto.slack.com/archives/C2GVD3L85/p1722426397188379?thread_ts=1722425873.706879&amp;cid=C2GVD3L85">x</a>`,
        context,
      ),
    ).toContain("../index.html?c=C2GVD3L85&amp;ts=1722426397.188379");
  });

  it("points a file link at the copy the archive downloaded", () => {
    expect(
      rewriteSlackLinks(
        `<a href="https://files.slack.com/files-pri/T2GVD377F-F0AL2LJ8L2Z/marioil.md">tiedosto</a>`,
        context,
      ),
    ).toBe(`<a href="files/C2GVD3L85/F0AL2LJ8L2Z.md">tiedosto</a>`);
  });

  it("also rewrites the /files/ permalink form", () => {
    expect(
      rewriteSlackLinks(
        `<a href="https://morttisenmaansiirto.slack.com/files/U2H06HULF/F0AL2LJ8L2Z/marioil.md">t</a>`,
        context,
      ),
    ).toBe(`<a href="files/C2GVD3L85/F0AL2LJ8L2Z.md">t</a>`);
  });

  it("leaves a file the archive does not have pointing at Slack", () => {
    const html = `<a href="https://files.slack.com/files-pri/T2GVD377F-F09K7993138/x.mp3">m</a>`;

    expect(rewriteSlackLinks(html, context)).toBe(html);
  });

  it("leaves a channel this site does not publish alone", () => {
    // A link into a private channel must not become a link into a page that
    // was deliberately not rendered.
    const html = `<a href="https://morttisenmaansiirto.slack.com/archives/C0PRIVATE1/p1722426397188379">x</a>`;

    expect(rewriteSlackLinks(html, context)).toBe(html);
  });

  it("leaves another workspace alone", () => {
    const html = `<a href="https://esilukija.slack.com/archives/C2GVD3L85/p1722426397188379">x</a>`;

    expect(rewriteSlackLinks(html, context)).toBe(html);
  });

  it("copes with an archive that has no idea who it belongs to", () => {
    const bare = archiveLinkContext({});
    const html = `<a href="https://morttisenmaansiirto.slack.com/archives/C2GVD3L85/p1722426397188379">x</a>`;

    expect(rewriteSlackLinks(html, bare)).toBe(html);
  });
});
