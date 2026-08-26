import { ArchiveMessage } from "./interfaces.js";

/**
 * Getting to a moment in a channel, without a dropdown of 714 entries.
 *
 * The page control was every page of the channel in one `<select>`, each
 * labelled with the timestamps at its ends: "694 - 03/27/2017, 3:38 PM to
 * 03/21/2017, 10:22 PM". For a channel with ten years in it that is a list
 * nobody can use - you cannot scan it, and the thing you actually know is
 * "sometime in spring 2017", not a page number.
 *
 * So: months. Every month the channel has messages in, and which page that
 * month starts on.
 */
export interface MonthPage {
  /** "2017-03" */
  month: string;
  /** Absent when the channel has no messages in that month at all. */
  page?: number;
}

export interface YearMonths {
  year: string;
  months: Array<MonthPage & { label: string }>;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthsToPages(
  messages: Array<ArchiveMessage>,
  chunkSize: number,
): Array<MonthPage> {
  const pages = new Map<string, number>();

  for (const [i, message] of messages.entries()) {
    const seconds = Number.parseFloat(message?.ts || "");

    if (!Number.isFinite(seconds) || seconds <= 0) continue;

    const month = new Date(seconds * 1000).toISOString().slice(0, 7);
    const page = Math.floor(i / chunkSize);

    // Messages run newest first, so a later index is an older message: the
    // last page a month appears on is where that month starts.
    pages.set(month, page);
  }

  return [...pages.entries()]
    .map(([month, page]) => ({ month, page }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Every month between the first and the last, including the empty ones.
 *
 * A month that is simply missing from the calendar is ambiguous - a quiet
 * channel and an unarchived stretch look identical. Drawn and disabled, it is
 * at least a question the page has answered, and where the gap notice already
 * says the archive was not running, the two line up.
 */
export function fillMonths(months: Array<MonthPage>): Array<MonthPage> {
  if (months.length < 2) return months;

  const known = new Map(months.map((entry) => [entry.month, entry]));
  const sorted = [...known.keys()].sort();
  const filled: Array<MonthPage> = [];

  const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
  const [lastYear, lastMonth] = sorted[sorted.length - 1]
    .split("-")
    .map(Number);

  for (let year = firstYear, month = firstMonth; ;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;

    filled.push(known.get(key) || { month: key });

    if (year === lastYear && month === lastMonth) break;

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return filled;
}

export function groupByYear(months: Array<MonthPage>): Array<YearMonths> {
  const years = new Map<string, YearMonths["months"]>();

  for (const entry of months) {
    const [year, month] = entry.month.split("-");
    const list = years.get(year) || [];

    list.push({ ...entry, label: MONTH_LABELS[Number(month) - 1] || month });
    years.set(year, list);
  }

  return [...years.entries()]
    .map(([year, list]) => ({ year, months: list }))
    .sort((a, b) => b.year.localeCompare(a.year));
}
