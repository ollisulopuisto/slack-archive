import { ArchiveMessage, Channel } from "./interfaces.js";
import { UserNames } from "./user-names.js";

/** A channel somebody posted in, and how much. */
export interface ChannelUse {
  id: string;
  name: string;
  messages: number;
}

/**
 * Messages per day, and within a day per hour, stored sparsely.
 *
 * This is the only bucket the drill-down actually keeps: a year, a month and a
 * day are all sums of it. Deriving the upper levels rather than counting them
 * separately means the four levels of the drill-down cannot disagree with each
 * other, which is the failure that makes a chart like this untrustworthy.
 *
 *     { "2020-05-15": { "14": 3, "15": 7 } }
 */
export type DayHourCube = Record<string, Record<string, number>>;

export interface ChannelStats {
  id: string;
  name: string;
  messages: number;
  first: string;
  last: string;
  byDayHour: DayHourCube;
  /** User id -> messages they posted here. */
  byUser: Record<string, number>;
}

export interface UserStats {
  userId: string;
  messages: number;
  replies: number;
  threadsStarted: number;
  files: number;
  reactionsReceived: number;
  /** Slack timestamps. */
  first: string;
  last: string;
  byYear: Record<string, number>;
  /** 24 buckets, local time. */
  byHour: Array<number>;
  /** 7 buckets, Monday first. */
  byWeekday: Array<number>;
  channels: Array<ChannelUse>;
  /** Channel id -> when they joined, for the channels that recorded it. */
  joined: Record<string, string>;
  byDayHour: DayHourCube;
}

export interface WorkspaceStats {
  messages: number;
  replies: number;
  channels: number;
  files: number;
  reactions: number;
  first: string;
  last: string;
  byYear: Record<string, number>;
  byMonth: Record<string, number>;
  byHour: Array<number>;
  byWeekday: Array<number>;
  /** Emoji name -> times used as a reaction. */
  emoji: Record<string, number>;
  channelNames: Record<string, string>;
  byUser: Record<string, UserStats>;
  byChannel: Record<string, ChannelStats>;
  byDayHour: DayHourCube;
}

/**
 * Slack's own doing, not ours: joining a channel writes a message. Counting
 * those as things people said turns a quiet member who was added to forty
 * channels into a conversationalist.
 */
const NOT_REALLY_A_MESSAGE = new Set([
  "channel_join",
  "channel_leave",
  "channel_name",
  "channel_purpose",
  "channel_topic",
  "channel_archive",
  "channel_unarchive",
]);

function emptyUser(userId: string): UserStats {
  return {
    userId,
    messages: 0,
    replies: 0,
    threadsStarted: 0,
    files: 0,
    reactionsReceived: 0,
    first: "",
    last: "",
    byYear: {},
    byHour: new Array(24).fill(0),
    byWeekday: new Array(7).fill(0),
    channels: [],
    joined: {},
    byDayHour: {},
  };
}

function addToCube(cube: DayHourCube, day: string, hour: number) {
  const hours = (cube[day] = cube[day] || {});
  hours[hour] = (hours[hour] || 0) + 1;
}

/**
 * Counts an archive a channel at a time.
 *
 * A channel at a time because that is how the archive is read - a million
 * messages do not need to be in memory at once to be counted, and the caller
 * already holds one channel's worth.
 */
export function createStats() {
  const stats: WorkspaceStats = {
    messages: 0,
    replies: 0,
    channels: 0,
    files: 0,
    reactions: 0,
    first: "",
    last: "",
    byYear: {},
    byMonth: {},
    byHour: new Array(24).fill(0),
    byWeekday: new Array(7).fill(0),
    emoji: {},
    channelNames: {},
    byUser: {},
    byChannel: {},
    byDayHour: {},
  };

  const perUserChannel = new Map<string, Map<string, number>>();

  function count(
    channel: Pick<Channel, "id" | "name">,
    message: ArchiveMessage,
    isReply: boolean,
  ) {
    const seconds = Number.parseFloat(message.ts || "");
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    const user = message.user;
    const person = user
      ? (stats.byUser[user] = stats.byUser[user] || emptyUser(user))
      : null;
    const when = new Date(seconds * 1000);

    if (message.subtype && NOT_REALLY_A_MESSAGE.has(message.subtype)) {
      if (person && message.subtype === "channel_join" && channel.id) {
        person.joined[channel.id] = message.ts!;
      }
      return;
    }

    stats.messages++;
    if (isReply) stats.replies++;

    const year = String(when.getFullYear());
    const month = `${year}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    // Monday first: getDay() is Sunday-first, which puts the weekend in the
    // middle of the week and makes every weekday chart read wrong.
    const weekday = (when.getDay() + 6) % 7;

    stats.byYear[year] = (stats.byYear[year] || 0) + 1;
    stats.byMonth[month] = (stats.byMonth[month] || 0) + 1;
    stats.byHour[when.getHours()]++;
    stats.byWeekday[weekday]++;
    stats.files += message.files?.length || 0;

    const day = `${year}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(
      when.getDate(),
    ).padStart(2, "0")}`;
    const hour = when.getHours();
    addToCube(stats.byDayHour, day, hour);

    const channelStats = channel.id ? stats.byChannel[channel.id] : null;
    if (channelStats) {
      channelStats.messages++;
      addToCube(channelStats.byDayHour, day, hour);
      if (user) {
        channelStats.byUser[user] = (channelStats.byUser[user] || 0) + 1;
      }
      if (!channelStats.first || message.ts! < channelStats.first) {
        channelStats.first = message.ts!;
      }
      if (!channelStats.last || message.ts! > channelStats.last) {
        channelStats.last = message.ts!;
      }
    }

    if (!stats.first || message.ts! < stats.first) stats.first = message.ts!;
    if (!stats.last || message.ts! > stats.last) stats.last = message.ts!;

    let received = 0;
    for (const reaction of message.reactions || []) {
      const n = Number(reaction.count) || 0;
      received += n;
      stats.reactions += n;
      if (reaction.name) {
        stats.emoji[reaction.name] = (stats.emoji[reaction.name] || 0) + n;
      }
    }

    if (!person) return;

    person.messages++;
    if (isReply) person.replies++;
    if (message.reply_count) person.threadsStarted++;
    person.files += message.files?.length || 0;
    person.reactionsReceived += received;
    person.byYear[year] = (person.byYear[year] || 0) + 1;
    person.byHour[when.getHours()]++;
    person.byWeekday[weekday]++;
    addToCube(person.byDayHour, day, hour);

    if (!person.first || message.ts! < person.first) person.first = message.ts!;
    if (!person.last || message.ts! > person.last) person.last = message.ts!;

    if (channel.id) {
      const byChannel =
        perUserChannel.get(user!) ||
        perUserChannel.set(user!, new Map()).get(user!)!;
      byChannel.set(channel.id, (byChannel.get(channel.id) || 0) + 1);
    }
  }

  return {
    addChannel(
      channel: Pick<Channel, "id" | "name">,
      messages: Array<ArchiveMessage>,
    ) {
      stats.channels++;
      if (channel.id) {
        stats.channelNames[channel.id] = channel.name || channel.id;
        stats.byChannel[channel.id] = stats.byChannel[channel.id] || {
          id: channel.id,
          name: channel.name || channel.id,
          messages: 0,
          first: "",
          last: "",
          byDayHour: {},
          byUser: {},
        };
      }

      const walk = (message: ArchiveMessage, isReply: boolean) => {
        count(channel, message, isReply);
        for (const reply of message.replies || []) walk(reply, true);
      };

      for (const message of messages) walk(message, false);
    },

    result(): WorkspaceStats {
      for (const [userId, byChannel] of perUserChannel) {
        stats.byUser[userId].channels = [...byChannel]
          .map(([id, messages]) => ({
            id,
            name: stats.channelNames[id] || id,
            messages,
          }))
          .sort((a, b) => b.messages - a.messages);
      }

      return stats;
    },
  };
}

export type ProfileEventKind =
  "name" | "avatar" | "joined" | "first-message" | "last-message";

export interface ProfileEvent {
  /** Slack timestamp, for sorting and display. */
  ts: string;
  kind: ProfileEventKind;
  detail: string;
}

function isoToSlackTs(iso: string): string {
  return String(Date.parse(iso) / 1000);
}

/**
 * One dated story per person: what they were called, where they turned up, and
 * the two ends of their time here.
 *
 * The dates do not all mean the same thing and the page says so - a name is
 * dated by when it was SEEN in use, which for a name recovered from an old
 * rendering of these pages is only the day that page was written.
 */
export function profileEvents(
  userId: string,
  stats: WorkspaceStats,
  userNames: UserNames,
): Array<ProfileEvent> {
  const person = stats.byUser[userId];
  const events: Array<ProfileEvent> = [];

  for (const name of userNames[userId] || []) {
    events.push({
      ts: isoToSlackTs(name.first),
      kind: "name",
      detail: `Known as ${name.nick}`,
    });
  }

  for (const [channelId, ts] of Object.entries(person?.joined || {})) {
    events.push({
      ts,
      kind: "joined",
      detail: `Joined #${stats.channelNames[channelId] || channelId}`,
    });
  }

  if (person?.first) {
    events.push({
      ts: person.first,
      kind: "first-message",
      detail: "First message",
    });
  }

  if (person?.last && person.last !== person.first) {
    events.push({
      ts: person.last,
      kind: "last-message",
      detail: "Most recent message",
    });
  }

  return events.sort((a, b) => Number(a.ts) - Number(b.ts));
}
