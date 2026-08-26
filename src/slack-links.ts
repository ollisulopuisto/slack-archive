/**
 * Links in the messages that point back at Slack, pointed at the archive
 * instead.
 *
 * People quote each other constantly, and a quote is a Slack permalink. Slack
 * keeps about ninety days; the archive keeps ten years - so by the time
 * anybody follows one of those links it usually leads to a message Slack has
 * thrown away, in a workspace not everybody reading the archive can even open.
 * The archive has the message. It should be the thing the link opens.
 *
 * Only this workspace's own links are touched, only for channels this site
 * actually publishes, and only for files the archive actually downloaded.
 * Anything else is somebody's link to somewhere else and is left exactly as
 * they wrote it.
 */
export interface ArchiveLinkContext {
  /** e.g. "morttisenmaansiirto.slack.com", from auth.test. */
  host?: string;
  /** e.g. "T2GVD377F", which appears in files.slack.com URLs. */
  teamId?: string;
  /** File id -> "<channelId>/<name on disk>". */
  files: Record<string, string>;
  /** Where attachments are served from - "" when they sit beside the pages. */
  filesBaseUrl: string;
  /** The channels this site publishes; nothing else may be linked. */
  channels: Set<string>;
}

export function archiveLinkContext(options: {
  teamUrl?: string;
  teamId?: string;
  files?: Record<string, string>;
  filesBaseUrl?: string;
  channels?: Set<string>;
}): ArchiveLinkContext {
  return {
    host: hostOf(options.teamUrl),
    teamId: options.teamId,
    files: options.files || {},
    filesBaseUrl: options.filesBaseUrl || "",
    channels: options.channels || new Set(),
  };
}

/** `p1722426397188379` -> `1722426397.188379`, Slack's own timestamp. */
function permalinkTimestamp(digits: string): string | undefined {
  if (digits.length < 7) return undefined;

  return `${digits.slice(0, digits.length - 6)}.${digits.slice(-6)}`;
}

function hostOf(url: string | undefined): string | undefined {
  const match = String(url || "").match(/^https?:\/\/([^/]+)/);

  return match ? match[1] : undefined;
}

export function rewriteSlackLinks(
  html: string,
  context: ArchiveLinkContext,
): string {
  if (!html) return html;

  let result = html;

  if (context.host) {
    const host = escapeRegExp(context.host);

    // A message: .../archives/C2GVD3L85/p1722426397188379[?thread_ts=...]
    result = result.replace(
      new RegExp(
        `https://${host}/archives/(C[A-Z0-9]+)/p(\\d+)(?:[^"'\\s<]*)`,
        "g",
      ),
      (match, channelId, digits) => {
        const ts = permalinkTimestamp(digits);

        if (!ts || !context.channels.has(channelId)) return match;

        // Through the index page, which owns the sidebar and knows which of a
        // channel's pages a timestamp is on. &amp; because this lands in HTML.
        return `../index.html?c=${channelId}&amp;ts=${ts}`;
      },
    );

    // A file: .../files/U2H06HULF/F0AL2LJ8L2Z/name.md
    result = result.replace(
      new RegExp(
        `https://${host}/files/U[A-Z0-9]+/(F[A-Z0-9]+)(?:[^"'\\s<]*)`,
        "g",
      ),
      (match, fileId) => archivedFileLink(fileId, context) || match,
    );
  }

  // A file, the other form: files.slack.com/files-pri/T2GVD377F-F0AL2LJ8L2Z/x
  if (context.teamId) {
    result = result.replace(
      new RegExp(
        `https://files\\.slack\\.com/files-[a-z]+/${escapeRegExp(
          context.teamId,
        )}-(F[A-Z0-9]+)(?:[^"'\\s<]*)`,
        "g",
      ),
      (match, fileId) => archivedFileLink(fileId, context) || match,
    );
  }

  return result;
}

function archivedFileLink(
  fileId: string,
  context: ArchiveLinkContext,
): string | undefined {
  const known = context.files[fileId];

  if (!known) return undefined;

  const [channelId] = known.split("/");

  if (!context.channels.has(channelId)) return undefined;

  return `${context.filesBaseUrl}files/${known}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
