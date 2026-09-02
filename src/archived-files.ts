import path from "path";

/**
 * One rule for what an archived attachment is called on disk, used by the
 * downloader that writes it and by the pages that link to it.
 *
 * They had two rules. The downloader named the file after the extension in
 * Slack's URL; the page linked `${id}.${file.filetype}`. Those agree for most
 * files and disagree for 988 of them - a .jpeg saved and a .jpg linked, a .png
 * saved and a .jpg linked, an .md saved and a .markdown linked - and every one
 * of those was a broken image on the site, indistinguishable from a file that
 * was never downloaded at all.
 */
export interface ArchivedFile {
  id?: string;
  filetype?: string;
  mimetype?: string;
  mode?: string;
  is_external?: boolean;
  url_private?: string;
  thumb_1024?: string;
  thumb_720?: string;
  thumb_480?: string;
  thumb_pdf?: string;
}

/**
 * A file Slack itself no longer serves: on a free plan, everything past the
 * storage limit comes back with a mode and nothing else - no URL, no name, no
 * type. There is nothing to download and nothing to link.
 */
export function isHiddenFile(file: ArchivedFile): boolean {
  return file?.mode === "hidden_by_limit";
}

/** The URL the archive downloads, which is not always `url_private`. */
export function fileDownloadUrl(file: ArchivedFile): string | undefined {
  if (!file || isHiddenFile(file)) return undefined;

  const url = file.is_external
    ? file.thumb_1024 || file.thumb_720 || file.thumb_480 || file.thumb_pdf
    : file.url_private;

  return url || undefined;
}

/** `F01QV8YFY5P.jpeg`, or nothing when there is no file to name. */
export function archivedFileName(file: ArchivedFile): string | undefined {
  const url = fileDownloadUrl(file);

  if (!file?.id || !url) return undefined;

  return `${file.id}${fileExtension(url)}`;
}

/**
 * Where a "file" that was never a file actually lives.
 *
 * A Google Doc shared into Slack is listed as a file with a `gdoc` type and no
 * content: `url_private` is the Drive URL, there is nothing to download, and
 * linking `F2H07GFQF.gdoc` on this site is a guaranteed 404. There are 25 of
 * them here. The document itself is what somebody wanted.
 */
export function externalFileUrl(file: ArchivedFile): string | undefined {
  if (!file || isHiddenFile(file) || archivedFileName(file)) return undefined;

  const url = file.url_private || "";

  // Not a Slack-hosted URL: that one is the archive's job, and if it is
  // missing the file is missing rather than elsewhere.
  if (!url || /(^|\.)slack\.com\//.test(url)) return undefined;

  return url;
}

/** The thumbnail the downloader writes beside a PDF. */
export function archivedThumbName(file: ArchivedFile): string | undefined {
  return file?.id ? `${file.id}.png` : undefined;
}

export function urlFileExtension(url: string): string {
  // Slack's URLs carry query strings; `?t=abc` is not a file extension.
  return path.extname(String(url).split("?")[0]);
}

function fileExtension(url: string): string {
  return urlFileExtension(url);
}
