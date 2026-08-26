import { format } from "date-fns";

/**
 * What a page is called, and what it says about itself.
 *
 * Every page in this archive had `<title>Slack</title>`. That title is what a
 * browser tab shows, what a bookmark and a history entry keep, and what a
 * preview of a shared link would read - a thousand pages all called the same
 * word, in an archive people are supposed to link each other to.
 */
export interface PageMeta {
  title: string;
  description: string;
}

/** Grouped thousands with ordinary spaces: this goes in titles, not in tables. */
function count(value: number): string {
  return value.toLocaleString("fi-FI").replace(/ /g, " ");
}

/** "12.4.2019" from a Slack timestamp, or "" when there is nothing to read. */
function day(ts: string | undefined): string {
  const seconds = Number.parseFloat(ts || "");

  if (!Number.isFinite(seconds) || seconds <= 0) return "";

  return format(seconds * 1000, "d.M.yyyy");
}

function span(first?: string, last?: string): string {
  const from = day(first);
  const to = day(last);

  if (!from && !to) return "";
  if (!to || to === from) return from;
  if (!from) return to;

  return `${from} - ${to}`;
}

export function channelPageMeta(options: {
  name: string;
  first?: string;
  last?: string;
  index: number;
  total: number;
  messages: number;
  team?: string;
}): PageMeta {
  const { name, index, total, messages, team } = options;
  const dates = span(options.first, options.last);
  const where = team ? `the ${team} archive` : "the archive";

  return {
    title: dates ? `#${name} · ${dates}` : `#${name}`,
    description: `${count(messages)} messages from #${name}, page ${
      index + 1
    } of ${total} of ${where}.`,
  };
}

export function profileMeta(options: {
  name: string;
  messages: number;
  names: number;
  channels: number;
  first?: string;
  last?: string;
}): PageMeta {
  const dates = span(options.first, options.last);
  const parts = [
    `${count(options.messages)} messages`,
    `${count(options.names)} names`,
    `${count(options.channels)} channels`,
  ];

  return {
    title: `${options.name} · in the archive`,
    description: `${parts.join(", ")}${dates ? `, ${dates}` : ""}.`,
  };
}

export function channelStatsMeta(name: string, messages: number): PageMeta {
  return {
    title: `#${name} · in numbers`,
    description: `${count(messages)} messages in #${name}: who talked, when, and what they reacted with.`,
  };
}

export function indexMeta(team: string | undefined): PageMeta {
  return {
    title: team ? `${team} · Slack archive` : "Slack archive",
    description: team
      ? `Ten years of ${team}, kept where Slack no longer keeps it.`
      : "A Slack workspace, kept where Slack no longer keeps it.",
  };
}
