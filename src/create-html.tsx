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
  getChannels,
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
  STATS_PATH,
  BOTS_PATH,
  FILES_BASE_URL,
  HTML_EXCLUDE_KINDS,
  getAvatarHistoryFilePath,
  getProfileFilePath,
  getChannelStatsFilePath,
  OUT_DIR,
  MESSAGES_JS_PATH,
  FORCE_HTML_GENERATION,
} from "./config.js";
import { slackTimestampToJavaScriptTimestamp } from "./timestamp.js";
import { recordPage } from "./search.js";
import { write } from "./data-write.js";
import { getSlackArchiveData } from "./archive-data.js";
import { getEmojiRef, getEmojiUnicode, isEmojiUnicode } from "./emoji.js";
import { getName } from "./users.js";
import {
  nameAt,
  nameHistory,
  slackTimestampToIso,
  UserNames,
} from "./user-names.js";
import { botUserIds, isChannelSearchable } from "./search-filter.js";
import { profilePageIds } from "./profiles.js";
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

// This used to be a prop on the components, but passing it around
// was surprisingly slow. Global variables are cool again!
// Set by createHtmlForChannels().
let users: Users = {};
let userNames: UserNames = {};
let stats: WorkspaceStats | null = null;

/**
 * The channels this archive may render.
 *
 * One predicate, applied everywhere channels are enumerated: the pages, the
 * index, the stats and the counting behind them. isChannelSearchable asks
 * exactly the same question of a different list, so it is the same function.
 */
function publishable(channels: Array<Channel>): Array<Channel> {
  return channels.filter((channel) =>
    isChannelSearchable(channel, HTML_EXCLUDE_KINDS),
  );
}
let userAvatars: UserAvatars = {};
let userStatuses: UserStatuses = {};
/** Accounts the workspace marks as bots: they have no profile page to link to. */
let botIds: Set<string> = new Set();
/** Everyone a profile page was actually written for. Filled in before the
 * channel pages are rendered, because they link to it. */
let profileIds: Set<string> = new Set();
let slackArchiveData: SlackArchiveData = { channels: {} };
let me: User | null;

// Little hack to switch between ./index.html and ./html/...
let base = "";

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
    // Relative when the attachments sit beside the HTML; absolute when they
    // live somewhere the pages do not, e.g. a storage box behind a proxy.
    let src = `${FILES_BASE_URL}files/${channelId}/${file.id}.${file.filetype}`;
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
      src = src.replace(`.${file.filetype}`, ".png");

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
  const { message } = props;
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
  const profile = profileHref(message.user);

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
        <a
          className="timestamp"
          href={`#${message.ts}`}
          title="Link to this message"
        >
          <span className="c-timestamp__label">{formatTimestamp(message)}</span>
        </a>
        <br />
        <div
          className="text"
          dangerouslySetInnerHTML={{
            __html: slackMarkdown.toHTML(message.text || "", {
              escapeHTML: false,
              slackCallbacks,
            }),
          }}
        />
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
}
const MessagesPage: React.FunctionComponent<MessagesPageProps> = (props) => {
  const { channel, index, chunksInfo } = props;
  const messagesJs = fs.readFileSync(MESSAGES_JS_PATH, "utf8");

  // Newest message is first
  const messages = props.messages
    .map((m) => (
      <ParentMessage key={m.ts} message={m} channelId={channel.id!} />
    ))
    .reverse();

  if (messages.length === 0) {
    messages.push(<span key="empty">No messages were ever sent!</span>);
  }

  return (
    <HtmlPage>
      <div style={{ paddingLeft: 10 }}>
        <Header index={index} chunksInfo={chunksInfo} channel={channel} />
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
  let name = channel.name || channel.id;
  let leadSymbol = <span># </span>;

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
      <a title={name} href={`html/${channel.id!}-0.html`} target="iframe">
        {leadSymbol}
        <span>{name}</span>
      </a>
    </li>
  );
};

interface IndexPageProps {
  channels: Array<Channel>;
}
const IndexPage: React.FunctionComponent<IndexPageProps> = (props) => {
  const { channels } = props;
  const sortedChannels = sortBy(channels, "name");

  const publicChannels = sortedChannels
    .filter((channel) => isPublicChannel(channel) && !channel.is_archived)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const publicArchivedChannels = sortedChannels
    .filter((channel) => isPublicChannel(channel) && channel.is_archived)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const privateChannels = sortedChannels
    .filter((channel) => isPrivateChannel(channel) && !channel.is_archived)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const privateArchivedChannels = sortedChannels
    .filter((channel) => isPrivateChannel(channel) && channel.is_archived)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const dmChannels = sortedChannels
    .filter(
      (channel) => isDmChannel(channel, users) && !users[channel.user!].deleted,
    )
    .sort((a, b) => {
      // Self first
      if (me && a.user && a.user === me.id) {
        return -1;
      }

      // Then alphabetically
      return (a.name || "Unknown").localeCompare(b.name || "Unknown");
    })
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const dmDeletedChannels = sortedChannels
    .filter(
      (channel) => isDmChannel(channel, users) && users[channel.user!].deleted,
    )
    .sort((a, b) => (a.name || "Unknown").localeCompare(b.name || "Unknown"))
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const groupChannels = sortedChannels
    .filter((channel) => channel.is_mpim)
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  const botChannels = sortedChannels
    .filter((channel) => isBotChannel(channel, users))
    .sort((a, b) => {
      if (a.name && b.name) {
        return a.name!.localeCompare(b.name!);
      }

      return 1;
    })
    .map((channel) => <ChannelLink key={channel.id} channel={channel} />);

  return (
    <HtmlPage>
      <div id="index">
        <div id="channels">
          <p className="section">Public Channels</p>
          <ul>{publicChannels}</ul>
          <p className="section">Private Channels</p>
          <ul>{privateChannels}</ul>
          <p className="section">DMs</p>
          <ul>{dmChannels}</ul>
          <p className="section">Group DMs</p>
          <ul>{groupChannels}</ul>
          <p className="section">Bots</p>
          <ul>{botChannels}</ul>
          <p className="section">Archived Public Channels</p>
          <ul>{publicArchivedChannels}</ul>
          <p className="section">Archived Private Channels</p>
          <ul>{privateArchivedChannels}</ul>
          <p className="section">DMs (Deleted Users)</p>
          <ul>{dmDeletedChannels}</ul>
          <p className="section">The archive itself</p>
          <ul>
            <li>
              <a href="search.html" target="iframe">
                Search every message
              </a>
            </li>
            <li>
              <a href="html/stats.html" target="iframe">
                Ten years in numbers
              </a>
            </li>
            <li>
              <a href="html/names.html" target="iframe">
                Names over the years
              </a>
            </li>
            <li>
              <a href="html/bots.html" target="iframe">
                What the bots did
              </a>
            </li>
          </ul>
        </div>
        <div id="messages">
          <iframe name="iframe" src={`html/${channels[0].id!}-0.html`} />
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
            const urlSearchParams = new URLSearchParams(window.location.search);
            const channelValue = urlSearchParams.get("c");
            const tsValue = urlSearchParams.get("ts");
            
            if (channelValue) {
              const iframe = document.getElementsByName('iframe')[0]
              iframe.src = "html/" + decodeURIComponent(channelValue) + '.html' + '#' + (tsValue || '');
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
}
const HtmlPage: React.FunctionComponent<HtmlPageProps> = (props) => {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Slack</title>
        <link rel="stylesheet" href={`${base}style.css`} />
      </head>
      <body>{props.children}</body>
    </html>
  );
};

interface HeaderProps {
  index: number;
  chunksInfo: ChunksInfo;
  channel: Channel;
}
const Header: React.FunctionComponent<HeaderProps> = (props) => {
  const { channel, index, chunksInfo } = props;
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
      <span className="created">
        <a href={`channel-${channel.id}.html`}>Ten years of this channel</a>
      </span>
      <p className="topic">{channel.topic?.value}</p>
      <Pagination
        channelId={channel.id!}
        index={index}
        chunksInfo={chunksInfo}
      />
    </div>
  );
};

interface PaginationProps {
  index: number;
  chunksInfo: ChunksInfo;
  channelId: string;
}
const Pagination: React.FunctionComponent<PaginationProps> = (props) => {
  const { index, channelId, chunksInfo } = props;
  const length = chunksInfo.length;

  if (length === 1) {
    return null;
  }

  const older =
    index + 1 < length ? (
      <span>
        <a href={`${channelId}-${index + 1}.html`}>Older Messages</a>
      </span>
    ) : null;
  const newer =
    index > 0 ? (
      <span>
        <a href={`${channelId}-${index - 1}.html`}>Newer Messages </a>
      </span>
    ) : null;
  const sep1 = older && newer ? " | " : null;
  const sep2 = older || newer ? " | " : null;

  const options: Array<JSX.Element> = [];
  for (const [i, chunk] of chunksInfo.entries()) {
    const text = `${i} - ${chunk.newest} to ${chunk.oldest}`;
    const value = `${channelId}-${i}.html`;
    options.push(
      <option key={value} value={value}>
        {text}
      </option>,
    );
  }

  return (
    <div className="pagination">
      {newer}
      {sep1}
      {older}
      {sep2}
      <div className="jumper">
        <select id="jumper" defaultValue={`${channelId}-${index}.html`}>
          {options}
        </select>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.getElementById("jumper").onchange = function () {
                window.location.href = this.value;
              }
            `,
          }}
        />
      </div>
    </div>
  );
};

/**
 * Everyone the archive knows, and everything they have been called.
 *
 * Slack keeps no rename history, so this page is the only place the answer
 * exists. Dates are when a name was SEEN, not when it was adopted: a name mined
 * from a mention is dated by the message, one recovered from an older rendering
 * of these pages by when that page was written, which is coarser. The source is
 * shown for each so the difference is visible rather than implied.
 */
const NamesPage: React.FunctionComponent = () => {
  const people = nameHistory(userNames, botIds).map((person) => ({
    ...person,
    current: getName(person.userId, users),
  }));

  const day = (iso: string) => iso.slice(0, 10);

  return (
    <HtmlPage>
      <div id="names">
        <h1>Names over the years</h1>
        <p className="topic">
          {people.length} people,{" "}
          {people.reduce((n, p) => n + p.names.length, 0)} names. Slack keeps no
          rename history - these were recovered from the messages themselves,
          and are kept from here on.
        </p>
        {people.map((person) => (
          <div className="person" key={person.userId}>
            <h2>
              <Avatar userId={person.userId} />{" "}
              {profileHref(person.userId) ? (
                <a href={profileHref(person.userId)}>{person.current}</a>
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

async function renderNamesPage() {
  base = "";
  return renderAndWrite(<NamesPage />, NAMES_PATH);
}

/**
 * The link to somebody's profile page, or nothing when no page was written
 * for them - a channel member who never posted, or an account that only ever
 * reacted, has no page, and a link to it is a 404 with their name on it.
 */
function profileHref(userId: string | undefined): string | undefined {
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
}> = ({ id, cube }) => (
  <div className="viz-figure">
    <div className="viz-figure-caption">
      <strong>Drill down</strong>
      <span className="viz-note"> click a year, then a month, then a day</span>
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

function monthData(byMonth: Record<string, number>): Array<Datum> {
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
    all.push({ label: key, value: byMonth[key] || 0 });
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
    <HtmlPage>
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
                  <tr key={`${status.emoji}-${status.text}`}>
                    <td className="timestamp">
                      {status.first.slice(0, 10)}
                      {status.last.slice(0, 10) !== status.first.slice(0, 10)
                        ? ` - ${status.last.slice(0, 10)}`
                        : ""}
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
  const months = monthData(data.byMonth);
  const allEmoji = Object.values(data.emojiStats).sort(
    (a, b) => b.count - a.count,
  );
  const customEmoji = allEmoji.filter((entry) => entry.custom);
  const givers = Object.values(data.byUser)
    .filter((person) => person.reactionsGiven > 0)
    .sort((a, b) => b.reactionsGiven - a.reactionsGiven);

  return (
    <HtmlPage>
      <div id="stats">
        <h1>Ten years of it</h1>
        <p className="topic">
          {formatDay(data.first)} - {formatDay(data.last)} ·{" "}
          <a href="bots.html">what the bots did</a>
        </p>

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
              href: profileHref(person.userId),
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
              href: profileHref(person.userId),
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
    <HtmlPage>
      <div id="stats">
        <h1>#{channel.name}</h1>
        <p className="topic">
          {formatDay(channel.first)} - {formatDay(channel.last)} ·{" "}
          <a href={`${channel.id}-0.html`}>read the messages</a>
        </p>

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
                    {profileHref(userId) ? (
                      <a href={profileHref(userId)}>
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
              href: profileHref(poster.userId),
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
    <HtmlPage>
      <div id="stats">
        <h1>What the bots did</h1>
        <p className="topic">
          Kept off the other pages so a leaderboard of people is a leaderboard
          of people · <a href="stats.html">back to the archive</a>
        </p>

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

async function renderStatsAndProfiles(channels: Array<Channel>) {
  const spinner = ora("Counting ten years of messages...").start();
  // Everything in emojis.json is one the workspace made itself; everything else
  // in a reaction is Slack's.
  const accumulator = createStats({
    customEmoji: new Set(Object.keys(await getEmoji())),
    bots: botUserIds(users),
  });

  for (const channel of channels) {
    if (!channel.id) continue;
    spinner.text = `Counting ${channel.name || channel.id}`;
    spinner.render();
    accumulator.addChannel(channel, await getMessages(channel.id, true));
  }

  stats = accumulator.result();
  base = "";

  await renderAndWrite(<StatsPage data={stats} />, STATS_PATH);
  await renderAndWrite(<BotsPage data={stats} />, BOTS_PATH);

  for (const channel of Object.values(stats.byChannel)) {
    if (channel.messages === 0) continue;
    await renderAndWrite(
      <ChannelPage channel={channel} />,
      getChannelStatsFilePath(channel.id),
    );
  }

  profileIds = profilePageIds(stats.byUser);

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
    `Counted ${formatCount(stats.messages)} messages: stats, ${
      Object.values(stats.byChannel).filter((c) => c.messages > 0).length
    } channels and ${written} profiles.`,
  );
}

async function renderIndexPage() {
  base = "html/";
  const channels = publishable(await getChannels());
  const page = <IndexPage channels={channels} />;

  return renderAndWrite(page, INDEX_PATH);
}

interface RenderMessagesPageOptions {
  channel: Channel;
  messages: Array<ArchiveMessage>;
  chunkIndex: number;
  chunksInfo: ChunksInfo;
}

function renderMessagesPage(options: RenderMessagesPageOptions, spinner: Ora) {
  const { channel, messages, chunkIndex: index, chunksInfo } = options;
  const page = (
    <MessagesPage
      channel={channel}
      messages={messages}
      index={index}
      chunksInfo={chunksInfo}
    />
  );

  const filePath = getHTMLFilePath(channel.id!, index);
  spinner.text = `${channel.name || channel.id}: Writing ${index + 1}/${
    chunksInfo.length
  } ${filePath}`;
  spinner.render();

  // Update the search index. In messages, the youngest message is first.
  if (messages.length > 0) {
    recordPage(channel.id, messages[messages.length - 1]?.ts);
  }

  return renderAndWrite(page, filePath);
}

async function renderAndWrite(page: JSX.Element, filePath: string) {
  const html = ReactDOMServer.renderToStaticMarkup(page);
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

async function createHtmlForChannel({
  channel,
  i,
  total,
}: {
  channel: Channel;
  i: number;
  total: number;
}) {
  const messages = await getMessages(channel.id!, true);
  const chunks = chunk(messages, MESSAGE_CHUNK);
  const spinner = ora(
    `Rendering HTML for ${i + 1}/${total} ${channel.name || channel.id}`,
  ).start();

  // Calculate info about all chunks
  const chunksInfo: ChunksInfo = [];
  for (const iChunk of chunks) {
    chunksInfo.push({
      oldest: formatTimestamp(iChunk[iChunk.length - 1], "Pp"),
      newest: formatTimestamp(iChunk[0], "Pp"),
      count: iChunk.length,
    });
  }

  if (chunks.length === 0) {
    await renderMessagesPage(
      {
        channel,
        messages: [],
        chunkIndex: 0,
        chunksInfo: chunksInfo,
      },
      spinner,
    );
  }

  for (const [chunkI, chunk] of chunks.entries()) {
    await renderMessagesPage(
      {
        channel,
        messages: chunk,
        chunkIndex: chunkI,
        chunksInfo,
      },
      spinner,
    );
  }

  spinner.succeed(
    `Rendered HTML for ${i + 1}/${total} ${channel.name || channel.id}`,
  );
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

  users = await getUsers();
  userNames = await getUserNames();
  userAvatars = await getUserAvatars();
  userStatuses = await getUserStatuses();
  botIds = botUserIds(users);
  slackArchiveData = await getSlackArchiveData();
  me = slackArchiveData.auth?.user_id
    ? users[slackArchiveData.auth?.user_id]
    : null;

  // Before the channel pages, not after: every message links to its author's
  // profile page, and this is what decides which of those pages exist.
  await renderStatsAndProfiles(publishable(await getChannels()));
  await renderNamesPage();

  for (const [i, channel] of channels.entries()) {
    if (!channel.id) {
      console.warn(`Can't create HTML for channel: No id found`, channel);
      continue;
    }

    await createHtmlForChannel({ channel, i, total: channels.length });
  }

  await renderIndexPage();

  // Copy in fonts & css
  // static/search.html is the TEMPLATE for the search page, with placeholder
  // comments where the scripts go. createSearchHTML fills it in and writes the
  // result to the archive root. Copying it here as well shipped the unfilled
  // template into html/, where it looks like a second, broken search page -
  // and it is what somebody assembling a site would reasonably pick up.
  fs.copySync(path.join(_dirname, "../static"), path.join(OUT_DIR, "html/"), {
    filter: (src) => path.basename(src) !== "search.html",
  });
}

if (esMain(import.meta)) {
  createHtmlForChannels();
}
