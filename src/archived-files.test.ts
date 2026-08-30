import { describe, expect, it } from "vitest";

import {
  archivedFileName,
  externalFileUrl,
  fileDownloadUrl,
  isHiddenFile,
} from "./archived-files.js";

describe("archivedFileName()", () => {
  it("names the file the way the downloader named it: from the URL", () => {
    // The page used to build the name from `filetype`, which disagrees with
    // the URL for 988 files in this archive - .jpg for a .jpeg, .jpg for a
    // .png, .markdown for a .md - and every one of those links 404s.
    expect(
      archivedFileName({
        id: "F01QV8YFY5P",
        filetype: "jpg",
        url_private:
          "https://files.slack.com/files-pri/T1-F1/ev8pcbhwgaeeufs.jpeg",
      }),
    ).toBe("F01QV8YFY5P.jpeg");
  });

  it("keeps a file with no extension in its URL extension-less", () => {
    expect(
      archivedFileName({
        id: "F02U7C1DYF3",
        filetype: "docs",
        url_private: "https://files.slack.com/files-pri/T1-F1/lue_lisaa",
      }),
    ).toBe("F02U7C1DYF3");
  });

  it("ignores a query string", () => {
    expect(
      archivedFileName({
        id: "F1",
        url_private: "https://files.slack.com/files-pri/T1-F1/x.png?t=abc123",
      }),
    ).toBe("F1.png");
  });

  it("takes the thumbnail for an external file, which is what was downloaded", () => {
    expect(
      archivedFileName({
        id: "F2",
        is_external: true,
        url_private: "https://example.com/whatever",
        thumb_1024: "https://files.slack.com/x/thumb.gif",
      }),
    ).toBe("F2.gif");
  });

  it("is nothing for a file Slack hid behind the storage limit", () => {
    // 1 104 of these. No URL, no name, no type: they were never downloadable,
    // and the page linked every one of them as `F123.undefined`.
    expect(
      archivedFileName({ id: "F3", mode: "hidden_by_limit" }),
    ).toBeUndefined();
    expect(isHiddenFile({ id: "F3", mode: "hidden_by_limit" })).toBe(true);
  });

  it("is nothing when there is no URL at all", () => {
    expect(archivedFileName({ id: "F4" })).toBeUndefined();
    expect(fileDownloadUrl({ id: "F4" })).toBeUndefined();
  });
});

describe("externalFileUrl()", () => {
  it("is where a Google Doc actually lives", () => {
    // 25 of these. Slack lists them as files; they are links to Drive, there
    // was never a copy to download, and the page was linking a file that
    // cannot exist instead of the document itself.
    expect(
      externalFileUrl({
        id: "F2H07GFQF",
        filetype: "gdoc",
        mode: "external",
        is_external: true,
        url_private: "https://docs.google.com/document/d/1vm1dJd0",
      } as never),
    ).toBe("https://docs.google.com/document/d/1vm1dJd0");
  });

  it("is nothing for a file the archive downloaded itself", () => {
    expect(
      externalFileUrl({
        id: "F1",
        url_private: "https://files.slack.com/files-pri/T1-F1/x.png",
      }),
    ).toBeUndefined();
  });

  it("is nothing for a file Slack hid", () => {
    expect(
      externalFileUrl({ id: "F2", mode: "hidden_by_limit" }),
    ).toBeUndefined();
  });
});
