import { DayHourCube } from "./stats.js";

/** A stretch of days the archive has no messages for. */
export interface Gap {
  /** First missing day, ISO. */
  from: string;
  /** Last missing day, ISO. */
  to: string;
  days: number;
}

/**
 * Days this archive holds no messages for, in the middle of days it does.
 *
 * The archive is only as complete as its runs: a fetch that was never made is
 * indistinguishable from a conversation that never happened, and nothing in
 * the data says which one it was. A workspace that posts every day for ten
 * years does not fall silent for seven months, so a long stretch of nothing is
 * reported here and said out loud on the pages - the numbers below it are
 * counts of what was archived, not of what was said.
 *
 * Silence before the first message and after the last is not a gap: that is
 * the archive's own edge.
 */
export function findGaps(
  days: Record<string, number>,
  minDays: number = 7,
): Array<Gap> {
  const recorded = Object.keys(days)
    .filter((day) => days[day] > 0)
    .sort();

  if (recorded.length < 2) {
    return [];
  }

  const gaps: Array<Gap> = [];
  const last = new Date(`${recorded[recorded.length - 1]}T00:00:00Z`);
  let missingSince: string | null = null;
  const day = new Date(`${recorded[0]}T00:00:00Z`);

  while (day <= last) {
    const iso = day.toISOString().slice(0, 10);

    if (days[iso] > 0) {
      if (missingSince) {
        addGap(gaps, missingSince, iso, minDays);
        missingSince = null;
      }
    } else if (!missingSince) {
      missingSince = iso;
    }

    day.setUTCDate(day.getUTCDate() + 1);
  }

  return gaps;
}

function addGap(
  gaps: Array<Gap>,
  from: string,
  firstDayBack: string,
  minDays: number,
) {
  const days = daysBetween(from, firstDayBack);

  if (days >= minDays) {
    gaps.push({ from, to: addDays(firstDayBack, -1), days });
  }
}

/**
 * The gap, if any, that lies between two messages - so a reader scrolling a
 * channel is told where the archive stops and starts again, rather than seeing
 * February follow September with nothing in between.
 */
export function gapBetween(
  gaps: Array<Gap>,
  oneDay: string,
  otherDay: string,
): Gap | undefined {
  if (!oneDay || !otherDay) {
    return undefined;
  }

  const [older, newer] = [oneDay, otherDay].sort();

  return gaps.find((gap) => older <= gap.from && newer > gap.to);
}

/** Day totals from a drilldown cube. */
export function dailyTotals(cube: DayHourCube): Record<string, number> {
  const days: Record<string, number> = {};

  for (const [day, hours] of Object.entries(cube)) {
    days[day] = Object.values(hours).reduce((sum, n) => sum + n, 0);
  }

  return days;
}

function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() -
    new Date(`${from}T00:00:00Z`).getTime();

  return Math.round(ms / 86400000);
}

function addDays(iso: string, n: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);

  return day.toISOString().slice(0, 10);
}
