import { format } from "date-fns";
import fs from "fs-extra";
import path from "path";
import React from "react";
import ReactDOMServer from "react-dom/server";
import ora, { Ora } from "ora";
import { chunk, sortBy } from "lodash-es";
import { dirname } from "path";
import { fileURLToPath } from "url";
import esMain from "es-main";
import slackMarkdown from "slack-markdown";

import {
  clearMessagesCache,
  closeChannelFiles,
  getChannels,
  getMessagesWithSpans,
  getMessageSlice,
  getMessages,
  getUsers,
  getUserNames,
  getUserAvatars,
  getUserStatuses,
  getEmoji,
} from "./data-load.js";
import {
  ArchiveMessage,
  Channel,
  ChunksInfo,
  Message,
  Reaction,
  SlackArchiveData,
  User,
  Users,
} from "./interfaces.js";
import {
  getHTMLFilePath,
  INDEX_PATH,
  NAMES_PATH,
  PAGES_INDEX_PATH,
  SIDEBAR_PATH,
  STATS_PATH,
  BOTS_PATH,
  FILES_BASE_URL,
  HTML_EXCLUDE_KINDS,
  RENDER_WORKERS,
  START_CHANNEL,
  getAvatarHistoryFilePath,
  getProfileFilePath,
  getChannelStatsFilePath,
  OUT_DIR,
  MESSAGES_JS_PATH,
  FORCE_HTML_GENERATION,
} from "./config.js";
import { slackTimestampToJavaScriptTimestamp } from "./timestamp.js";
import { getPageIndex, recordPage } from "./search.js";
import { write } from "./data-write.js";
import { getSlackArchiveData } from "./archive-data.js";
import { getEmojiRef, getEmojiUnicode, isEmojiUnicode } from "./emoji.js";
import { splitQuotes } from "./blockquotes.js";
import { withoutBroadcastCopies } from "./broadcasts.js";
import { reportTimings, timed } from "./timings.js";
import { defaultWorkerCount, renderPagesInWorkers } from "./render-workers.js";
import { ChannelPlan, planChannel, shareOutPages } from "./render-plan.js";
import { pickStartChannel } from "./start-channel.js";
import { fillMonths, groupByYear, MonthPage } from "./calendar-nav.js";
import {
  emptyRenderContext,
  RenderContext,
  RenderContextProvider,
  useRender,
} from "./render-context.js";
import {
  archivedFileName,
  archivedThumbName,
  externalFileUrl,
} from "./archived-files.js";
import {
  channelPageMeta,
  channelStatsMeta,
  indexMeta,
  PageMeta,
  profileMeta,
} from "./page-meta.js";
import {
  ArchiveLinkContext,
  archiveLinkContext,
  rewriteSlackLinks,
} from "./slack-links.js";
import { getName } from "./users.js";
import {
  nameAt,
  nameHistory,
  slackTimestampToIso,
  UserName,
  UserNames,
} from "./user-names.js";
import { botUserIds, isChannelSearchable } from "./search-filter.js";
import { profilePageIds } from "./profiles.js";
import { dailyTotals, findGaps, Gap, gapBetween } from "./gaps.js";
import { estimateMissingByMonth, MonthEstimate } from "./estimate.js";
import { UserAvatars } from "./user-avatars.js";
import { UserStatuses } from "./user-status.js";
import {
  ChannelStats,
  createStats,
  EmojiStats,
  DayHourCube,
  profileEvents,
  ProfileEvent,
  UserStats,
  WorkspaceStats,
} from "./stats.js";
import {
  Area,
  Bars,
  Columns,
  Datum,
  Figure,
  formatCount,
  Tile,
} from "./charts.js";
import {
  isBotChannel,
  isDmChannel,
  isPrivateChannel,
  isPublicChannel,
} from "./channels.js";

const _dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGE_CHUNK = 1000;

/**
 * What every page of THIS render knows. Built once, before anything renders,
 * by buildRenderContext(); components read it through useRender().
 */
let render: RenderContext = emptyRenderContext();

/** File id -> "<channelId>/<name on disk>", collected while counting. */
const fileIndex: Record<string, string> = {};

/** Which pages each channel has, and where their messages are in the file. */
let channelPlans: Array<ChannelPlan> = [];

/**
 * The channels this site publishes. Not rendering beats gating: a page that
 * was never written cannot leak through a wrong proxy rule.
 */
function publishable(channels: Array<Channel>): Array<Channel> {
  return channels.filter((channel) =>
    isChannelSearchable(channel, HTML_EXCLUDE_KINDS),
  );
}

function formatTimestamp(message: Message, dateFormat = "PPPPpppp") {
  const jsTs = slackTimestampToJavaScriptTimestamp(message.ts);
  const ts = format(jsTs, dateFormat);

  return ts;
}

interface FilesProps {
  message: Message;
  channelId: string;
}
const Files: React.FunctionComponent<FilesProps> = (props) => {
  const { message, channelId } = props;
  const { files } = message;

  if (!files || files.length === 0) return null;

  const fileElements = files.map((file: any) => {
    const { thumb_1024, thumb_720, thumb_480, thumb_pdf } = file;
    const thumb = thumb_1024 || thumb_720 || thumb_480 || thumb_pdf;
    const name = archivedFileName(file);

    if (!name) {
      // A Google Doc shared into Slack is listed as a file and never was one.
      // The document is what somebody wanted, so link that.
      const elsewhere = externalFileUrl(file);

      if (elsewhere) {
        return (
          <a key={file.id} href={elsewhere} target="_blank" rel="noreferrer">
            {file.name || file.title || elsewhere}
          </a>
        );
      }

      // Nothing was downloaded and nothing can be: Slack hid it behind the
      // free plan's storage limit and kept only the id. Saying so is the whole
      // of what the archive knows; linking `F123.undefined` said it 551 times
      // in a way that looks like a broken archive rather than a deleted file.
      return (
        <span key={file.id} className="file-gone">
          {file.name || "A file"} - Slack no longer has this one
        </span>
      );
    }

    // Relative when the attachments sit beside the HTML; absolute when they
    // live somewhere the pages do not, e.g. a storage box behind a proxy. The
    // NAME comes from the same rule the downloader used, not from `filetype`,
    // which disagrees with it for 988 files here.
    let src = `${FILES_BASE_URL}files/${channelId}/${name}`;
    let href = src;

    if (file.mimetype?.startsWith("image")) {
      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    if (file.mimetype?.startsWith("video")) {
      return <video key={file.id} controls src={src} />;
    }

    if (file.mimetype?.startsWith("audio")) {
      return <audio key={file.id} controls src={src} />;
    }

    if (!file.mimetype?.startsWith("image") && thumb) {
      href = file.url_private || href;
      src = `${FILES_BASE_URL}files/${channelId}/${archivedThumbName(file)}`;

      return (
        <a key={file.id} href={href} target="_blank">
          <img className="file" src={src} />
        </a>
      );
    }

    return (
      <a key={file.id} href={href} target="_blank">
        {file.name}
      </a>
    );
  });

  return <div className="files">{fileElements}</div>;
};

interface AvatarProps {
  userId?: string;
}
const Avatar: React.FunctionComponent<AvatarProps> = ({ userId }) => {
  const { users, base } = useRender();

  if (!userId) return null;

  const user = users[userId];
  if (!user || !user.profile || !user.profile.image_512) return null;

  const ext = path.extname(user?.profile?.image_512!);
  const src = `${base}avatars/${userId}${ext}`;

  return <img className="avatar" src={src} />;
};

interface ParentMessageProps {
  message: ArchiveMessage;
  channelId: string;
}
const ParentMessage: React.FunctionComponent<ParentMessageProps> = (props) => {
  const { message, channelId } = props;
  const hasFiles = !!message.files;

  return (
    <Message message={message} channelId={channelId}>
      {hasFiles ? <Files message={message} channelId={channelId} /> : null}
      {message.reactions?.map((reaction: any) => (
        <Reaction key={reaction.name} reaction={reaction} />
      ))}
      {message.replies?.map((reply) => (
        <ParentMessage
          message={reply as ArchiveMessage}
          channelId={channelId}
          key={reply.ts}
        />
      ))}
    </Message>
  );
};

interface ReactionProps {
  reaction: Reaction;
}
const Reaction: React.FunctionComponent<ReactionProps> = ({ reaction }) => {
  const { users } = useRender();

  const reactors = [];

  if (reaction.users) {
    for (const userId of reaction.users) {
      reactors.push(getName(userId, users));
    }
  }

  return (
    <div className="reaction" title={reactors.join(", ")}>
      <Emoji name={reaction.name!} />
      <span>{reaction.count}</span>
    </div>
  );
};

interface EmojiProps {
  name: string;
}
const Emoji: React.FunctionComponent<EmojiProps> = ({ name }) => {
  const { base } = useRender();

  if (isEmojiUnicode(name)) {
    return <>{getEmojiUnicode(name)}</>;
  }

  const ref = getEmojiRef(name);

  // An emoji this workspace made but never downloaded: better the shortcode
  // than an empty box that says nothing about what was reacted with.
  if (!ref) {
    return <span className="emoji-missing">:{name}:</span>;
  }

  return <img src={`${base}${ref}`} alt={`:${name}:`} title={`:${name}:`} />;
};

interface MessageProps {
  message: ArchiveMessage;
  channelId: string;
  children?: React.ReactNode;
}
const Message: React.FunctionComponent<MessageProps> = (props) => {
  const { users, userNames, linkContext, profileIds } = useRender();

  const { message, channelId } = props;
  const username = getName(message.user, users);

  // What they were called WHEN THEY WROTE IT, not every name they have ever
  // had. People here rename themselves constantly, so a ten-year-old message
  // signed with today's name is unreadable - but the answer to that is one
  // name, not a catalogue. Listing all of them put up to 1 338 bytes on every
  // message and made 62% of a rendered page tooltips; the full list lives on
  // the profile page, one click away.
  const iso = slackTimestampToIso(message.ts);
  const thenKnownAs = iso ? nameAt(userNames, message.user, iso) : null;
  const wasCalled =
    thenKnownAs && thenKnownAs.toLowerCase() !== (username || "").toLowerCase()
      ? thenKnownAs
      : null;
  const slackCallbacks = {
    user: ({ id }: { id: string }) => `@${getName(id, users)}`,
  };

  // A profile page exists for everyone who wrote a message, except bots - they
  // get one page between them rather than one each. So the link is offered
  // when there is somewhere for it to go, and never when it would 404.
  const profile = profileHref(message.user, profileIds);

  const sender = (
    <span
      className="sender"
      title={wasCalled ? `Then known as ${wasCalled}` : undefined}
    >
      {username}
    </span>
  );

  return (
    <div className="message-gutter" id={message.ts}>
      <div className="" data-stringify-ignore="true">
        {profile ? (
          <a
            href={profile}
            className="author-link"
            title={`${username} - ten years of them`}
          >
            <Avatar userId={message.user} />
          </a>
        ) : (
          <Avatar userId={message.user} />
        )}
      </div>
      <div className="">
        {profile ? (
          <a href={profile} className="author-link">
            {sender}
          </a>
        ) : (
          sender
        )}
        {/* This page has its own URL, so the link somebody pastes into Slack
            is the address bar plus this anchor. */}
        <a
          className="timestamp"
          href={`#${message.ts}`}
          title="Link to this message"
        >
          <span className="c-timestamp__label">{formatTimestamp(message)}</span>
        </a>
        <br />
        <div className="text">
          {splitQuotes(message.text).map((block, i) => {
            const html = rewriteSlackLinks(
              slackMarkdown.toHTML(block.text, {
                escapeHTML: false,
                slackCallbacks,
              }),
              linkContext,
            );

            return block.quote ? (
              <blockquote key={i} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div key={i} dangerouslySetInnerHTML={{ __html: html }} />
            );
          })}
        </div>
        {props.children}
      </div>
    </div>
  );
};

interface MessagesPageProps {
  messages: Array<ArchiveMessage>;
  channel: Channel;
  index: number;
  chunksInfo: ChunksInfo;
  months: Array<MonthPage>;
}
const MessagesPage: React.FunctionComponent<MessagesPageProps> = (props) => {
  const { gaps, slackArchiveData } = useRender();

  const { channel, index, chunksInfo, months } = props;
  const messagesJs = fs.readFileSync(MESSAGES_JS_PATH, "utf8");

  // Newest message is first; the page reads oldest first. A reply sent with
  // "also send to channel" arrives twice - once here, once inside its parent -
  // and is shown in the thread.
  const oldestFirst = [...withoutBroadcastCopies(props.messages)].reverse();
  const messages: Array<React.ReactNode> = [];

  for (const [i, message] of oldestFirst.entries()) {
    // Where the archive stops and starts again, say so in place, rather than
    // letting September follow February as if nothing was in between.
    const gap = gapBetween(
      gaps,
      dayOf(oldestFirst[i - 1]?.ts),
      dayOf(message.ts),
    );

    if (gap) {
      messages.push(<GapDivider key={`gap-${gap.from}`} gap={gap} />);
    }

    messages.push(
      <ParentMessage
        key={message.ts}
        message={message}
        channelId={channel.id!}
      />,
    );
  }

  if (messages.length === 0) {
    messages.push(<span key="empty">No messages were ever sent!</span>);
  }

  const meta = channelPageMeta({
    name: channel.name || channel.id || "",
    first: oldestFirst[0]?.ts,
    last: oldestFirst[oldestFirst.length - 1]?.ts,
    index,
    total: chunksInfo.length,
    messages: props.messages.length,
    team: slackArchiveData.auth?.team,
  });

  return (
    <HtmlPage meta={meta}>
      <div className="page" style={{ paddingLeft: 10 }}>
        <Header
          index={index}
          chunksInfo={chunksInfo}
          channel={channel}
          months={months}
        />
        <div className="messages-list">{messages}</div>
        <script dangerouslySetInnerHTML={{ __html: messagesJs }} />
      </div>
    </HtmlPage>
  );
};

interface ChannelLinkProps {
  channel: Channel;
}
const ChannelLink: React.FunctionComponent<ChannelLinkProps> = ({
  channel,
}) => {
  const { slackArchiveData, me, base } = useRender();

  let name = channel.name || channel.id;
  let leadSymbol = <span className="lead">#</span>;

  const channelData = slackArchiveData.channels[channel.id!];
  if (channelData && channelData.messages === 0) {
    return null;
  }

  // Remove the user's name from the group mpdm channel name
  if (me && channel.is_mpim) {
    name = name?.replace(`@${me.name}`, "").replace("  ", " ");
  }

  if (channel.is_im && (channel as any).user) {
    leadSymbol = <Avatar userId={(channel as any).user} />;
  }

  if (channel.is_mpim) {
    leadSymbol = <></>;
    name = name?.replace("Group messaging with: ", "");
  }

  return (
    <li key={name}>
      <a title={name} href={`${base}${channel.id!}-0.html`}>
        {leadSymbol}
        <span>{name}</span>
      </a>
    </li>
  );
};

/** Used by a render worker: the context was built in the parent process. */
export function setRenderContext(context: RenderContext) {
  render = context;
}

/**
 * The pages this process was given, whichever process that is.
 *
 * A page reads only its own messages - the planner recorded the byte range
 * they occupy - so the biggest channel in the archive is no longer one
 * worker's problem.
 */
export async function renderPages(
  channels: Array<Channel>,
  plans: Array<ChannelPlan>,
) {
  const byId = new Map(channels.map((channel) => [channel.id!, channel]));
  const total = plans.reduce((n, plan) => n + plan.pages.length, 0);
  const spinner = ora({
    text: `Rendering ${total} pages`,
    // Several workers writing spinner frames to one terminal is illegible.
    isEnabled: !process.env.SLACK_ARCHIVE_QUIET,
  }).start();

  let done = 0;

  for (const plan of plans) {
    const channel = byId.get(plan.channelId);

    if (!channel) {
      console.warn(`Can't render pages for unknown channel ${plan.channelId}`);
      continue;
    }

    for (const page of plan.pages) {
      const messages = await getMessageSlice(plan.channelId, page.span);

      await renderAndWrite(
        <MessagesPage
          channel={channel}
          messages={messages}
          index={page.index}
          chunksInfo={plan.chunksInfo}
          months={plan.months}
        />,
        getHTMLFilePath(plan.channelId, page.index),
      );

      done++;
      spinner.text = `Rendering pages: ${done}/${total}`;
      spinner.render();
    }
  }

  closeChannelFiles();
  spinner.succeed(`Rendered ${done} pages`);
}

/**
 * The channel list, on every page.
 *
 * It used to exist once, in a frameset, with the conversation in an iframe
 * beside it - which meant no page had a URL of its own: sharing a message
 * meant sharing index.html plus a query string, the back button moved the
 * frame rather than the page, and the sidebar could not be part of a page that
 * somebody opened directly. Rendering it into all 1 143 pages costs about five
 * kilobytes each, on pages that are already the better part of a megabyte.
 */
const Sidebar: React.FunctionComponent = () => {
  const { users, channels, base, root, me } = useRender();
  const sortedChannels = sortBy(channels, "name");
  const links = (
    filter: (channel: Channel) => boolean,
    sort?: (a: Channel, b: Channel) => number,
  ) => {
    const list = sortedChannels.filter(filter);
    return (sort ? list.sort(sort) : list).map((channel) => (
      <ChannelLink key={channel.id} channel={channel} />
    ));
  };

  return (
    <>
      {/* The sidebar is a drawer on a narrow screen. A checkbox rather than a
          script, so it still works in a copy of this archive opened from a
          disk in ten years with no network and no expectations. */}
      <input
        type="checkbox"
        id="nav-toggle"
        className="nav-toggle"
        aria-label="Show the channel list"
      />
      <label htmlFor="nav-toggle" className="nav-open">
        <span aria-hidden="true">☰</span> Channels
      </label>
      <label htmlFor="nav-toggle" className="nav-backdrop" aria-hidden="true" />
      <div id="channels">
        {/* Search, from wherever you are. The index itself is 124 MB and
            cannot be in every page - but the box can be, and the search page
            picks the query up out of the URL. */}
        <form
          className="channel-search"
          action={`${root}search.html`}
          method="get"
          role="search"
        >
          <input
            type="search"
            name="q"
            placeholder="Search every message"
            aria-label="Search every message"
          />
          <button type="submit" aria-label="Search">
            <span aria-hidden="true">⌕</span>
          </button>
        </form>
        <p className="section">Public Channels</p>
        <ul>{links((c) => !!isPublicChannel(c) && !c.is_archived)}</ul>
        <p className="section">Private Channels</p>
        <ul>{links((c) => !!isPrivateChannel(c) && !c.is_archived)}</ul>
        <p className="section">DMs</p>
        <ul>
          {links(
            (c) => !!isDmChannel(c, users) && !users[c.user!].deleted,
            (a, b) => {
              // Self first, then alphabetically.
              if (me && a.user && a.user === me.id) return -1;
              return (a.name || "Unknown").localeCompare(b.name || "Unknown");
            },
          )}
        </ul>
        <p className="section">Group DMs</p>
        <ul>{links((c) => !!c.is_mpim)}</ul>
        <p className="section">Bots</p>
        <ul>
          {links(
            (c) => !!isBotChannel(c, users),
            (a, b) => (a.name && b.name ? a.name.localeCompare(b.name) : 1),
          )}
        </ul>
        <p className="section">Archived Public Channels</p>
        <ul>{links((c) => !!isPublicChannel(c) && !!c.is_archived)}</ul>
        <p className="section">Archived Private Channels</p>
        <ul>{links((c) => !!isPrivateChannel(c) && !!c.is_archived)}</ul>
        <p className="section">DMs (Deleted Users)</p>
        <ul>
          {links(
            (c) => !!isDmChannel(c, users) && !!users[c.user!].deleted,
            (a, b) => (a.name || "Unknown").localeCompare(b.name || "Unknown"),
          )}
        </ul>
        <p className="section">The archive itself</p>
        <ul>
          <li>
            <a href={`${root}search.html`}>Search every message</a>
          </li>
          <li>
            <a href={`${base}stats.html`}>Ten years in numbers</a>
          </li>
          <li>
            <a href={`${base}names.html`}>Names over the years</a>
          </li>
          <li>
            <a href={`${base}bots.html`}>What the bots did</a>
          </li>
          <li>
            <a href={`${root}index.html`}>The front page</a>
          </li>
        </ul>
        <Generated />
      </div>
    </>
  );
};

/**
 * The front page: what this archive is, in numbers, and the way in.
 *
 * It used to be the whole application - a frameset holding every other page in
 * an iframe. Now every page stands on its own, and this one is simply the door.
 */
const IndexPage: React.FunctionComponent = () => {
  const { stats, teamMeta, base, channels, gaps } = useRender();
  const messages: Record<string, number> = {};

  for (const [id, channel] of Object.entries(stats?.byChannel || {})) {
    messages[id] = channel.messages;
  }

  const first = pickStartChannel(channels, messages, START_CHANNEL);

  return (
    <HtmlPage meta={teamMeta}>
      <div id="front">
        <h1>{teamMeta.title}</h1>
        {stats ? (
          <>
            <p className="topic">
              {formatDay(stats.first)} - {formatDay(stats.last)}
            </p>
            <GapNotice />
            <div className="viz-tiles">
              <Tile label="Messages" value={formatCount(stats.messages)} />
              <Tile
                label="People"
                value={formatCount(
                  Object.values(stats.byUser).filter(
                    (person) => person.messages > 0 && !person.isBot,
                  ).length,
                )}
              />
              <Tile
                label="Channels"
                value={formatCount(
                  Object.values(stats.byChannel).filter(
                    (channel) => channel.messages > 0,
                  ).length,
                )}
              />
              <Tile
                label="Days missing"
                value={formatCount(gaps.reduce((n, gap) => n + gap.days, 0))}
                hint={gaps.length > 1 ? `in ${gaps.length} stretches` : ""}
              />
            </div>
          </>
        ) : null}
        <p className="front-links">
          {first ? (
            <a href={`${base}${first.id}-0.html`}>
              Start reading{first.name ? ` #${first.name}` : ""}
            </a>
          ) : null}{" "}
          · <a href={`${base}stats.html`}>Ten years in numbers</a> ·{" "}
          <a href={`${base}names.html`}>Names over the years</a>
        </p>

        {/* Old links, from before every page had its own URL: the archive's
            own messages carry them, they are pasted around Slack, and the bot
            generates them. They land here and get sent on. */}
        <script src={`${base}pages.js`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
            var params = new URLSearchParams(window.location.search);
            var channelValue = params.get("c");
            var tsValue = params.get("ts");

            if (channelValue) {
              var channel = decodeURIComponent(channelValue);
              var pages = window.ARCHIVE_PAGES || {};

              // A permalink names the channel and the moment, not the page
              // number - a page number is an accident of how the archive was
              // chunked, and it changes as the channel grows.
              if (!/-\d+$/.test(channel)) {
                var boundaries = pages[channel];
                var page = 0;

                if (boundaries && tsValue) {
                  page = boundaries.findIndex(function (start) {
                    return start < tsValue;
                  });
                  if (page < 0) page = boundaries.length - 1;
                }

                channel = channel + '-' + Math.max(0, page);
              }

              window.location.replace(
                "${"${base}"}" + channel + '.html' + (tsValue ? '#' + tsValue : '')
              );
            }
            `,
          }}
        />
      </div>
    </HtmlPage>
  );
};

interface HtmlPageProps {
  children?: React.ReactNode;
  meta?: PageMeta;
}
const HtmlPage: React.FunctionComponent<HtmlPageProps> = (props) => {
  const { teamMeta, base } = useRender();

  return (
    <html lang="en">
      <head>
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.meta?.title || teamMeta.title}</title>
        {/* What a preview of a shared link reads. Slack's own crawler cannot
            see these - the site answers it with a 401, which is the point of
            the gate - but the bot unfurling on the workspace's behalf can, and
            so can a browser tab, a bookmark and a history entry. */}
        <meta
          property="og:title"
          content={props.meta?.title || teamMeta.title}
        />
        <meta
          property="og:description"
          content={props.meta?.description || teamMeta.description}
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={teamMeta.title} />
        <meta
          name="description"
          content={props.meta?.description || teamMeta.description}
        />
        <link rel="stylesheet" href={`${base}style.css`} />
      </head>
      <body>
        <div id="index">
          <Sidebar />
          <main id="messages">{props.children}</main>
        </div>
        <script src={`${base}sidebar.js`} defer />
      </body>
    </html>
  );
};

interface HeaderProps {
  months: Array<MonthPage>;
  index: number;
  chunksInfo: ChunksInfo;
  channel: Channel;
}
const Header: React.FunctionComponent<HeaderProps> = (props) => {
  const { users, stats } = useRender();

  const { channel, index, chunksInfo, months } = props;
  let created;

  if (!channel.is_im && !channel.is_mpim) {
    const creator = getName(channel.creator, users);
    const time = channel.created
      ? format(channel.created * 1000, "PPPP")
      : "Unknown";

    created =
      creator && time ? (
        <span className="created">
          Created by {creator} on {time}
        </span>
      ) : null;
  }

  return (
    <div className="header">
      <h1>{channel.name || channel.id}</h1>
      {created}
      {/* Only where there is one: a channel nobody ever posted in gets no
          numbers page, and this linked to it anyway. */}
      {(stats?.byChannel[channel.id!]?.messages || 0) > 0 ? (
        <span className="created">
          <a href={`channel-${channel.id}.html`}>Ten years of this channel</a>
        </span>
      ) : null}
      <p className="topic">{channel.topic?.value}</p>
      <Pagination
        channelId={channel.id!}
        index={index}
        chunksInfo={chunksInfo}
        months={months}
      />
    </div>
  );
};

interface PaginationProps {
  months: Array<MonthPage>;
  index: number;
  chunksInfo: ChunksInfo;
  channelId: string;
}
const Pagination: React.FunctionComponent<PaginationProps> = (props) => {
  const { gaps } = useRender();
  const { index, channelId, chunksInfo, months } = props;
  const length = chunksInfo.length;

  if (length === 1) {
    return null;
  }

  const here = chunksInfo[index];
  const years = groupByYear(fillMonths(months));

  return (
    <div className="pagination">
      <span className="pages">
        {index > 0 ? (
          <a href={`${channelId}-${index - 1}.html`} rel="prev">
            ← Newer
          </a>
        ) : (
          <span className="spent">← Newer</span>
        )}
        <span className="where">
          {here ? `${here.newest} - ${here.oldest}` : `${index + 1}/${length}`}
        </span>
        {index + 1 < length ? (
          <a href={`${channelId}-${index + 1}.html`} rel="next">
            Older →
          </a>
        ) : (
          <span className="spent">Older →</span>
        )}
      </span>

      {/* Every page of the channel used to be one <select>, each option
          labelled with the timestamps at its ends. At 714 pages that is a list
          nobody can scan, and the thing a reader knows is "spring 2017", not a
          page number. Months are what people remember. */}
      {years.length > 0 ? (
        <details className="calendar">
          <summary>Jump to a month</summary>
          <div className="calendar-years">
            {years.map((year) => (
              <div className="calendar-year" key={year.year}>
                <span className="calendar-label">{year.year}</span>
                <span className="calendar-months">
                  {year.months.map((month) =>
                    month.page === undefined ? (
                      // Drawn, not omitted: an absent chip cannot say whether
                      // the channel was quiet or the archiver was not running.
                      <span
                        key={month.month}
                        className="empty"
                        title={
                          inAGap(gaps, month.month)
                            ? `${month.month} - not archived`
                            : `${month.month} - nothing was posted here`
                        }
                      >
                        {month.label}
                      </span>
                    ) : (
                      <a
                        key={month.month}
                        href={`${channelId}-${month.page}.html`}
                        className={month.page === index ? "current" : undefined}
                        title={month.month}
                      >
                        {month.label}
                      </a>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
};

const NamesPage: React.FunctionComponent = () => {
  const { users, userNames, botIds, profileIds } = useRender();

  const people = nameHistory(userNames, botIds).map((person) => ({
    ...person,
    current: getName(person.userId, users),
  }));

  const day = (iso: string) => iso.slice(0, 10);

  return (
    <HtmlPage
      meta={{
        title: "Names over the years",
        description: `${people.length} people and every name they have gone by, recovered from the messages themselves.`,
      }}
    >
      <div id="names">
        <h1>Names over the years</h1>
        <p className="topic">
          {people.length} people,{" "}
          {people.reduce((n, p) => n + p.names.length, 0)} names. Slack keeps no
          rename history - these were recovered from the messages themselves,
          and are kept from here on.
        </p>

        <GapNotice />
        {people.map((person) => (
          <div className="person" key={person.userId}>
            <h2>
              <Avatar userId={person.userId} />{" "}
              {profileHref(person.userId, profileIds) ? (
                <a href={profileHref(person.userId, profileIds)}>
                  {person.current}
                </a>
              ) : (
                person.current
              )}
            </h2>
            <table>
              <tbody>
                {person.names.map((name) => (
                  <tr key={name.nick}>
                    <td className="timestamp">
                      {day(name.first)}
                      {day(name.last) !== day(name.first)
                        ? ` - ${day(name.last)}`
                        : ""}
                    </td>
                    <td className="sender">{name.nick}</td>
                    <td className="kind">{nameKinds(name)}</td>
                    <td className="timestamp">{name.sources.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </HtmlPage>
  );
};

/**
 * Which of a channel's pages a timestamp is on.
 *
 * Every permalink into this archive - the ones in the messages, the ones
 * people paste into Slack - names a channel and a moment, and something has to
 * turn that into one of the channel's numbered pages. It is a few hundred
 * timestamps; search.js knows the same thing but is 124 MB.
 */
/**
 * The sidebar, as a fragment, for the search page.
 *
 * search.html is not rendered here - it is a template with a browser-side app
 * in it - so it had no channel list and no way back to the archive, which made
 * it the one page in the site that felt like a different site. It sits at the
 * root, so its links into html/ carry that prefix.
 */
async function writeSidebarFragment() {
  const html = ReactDOMServer.renderToStaticMarkup(
    <RenderContextProvider.Provider
      value={{ ...render, base: "html/", root: "" }}
    >
      <Sidebar />
    </RenderContextProvider.Provider>,
  );

  await write(SIDEBAR_PATH, html);
}

async function writePageIndex() {
  const index = getPageIndex();
  const published: Record<string, Array<string>> = {};

  for (const channelId of Object.keys(index)) {
    if (render.publishedChannels.has(channelId))
      published[channelId] = index[channelId];
  }

  await write(
    PAGES_INDEX_PATH,
    `window.ARCHIVE_PAGES = ${JSON.stringify(published)};\n`,
  );
}

async function renderNamesPage() {
  return renderAndWrite(<NamesPage />, NAMES_PATH);
}

/** The ISO day a message was posted, for gap comparisons. */
function dayOf(ts: string | undefined): string {
  return (slackTimestampToIso(ts || "") || "").slice(0, 10);
}

const NAME_KIND_WORDS: Record<string, string> = {
  display: "display name",
  handle: "handle",
  real: "real name",
};

/**
 * What kind of name this was, told apart rather than piled together: the
 * @-handle Slack knows the account by, the display name everyone actually
 * sees, and the real-name field. Older entries predate the distinction and
 * say where they came from instead.
 */
function nameKinds(name: UserName): string {
  const kinds = name.kinds || [];

  if (kinds.length === 0) {
    return name.sources.includes("attachment") ? "display name" : "";
  }

  return kinds.map((kind) => NAME_KIND_WORDS[kind] || kind).join(" + ");
}

/**
 * When these pages were made.
 *
 * A static archive gives a reader no way to tell yesterday's copy from one
 * that stopped updating in March, and this one is nightly - "last updated 3
 * days ago" is the difference between a working archive and a broken one. The
 * exact moment is in the markup and the phrase is worked out in the reader's
 * browser, so a page read a year from now does not still claim to be fresh.
 */
const Generated: React.FunctionComponent = () => {
  const { renderedAt, base } = useRender();

  return (
    <div className="generated">
      Archive generated{" "}
      <time dateTime={renderedAt} data-relative="">
        {formatIsoDay(renderedAt.slice(0, 10))}
      </time>
      <script src={`${base}relative-time.js`} defer />
    </div>
  );
};

/**
 * Every attachment this archive holds, by Slack's file id.
 *
 * A message that links a file by its Slack URL can then be pointed at the copy
 * on this site instead - which is the only copy, for anything Slack has since
 * hidden behind the storage limit.
 */
function indexFiles(channelId: string, messages: Array<ArchiveMessage>) {
  for (const message of messages) {
    for (const file of (message.files || []) as Array<any>) {
      const name = archivedFileName(file);

      if (file?.id && name) fileIndex[file.id] = `${channelId}/${name}`;
    }

    indexFiles(channelId, (message.replies || []) as Array<ArchiveMessage>);
  }
}

/** Whether a month falls inside a stretch the archive is missing. */
function inAGap(gaps: Array<Gap>, month: string): boolean {
  return gaps.some(
    (gap) => gap.from.slice(0, 7) <= month && month <= gap.to.slice(0, 7),
  );
}

/** "1.2.2022" from an ISO day. */
function formatIsoDay(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${Number(day)}.${Number(month)}.${year}`;
}

/**
 * What is missing, on every page that shows a number.
 *
 * Every count, chart and league table on these pages counts what was
 * archived. Where the archiver did not run, that is not the same as what was
 * said, and a chart that does not say so is simply wrong about those months.
 */
const GapNotice: React.FunctionComponent = () => {
  const { gaps } = useRender();

  if (gaps.length === 0) return null;

  const missing = gaps.reduce((n, gap) => n + gap.days, 0);

  return (
    <div className="gap-notice" role="note">
      <strong>
        The archive is missing {formatCount(missing)} days
        {gaps.length > 1 ? ` in ${gaps.length} stretches` : ""}.
      </strong>{" "}
      Nothing was archived{" "}
      {gaps.map((gap, i) => (
        <span key={gap.from}>
          {i > 0 ? (i === gaps.length - 1 ? " and " : ", ") : ""}
          <span className="gap-range">
            {formatIsoDay(gap.from)}&nbsp;-&nbsp;{formatIsoDay(gap.to)}
          </span>
        </span>
      ))}
      , because the archiver was not run. Slack does not have them either - the
      workspace keeps about 90 days of history, so what was not archived at the
      time is gone. Every number and chart on this page counts what was
      archived, not what was said.
    </div>
  );
};

/** The same thing, in one line, where a whole paragraph would be in the way. */
const GapDivider: React.FunctionComponent<{ gap: Gap }> = ({ gap }) => (
  <div className="gap-divider" role="note">
    {formatCount(gap.days)} days missing from the archive here -{" "}
    {formatIsoDay(gap.from)} to {formatIsoDay(gap.to)}. Not silence: nothing was
    archived then, and Slack no longer has it.
  </div>
);

/**
 * The link to somebody's profile page, or nothing when no page was written
 * for them - a channel member who never posted, or an account that only ever
 * reacted, has no page, and a link to it is a 404 with their name on it.
 */
function profileHref(
  userId: string | undefined,
  profileIds: Set<string>,
): string | undefined {
  return userId && profileIds.has(userId) ? `user-${userId}.html` : undefined;
}

/** Slack timestamp -> "12.4.2019". */
function formatDay(ts: string): string {
  const seconds = Number.parseFloat(ts || "");
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return format(seconds * 1000, "d.M.yyyy");
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The clickable year -> month -> day -> hour chart.
 *
 * Only the leaves travel: one number per day and hour, sparsely. Every level
 * above is summed in the browser, so the four levels cannot disagree - and a
 * decade of hourly buckets would be 87 600 numbers if it shipped dense.
 *
 * Server-rendered charts sit above this one, so a reader with no JavaScript
 * still gets the year and hour-of-day pictures and every number in a table.
 */
const Drilldown: React.FunctionComponent<{
  id: string;
  cube: DayHourCube;
}> = ({ id, cube }) => {
  const { base } = useRender();

  return (
    <div className="viz-figure">
      <div className="viz-figure-caption">
        <strong>Drill down</strong>
        <span className="viz-note">
          {" "}
          click a year, then a month, then a day
        </span>
      </div>
      <div className="drilldown" data-drilldown={`${id}-data`} />
      <script
        type="application/json"
        id={`${id}-data`}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(cube) }}
      />
      <script src={`${base}drilldown.js`} defer />
    </div>
  );
};

function yearData(byYear: Record<string, number>): Array<Datum> {
  const years = Object.keys(byYear).sort();
  if (years.length === 0) return [];

  // Every year between the first and the last, so a silent year reads as a gap
  // rather than being closed up as if it never happened.
  const from = Number(years[0]);
  const to = Number(years[years.length - 1]);
  const all: Array<Datum> = [];
  for (let year = from; year <= to; year++) {
    all.push({ label: String(year), value: byYear[String(year)] || 0 });
  }
  return all;
}

function hourData(byHour: Array<number>): Array<Datum> {
  return byHour.map((value, hour) => ({
    label: String(hour),
    value,
    title: `${String(hour).padStart(2, "0")}:00 - ${formatCount(value)} messages`,
  }));
}

function weekdayData(byWeekday: Array<number>): Array<Datum> {
  return byWeekday.map((value, i) => ({ label: WEEKDAYS[i], value }));
}

function monthData(
  byMonth: Record<string, number>,
  estimates: Record<string, MonthEstimate> = {},
): Array<Datum> {
  const months = Object.keys(byMonth).sort();
  if (months.length === 0) return [];

  const all: Array<Datum> = [];
  const [firstYear, firstMonth] = months[0].split("-").map(Number);
  const [lastYear, lastMonth] = months[months.length - 1]
    .split("-")
    .map(Number);
  let year = firstYear;
  let month = firstMonth;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    all.push({
      label: key,
      value: byMonth[key] || 0,
      estimate: estimates[key],
    });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return all;
}

const EVENT_WORDS: Record<ProfileEvent["kind"], string> = {
  name: "renamed",
  avatar: "new picture",
  joined: "joined",
  "first-message": "arrived",
  "last-message": "latest",
};

interface ProfilePageProps {
  userId: string;
  person: UserStats;
}

/**
 * One page per person: the shape of ten years above the fold, the detail below
 * it.
 *
 * Everything that would need scrolling past is a <details>. The complaint that
 * makes a page like this useless is having to scroll through somebody's forty
 * channels to reach the next thing, so the summary line answers the question
 * and opening it shows the working.
 */
const ProfilePage: React.FunctionComponent<ProfilePageProps> = ({
  userId,
  person,
}) => {
  const { users, userNames, userAvatars, userStatuses, stats, profileIds } =
    useRender();
  const names = userNames[userId] || [];
  const current = getName(userId, users);
  const events = stats
    ? profileEvents(userId, stats, userNames, userAvatars)
    : [];
  // Only the ones that are actually here. Slack refuses a good number of the
  // older avatar URLs now, and a row of broken images is worse than a shorter
  // row of real ones.
  const faces = (userAvatars[userId] || [])
    .map((avatar) => ({
      date: avatar.date,
      extension: (avatar.url.match(/\.[a-z0-9]+$/i) || [".jpg"])[0],
    }))
    .filter((face) =>
      fs.existsSync(
        getAvatarHistoryFilePath(userId, face.date, face.extension),
      ),
    );
  const years = yearData(person.byYear);
  const activeYears = Object.keys(person.byYear).length;

  return (
    <HtmlPage
      meta={profileMeta({
        name: current || userId,
        messages: person.messages,
        names: names.length,
        channels: person.channels.length,
        first: person.first,
        last: person.last,
      })}
    >
      <div id="profile">
        <div className="profile-head">
          <Avatar userId={userId} />
          <div>
            <h1>{current}</h1>
            <p className="topic">
              {names.length > 1
                ? `${names.length} names over the years`
                : "One name, as far as the archive knows"}
              {person.first
                ? ` · ${formatDay(person.first)} - ${formatDay(person.last)}`
                : ""}
            </p>
          </div>
        </div>

        <GapNotice />

        <div className="viz-tiles">
          <Tile label="Messages" value={formatCount(person.messages)} />
          <Tile label="Names" value={formatCount(names.length)} />
          <Tile label="Channels" value={formatCount(person.channels.length)} />
          <Tile label="Files" value={formatCount(person.files)} />
          <Tile
            label="Reactions received"
            value={formatCount(person.reactionsReceived)}
          />
          <Tile
            label="Reactions given"
            value={formatCount(person.reactionsGiven)}
          />
          <Tile label="Active years" value={formatCount(activeYears)} />
        </div>

        <Figure title="Messages per year" data={years}>
          <Columns data={years} />
        </Figure>

        <Drilldown id={`dd-${userId}`} cube={person.byDayHour} />

        <Figure
          title="When they post"
          note="hour of day, archive time"
          data={hourData(person.byHour)}
        >
          <Columns data={hourData(person.byHour)} labelEvery={3} />
        </Figure>

        {faces.length > 0 ? (
          <div className="viz-figure">
            <div className="viz-figure-caption">
              Faces over the years
              <span className="viz-note">
                {" "}
                dated by when Slack stored the picture
              </span>
            </div>
            <ul className="faces">
              {faces.map((face) => (
                <li key={face.date}>
                  <img
                    src={`avatars/history/${userId}/${face.date}${face.extension}`}
                    alt={`${current} in ${face.date.slice(0, 4)}`}
                    loading="lazy"
                  />
                  <span className="timestamp">{face.date}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <details className="drill" open>
          <summary>
            Timeline <span className="count">{events.length}</span>
          </summary>
          <table className="timeline">
            <tbody>
              {events.map((event, i) => (
                <tr key={`${event.ts}-${i}`}>
                  <td className="timestamp">{formatDay(event.ts)}</td>
                  <td className="kind">{EVENT_WORDS[event.kind]}</td>
                  <td>{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <details className="drill">
          <summary>
            Channels <span className="count">{person.channels.length}</span>
          </summary>
          <Bars
            data={person.channels.slice(0, 30).map((channel) => ({
              label: `#${channel.name}`,
              value: channel.messages,
              href: `${channel.id}-0.html`,
            }))}
          />
        </details>

        {(userStatuses[userId] || []).length > 0 ? (
          <details className="drill">
            <summary>
              Statuses{" "}
              <span className="count">
                {(userStatuses[userId] || []).length}
              </span>
            </summary>
            <table className="timeline">
              <tbody>
                {(userStatuses[userId] || []).map((status) => (
                  <tr
                    key={`${status.kind || "status"}-${status.emoji}-${status.text}`}
                  >
                    <td className="timestamp">
                      {status.first.slice(0, 10)}
                      {status.last.slice(0, 10) !== status.first.slice(0, 10)
                        ? ` - ${status.last.slice(0, 10)}`
                        : ""}
                    </td>
                    <td className="kind">
                      {status.kind === "title" ? "title" : "status"}
                    </td>
                    <td>
                      {status.emoji ? (
                        <span className="emoji-mark">
                          <Emoji name={status.emoji.replace(/:/g, "")} />
                        </span>
                      ) : null}{" "}
                      {status.text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}

        <details className="drill">
          <summary>
            Emoji they reach for{" "}
            <span className="count">
              {Object.keys(person.emojiGiven).length}
            </span>
          </summary>
          <EmojiRows
            emoji={Object.entries(person.emojiGiven)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 25)
              .map(([name, count]) => ({
                ...(stats?.emojiStats[name] || {
                  name,
                  custom: false,
                  first: "",
                  last: "",
                  byYear: {},
                  givers: {},
                }),
                name,
                count,
              }))}
          />
        </details>

        <details className="drill">
          <summary>
            Every name <span className="count">{names.length}</span>
          </summary>
          <table className="timeline">
            <tbody>
              {names.map((name) => (
                <tr key={name.nick}>
                  <td className="timestamp">
                    {name.first.slice(0, 10)}
                    {name.last.slice(0, 10) !== name.first.slice(0, 10)
                      ? ` - ${name.last.slice(0, 10)}`
                      : ""}
                  </td>
                  <td className="sender">{name.nick}</td>
                  <td className="kind">{nameKinds(name)}</td>
                  <td className="kind">{name.sources.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <p className="viz-note">
          Weekdays:{" "}
          {weekdayData(person.byWeekday)
            .map((d) => `${d.label} ${formatCount(d.value)}`)
            .join(" · ")}
        </p>
      </div>
    </HtmlPage>
  );
};

/** A reaction, drawn as itself where the archive has the picture. */
const EmojiRows: React.FunctionComponent<{
  emoji: Array<EmojiStats>;
}> = ({ emoji }) => {
  const max = Math.max(1, ...emoji.map((e) => e.count));

  return (
    <ul className="viz-bars emoji-bars">
      {emoji.map((entry) => (
        <li key={entry.name}>
          <span className="viz-bars-label">
            <span className="emoji-mark">
              <Emoji name={entry.name} />
            </span>
            :{entry.name}:
          </span>
          <span className="viz-bars-track">
            <span
              className="viz-bars-fill"
              style={{ width: `${Math.max(1, (entry.count / max) * 100)}%` }}
            />
          </span>
          <span className="viz-bars-value">{formatCount(entry.count)}</span>
        </li>
      ))}
    </ul>
  );
};

/** The whole workspace, ten years of it. */
const StatsPage: React.FunctionComponent<{ data: WorkspaceStats }> = ({
  data,
}) => {
  const { users, teamMeta, profileIds, estimates } = useRender();
  const people = Object.values(data.byUser)
    .filter((person) => person.messages > 0 && !person.isBot)
    .sort((a, b) => b.messages - a.messages);
  const humanMessages = data.messages - data.botMessages;

  const channels = Object.entries(data.channelNames)
    .map(([id, name]) => ({
      id,
      name,
      messages: people.reduce(
        (total, person) =>
          total + (person.channels.find((c) => c.id === id)?.messages || 0),
        0,
      ),
    }))
    .filter((channel) => channel.messages > 0)
    .sort((a, b) => b.messages - a.messages);

  const years = yearData(data.byYear);
  const months = monthData(data.byMonth, estimates);
  const allEmoji = Object.values(data.emojiStats).sort(
    (a, b) => b.count - a.count,
  );
  const customEmoji = allEmoji.filter((entry) => entry.custom);
  const givers = Object.values(data.byUser)
    .filter((person) => person.reactionsGiven > 0)
    .sort((a, b) => b.reactionsGiven - a.reactionsGiven);

  return (
    <HtmlPage
      meta={{
        title: `${teamMeta.title} · in numbers`,
        description: `${formatCount(data.messages)} messages, ${formatCount(
          Object.keys(data.byUser).length,
        )} people, ${formatCount(Object.keys(data.byChannel).length)} channels.`,
      }}
    >
      <div id="stats">
        <h1>Ten years of it</h1>
        <p className="topic">
          {formatDay(data.first)} - {formatDay(data.last)} ·{" "}
          <a href="bots.html">what the bots did</a>
        </p>

        <GapNotice />

        <div className="viz-tiles">
          <Tile
            label="Messages"
            value={formatCount(humanMessages)}
            hint={`people only · ${formatCount(data.botMessages)} more from bots`}
          />
          <Tile label="People who posted" value={formatCount(people.length)} />
          <Tile label="Channels" value={formatCount(channels.length)} />
          <Tile label="Files" value={formatCount(data.files)} />
          <Tile label="Reactions" value={formatCount(data.reactions)} />
          <Tile
            label="Thread replies"
            value={formatCount(data.replies)}
            hint={`${Math.round((data.replies / Math.max(1, data.messages)) * 100)}% of everything`}
          />
        </div>

        <Figure title="Messages per month" data={months}>
          <Area data={months} />
        </Figure>

        <Figure title="Messages per year" data={years}>
          <Columns data={years} />
        </Figure>

        <Drilldown id="dd-workspace" cube={data.byDayHour} />

        <Figure
          title="Hour of day"
          note="when this workspace is awake"
          data={hourData(data.byHour)}
        >
          <Columns data={hourData(data.byHour)} labelEvery={2} />
        </Figure>

        <Figure title="Day of week" data={weekdayData(data.byWeekday)}>
          <Columns data={weekdayData(data.byWeekday)} />
        </Figure>

        <details className="drill" open>
          <summary>
            Who talks <span className="count">{people.length}</span>
          </summary>
          <Bars
            data={people.slice(0, 25).map((person) => ({
              label: getName(person.userId, users) || person.userId,
              value: person.messages,
              href: profileHref(person.userId, profileIds),
            }))}
          />
        </details>

        <details className="drill">
          <summary>
            Busiest channels <span className="count">{channels.length}</span>
          </summary>
          <Bars
            data={channels.slice(0, 25).map((channel) => ({
              label: `#${channel.name}`,
              value: channel.messages,
              href: `channel-${channel.id}.html`,
            }))}
          />
        </details>

        <details className="drill" open>
          <summary>
            Reactions{" "}
            <span className="count">{formatCount(data.reactions)}</span>
          </summary>

          <div className="viz-tiles">
            <Tile label="Reactions" value={formatCount(data.reactions)} />
            <Tile
              label="Custom emoji used"
              value={formatCount(customEmoji.length)}
              hint={`of ${formatCount(allEmoji.length)} distinct`}
            />
            <Tile
              label="Reactions with our own emoji"
              value={`${Math.round(
                (data.customReactions / Math.max(1, data.reactions)) * 100,
              )}%`}
              hint={formatCount(data.customReactions)}
            />
          </div>

          <div className="viz-figure-caption">
            Our own emoji
            <span className="viz-note"> the workspace made these</span>
          </div>
          <EmojiRows emoji={customEmoji.slice(0, 30)} />

          <div className="viz-figure-caption">Every reaction</div>
          <EmojiRows emoji={allEmoji.slice(0, 20)} />

          <div className="viz-figure-caption">
            Who reacts
            <span className="viz-note">
              {" "}
              Slack truncates the list on a heavily-reacted message, so these
              are floors
            </span>
          </div>
          <Bars
            data={givers.slice(0, 20).map((person) => ({
              label: getName(person.userId, users) || person.userId,
              value: person.reactionsGiven,
              href: profileHref(person.userId, profileIds),
            }))}
          />
        </details>
      </div>
    </HtmlPage>
  );
};

/** The same three questions asked of one channel. */
const ChannelPage: React.FunctionComponent<{ channel: ChannelStats }> = ({
  channel,
}) => {
  const { users, stats, profileIds } = useRender();
  const posters = Object.entries(channel.byUser)
    .map(([userId, messages]) => ({ userId, messages }))
    .filter(({ userId }) => !stats?.byUser[userId]?.isBot)
    .sort((a, b) => b.messages - a.messages);

  const byYear: Record<string, number> = {};
  const byHour = new Array(24).fill(0);
  for (const [day, hours] of Object.entries(channel.byDayHour)) {
    for (const [hour, n] of Object.entries(hours)) {
      byYear[day.slice(0, 4)] = (byYear[day.slice(0, 4)] || 0) + n;
      byHour[Number(hour)] += n;
    }
  }

  const years = yearData(byYear);

  return (
    <HtmlPage meta={channelStatsMeta(channel.name, channel.messages)}>
      <div id="stats">
        <h1>#{channel.name}</h1>
        <p className="topic">
          {formatDay(channel.first)} - {formatDay(channel.last)} ·{" "}
          <a href={`${channel.id}-0.html`}>read the messages</a>
        </p>

        <GapNotice />

        <div className="viz-tiles">
          <Tile label="Messages" value={formatCount(channel.messages)} />
          <Tile label="People who posted" value={formatCount(posters.length)} />
          {channel.members.length > 0 ? (
            <Tile
              label="Members"
              value={formatCount(channel.members.length)}
              hint="as of the last run that could ask"
            />
          ) : null}
          <Tile
            label="Active years"
            value={formatCount(Object.keys(byYear).length)}
          />
        </div>

        <Figure title="Messages per year" data={years}>
          <Columns data={years} />
        </Figure>

        <Drilldown id={`dd-${channel.id}`} cube={channel.byDayHour} />

        <Figure title="Hour of day" data={hourData(byHour)}>
          <Columns data={hourData(byHour)} labelEvery={2} />
        </Figure>

        {channel.members.length > 0 ? (
          <details className="drill">
            <summary>
              Members <span className="count">{channel.members.length}</span>
            </summary>
            <p className="viz-note">
              Membership as it stands now. Slack cannot be asked who was in a
              channel last year, so this begins with the first run that recorded
              it.
            </p>
            <ul className="viz-bars">
              {channel.members.map((userId) => (
                <li key={userId}>
                  <span className="viz-bars-label">
                    {profileHref(userId, profileIds) ? (
                      <a href={profileHref(userId, profileIds)}>
                        {getName(userId, users) || userId}
                      </a>
                    ) : (
                      getName(userId, users) || userId
                    )}
                  </span>
                  <span />
                  <span className="viz-bars-value">
                    {formatCount(channel.byUser[userId] || 0)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <details className="drill" open>
          <summary>
            Who talks here <span className="count">{posters.length}</span>
          </summary>
          <Bars
            data={posters.slice(0, 25).map((poster) => ({
              label: getName(poster.userId, users) || poster.userId,
              value: poster.messages,
              href: profileHref(poster.userId, profileIds),
            }))}
          />
        </details>
      </div>
    </HtmlPage>
  );
};

/**
 * What the bots did, kept apart from what people did.
 *
 * Not deleted, and not folded into the totals either. Slackbot alone posted
 * more than most members here, and a "who talks" list it tops is a list about
 * nothing - but 68 000 messages are still 68 000 messages, and an archive that
 * silently reports a smaller corpus than it holds is lying about what it has.
 */
const BotsPage: React.FunctionComponent<{ data: WorkspaceStats }> = ({
  data,
}) => {
  const { users } = useRender();
  const bots = Object.values(data.byUser)
    .filter((account) => account.isBot && account.messages > 0)
    .sort((a, b) => b.messages - a.messages);

  const byYear: Record<string, number> = {};
  for (const bot of bots) {
    for (const [year, n] of Object.entries(bot.byYear)) {
      byYear[year] = (byYear[year] || 0) + n;
    }
  }

  const years = yearData(byYear);
  const share = Math.round(
    (data.botMessages / Math.max(1, data.messages)) * 100,
  );

  return (
    <HtmlPage
      meta={{
        title: "What the bots did",
        description: `${formatCount(data.botMessages)} messages from bots and apps, ${share}% of everything in the archive.`,
      }}
    >
      <div id="stats">
        <h1>What the bots did</h1>
        <p className="topic">
          Kept off the other pages so a leaderboard of people is a leaderboard
          of people · <a href="stats.html">back to the archive</a>
        </p>

        <GapNotice />

        <div className="viz-tiles">
          <Tile label="Messages" value={formatCount(data.botMessages)} />
          <Tile label="Share of everything" value={`${share}%`} />
          <Tile label="Bots and apps" value={formatCount(bots.length)} />
        </div>

        <Figure title="Bot messages per year" data={years}>
          <Columns data={years} />
        </Figure>

        <details className="drill" open>
          <summary>
            Who beeps <span className="count">{bots.length}</span>
          </summary>
          <Bars
            data={bots.map((bot) => ({
              label: getName(bot.userId, users) || bot.userId,
              value: bot.messages,
            }))}
          />
        </details>

        <details className="drill">
          <summary>Where they beep</summary>
          <table className="timeline">
            <tbody>
              {bots.slice(0, 20).map((bot) => (
                <tr key={bot.userId}>
                  <td className="sender">
                    {getName(bot.userId, users) || bot.userId}
                  </td>
                  <td>
                    {bot.channels
                      .slice(0, 6)
                      .map(
                        (channel) => `#${channel.name} (${channel.messages})`,
                      )
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </HtmlPage>
  );
};

/**
 * Count everything, and answer the two questions the pages cannot render
 * without: which days the archive is missing, and who has a profile page.
 *
 * Nothing is written here. It used to write the stats pages too, and set the
 * globals the channel pages needed as a side effect - so a page rendered
 * before this ran quietly linked to profiles that did not exist.
 */
async function countEverything(channels: Array<Channel>): Promise<{
  stats: WorkspaceStats;
  gaps: Array<Gap>;
  estimates: Record<string, MonthEstimate>;
  profileIds: Set<string>;
  plans: Array<ChannelPlan>;
}> {
  const plans: Array<ChannelPlan> = [];
  const spinner = ora("Counting ten years of messages...").start();
  // Everything in emojis.json is one the workspace made itself; everything else
  // in a reaction is Slack's.
  const accumulator = createStats({
    customEmoji: new Set(Object.keys(await getEmoji())),
    bots: render.botIds,
  });

  for (const channel of channels) {
    if (!channel.id) continue;
    spinner.text = `Counting ${channel.name || channel.id}`;
    spinner.render();

    const { messages, spans } = await getMessagesWithSpans(channel.id);
    accumulator.addChannel(channel, messages);
    indexFiles(channel.id, messages);

    plans.push(
      planChannel(channel.id, messages, spans, {
        chunkSize: MESSAGE_CHUNK,
        formatTimestamp: (message) => formatTimestamp(message as Message, "Pp"),
      }),
    );
  }

  const stats = accumulator.result();

  spinner.succeed(
    `Counted ${formatCount(stats.messages)} messages in ${
      Object.values(stats.byChannel).filter((c) => c.messages > 0).length
    } channels.`,
  );

  const daily = dailyTotals(stats.byDayHour);
  const gaps = findGaps(daily);

  return {
    stats,
    // Every page that shows a number says which days are absent from it.
    gaps,
    // And every chart of time draws what was probably there, without adding a
    // message of it to any total.
    estimates: estimateMissingByMonth(stats.byMonth, gaps),
    profileIds: profilePageIds(stats.byUser),
    plans,
  };
}

/** The pages that are about the numbers rather than about the messages. */
async function renderStatsAndProfiles() {
  const stats = render.stats!;
  const spinner = ora("Writing the numbers...").start();

  await renderAndWrite(<StatsPage data={stats} />, STATS_PATH);
  await renderAndWrite(<BotsPage data={stats} />, BOTS_PATH);

  for (const channel of Object.values(stats.byChannel)) {
    if (channel.messages === 0) continue;
    await renderAndWrite(
      <ChannelPage channel={channel} />,
      getChannelStatsFilePath(channel.id),
    );
  }

  let written = 0;
  for (const person of Object.values(stats.byUser)) {
    // Bots are on their own page; a profile page for Slackbot is a page about
    // a canned string.
    if (person.messages === 0 || person.isBot) continue;
    await renderAndWrite(
      <ProfilePage userId={person.userId} person={person} />,
      getProfileFilePath(person.userId),
    );
    written++;
  }

  spinner.succeed(
    `Wrote the numbers: ${
      Object.values(stats.byChannel).filter((c) => c.messages > 0).length
    } channels and ${written} profiles.`,
  );
}

async function renderIndexPage() {
  // The only page that does not live in html/, so the only one whose links
  // have to reach into it.
  return renderAndWrite(<IndexPage />, INDEX_PATH, "html/");
}

/*
 * createHtmlForChannel and renderMessagesPage lived here: the channel-at-a-time
 * render, replaced by renderPages, which works a page at a time so the biggest
 * channel is not one worker's problem. Left as dead code they were a second
 * path that nothing called and nothing tested - and the compiler only noticed
 * them at all because a new prop was added to the page they rendered.
 */

async function renderAndWrite(
  page: JSX.Element,
  filePath: string,
  base: string = "",
) {
  // A page in html/ reaches the site root through "..", the front page is
  // already there. One of the two is always right and neither is a guess.
  const root = base === "" ? "../" : "";

  const html = ReactDOMServer.renderToStaticMarkup(
    <RenderContextProvider.Provider value={{ ...render, base, root }}>
      {page}
    </RenderContextProvider.Provider>,
  );
  const htmlWDoc = "<!DOCTYPE html>" + html;

  await write(filePath, htmlWDoc);
}

export async function getChannelsToCreateFilesFor(
  channels: Array<Channel>,
  newMessages: Record<string, number>,
) {
  const result: Array<Channel> = [];

  // If HTML regeneration is forced, ignore everything
  // and just return all channels
  if (FORCE_HTML_GENERATION) {
    return await getChannels();
  }

  for (const channel of channels) {
    if (channel.id) {
      // Do we have new messages?
      if (newMessages[channel.id] > 0) {
        result.push(channel);
      }

      // Did we never create a file?
      if (!fs.existsSync(getHTMLFilePath(channel.id!, 0))) {
        result.push(channel);
      }
    }
  }

  return result;
}

async function buildRenderContext(
  channels: Array<Channel>,
): Promise<RenderContext> {
  const users = await getUsers();
  const slackArchiveData = await getSlackArchiveData();
  const publishedChannels = new Set(
    channels.map((channel) => channel.id!).filter(Boolean),
  );

  render = {
    ...emptyRenderContext(),
    users,
    userNames: await getUserNames(),
    userAvatars: await getUserAvatars(),
    userStatuses: await getUserStatuses(),
    botIds: botUserIds(users),
    publishedChannels,
    channels,
    slackArchiveData,
    teamMeta: indexMeta(slackArchiveData.auth?.team),
    renderedAt: new Date().toISOString(),
    me: slackArchiveData.auth?.user_id
      ? users[slackArchiveData.auth.user_id]
      : null,
  };

  // Reads every message, so it also collects the files that the links in those
  // messages need, and plans the pages.
  const { plans, ...counted } = await countEverything(channels);
  channelPlans = plans;

  return {
    ...render,
    ...counted,
    linkContext: archiveLinkContext({
      teamUrl: slackArchiveData.auth?.url,
      teamId: slackArchiveData.auth?.team_id,
      files: fileIndex,
      filesBaseUrl: FILES_BASE_URL,
      channels: publishedChannels,
    }),
  };
}

export async function createHtmlForChannels(allChannels: Array<Channel> = []) {
  const channels = publishable(allChannels);

  if (channels.length < allChannels.length) {
    console.log(
      `\n Not rendering ${allChannels.length - channels.length} channels (${[
        ...HTML_EXCLUDE_KINDS,
      ].join(", ")})`,
    );
  }

  console.log(`\n Creating HTML files for ${channels.length} channels...`);

  render = await timed("reading and counting", () =>
    buildRenderContext(channels),
  );

  await timed("numbers pages", () => renderStatsAndProfiles());
  await timed("names page", () => renderNamesPage());

  await timed("channel pages", async () => {
    // The permalink index, recorded here rather than by whoever renders the
    // page. It is derived from the plan, so it is in page order and complete
    // whether one process renders or nine do - and a worker reporting it back
    // was one more thing that could arrive out of order.
    for (const plan of channelPlans) {
      for (const page of plan.pages) {
        if (page.oldestTs) recordPage(plan.channelId, page.oldestTs);
      }
    }

    const workers = defaultWorkerCount(RENDER_WORKERS);

    if (workers < 2) {
      await renderPages(channels, channelPlans);
      return;
    }

    // The parent has just parsed every message to count them, and is about to
    // hand the rendering to processes that read only the pages they were
    // given. Holding 1.5 GB of messages nobody will look at again, while eight
    // workers allocate their own, is how this runs out of memory.
    clearMessagesCache();

    const buckets = shareOutPages(channelPlans, workers);
    const pages = channelPlans.reduce((n, plan) => n + plan.pages.length, 0);
    console.log(`\n Rendering ${pages} pages on ${buckets.length} cores`);

    await renderPagesInWorkers(render, channels, buckets);
  });

  await timed("front page", async () => {
    await writePageIndex();
    await writeSidebarFragment();
    await renderIndexPage();
  });

  // Copy in fonts & css
  // static/search.html is the TEMPLATE for the search page, with placeholder
  // comments where the scripts go. createSearchHTML fills it in and writes the
  // result to the archive root. Copying it here as well shipped the unfilled
  // template into html/, where it looks like a second, broken search page -
  // and it is what somebody assembling a site would reasonably pick up.
  fs.copySync(path.join(_dirname, "../static"), path.join(OUT_DIR, "html/"), {
    filter: (src) => path.basename(src) !== "search.html",
  });

  console.log(`\n ${reportTimings("Rendered")}`);
}

if (esMain(import.meta)) {
  createHtmlForChannels();
}
