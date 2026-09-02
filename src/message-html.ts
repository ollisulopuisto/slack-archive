import slackMarkdown from "slack-markdown";

import { Users } from "./interfaces.js";
import { ArchiveLinkContext, rewriteSlackLinks } from "./slack-links.js";
import { renderEmojiInHtml } from "./emoji-text.js";
import { getName } from "./users.js";

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE[char] || char);
}

export interface MessageHtmlOptions {
  users: Users;
  linkContext: ArchiveLinkContext;
  base: string;
}

/**
 * One block of Slack mrkdwn as HTML this archive will actually insert.
 *
 * slack-markdown's user/channel callbacks are inserted as HTML even when
 * escapeHTML is on, so a display name is escaped here, not left to the parser.
 */
export function renderMessageHtml(
  text: string,
  { users, linkContext, base }: MessageHtmlOptions,
): string {
  const slackCallbacks = {
    user: ({ id }: { id: string }) =>
      `@${escapeHtml(getName(id, users) || id)}`,
    channel: ({ id, name }: { id: string; name?: string }) =>
      `#${escapeHtml(name || id)}`,
    usergroup: ({ id, name }: { id: string; name?: string }) =>
      `^${escapeHtml(name || id)}`,
  };

  return renderEmojiInHtml(
    rewriteSlackLinks(
      slackMarkdown.toHTML(text, {
        escapeHTML: true,
        slackCallbacks,
      }),
      linkContext,
    ),
    base,
  );
}
