import React from "react";

import { Channel, SlackArchiveData, User, Users } from "./interfaces.js";
import { UserNames } from "./user-names.js";
import { UserAvatars } from "./user-avatars.js";
import { UserStatuses } from "./user-status.js";
import { WorkspaceStats } from "./stats.js";
import { ArchiveLinkContext, archiveLinkContext } from "./slack-links.js";
import { Gap } from "./gaps.js";
import { indexMeta, PageMeta } from "./page-meta.js";

/**
 * Everything a page needs to know, in one object, built before anything is
 * rendered.
 *
 * It used to be fifteen mutable module-level variables, each set by one
 * function and read by another, so whether a page came out right depended on
 * the order the render happened to call things in. Two of today's bugs were
 * exactly that and neither of them threw: the profile links were decided
 * before the thing that knows which profiles exist had run, and the gap notice
 * was computed after the pages that count. A page that renders the wrong thing
 * silently is worse than one that fails, so the dependency is now a value that
 * has to be constructed before a page can be rendered at all.
 */
export interface RenderContext {
  /** Path prefix from THIS page to the html directory: "" or "html/". */
  base: string;
  /** Path prefix from THIS page to the site root: "" or "../". */
  root: string;
  users: Users;
  userNames: UserNames;
  userAvatars: UserAvatars;
  userStatuses: UserStatuses;
  /** Accounts the workspace marks as bots. */
  botIds: Set<string>;
  /** Everyone a profile page was actually written for. */
  profileIds: Set<string>;
  /** The channels this render publishes; nothing else may be linked to. */
  publishedChannels: Set<string>;
  /** The channels themselves, in the order the sidebar wants them. */
  channels: Array<Channel>;
  /** Where a Slack link in a message should point instead. */
  linkContext: ArchiveLinkContext;
  /** Stretches of days this archive holds nothing for. */
  gaps: Array<Gap>;
  stats: WorkspaceStats | null;
  /** What the whole archive is called. */
  teamMeta: PageMeta;
  /** When this render happened, ISO 8601. */
  renderedAt: string;
  slackArchiveData: SlackArchiveData;
  /** Whoever's token made the archive, for "you" in a DM's name. */
  me: User | null;
}

export function emptyRenderContext(): RenderContext {
  return {
    base: "",
    root: "",
    users: {},
    userNames: {},
    userAvatars: {},
    userStatuses: {},
    botIds: new Set(),
    profileIds: new Set(),
    publishedChannels: new Set(),
    channels: [],
    linkContext: archiveLinkContext({}),
    gaps: [],
    stats: null,
    teamMeta: indexMeta(undefined),
    renderedAt: "",
    slackArchiveData: { channels: {} },
    me: null,
  };
}

export const RenderContextProvider = React.createContext<RenderContext>(
  emptyRenderContext(),
);

/** What this page knows. Every component that needs the archive asks here. */
export function useRender(): RenderContext {
  return React.useContext(RenderContextProvider);
}
