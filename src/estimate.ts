import { Gap } from "./gaps.js";

/**
 * What was probably said while nobody was archiving.
 *
 * The charts drop to zero across the five gaps, which reads as "the workspace
 * fell silent for eight months" - and it did not; the archiver was not running
 * and Slack has since thrown those messages away. So the charts draw a dotted
 * line at the estimate instead, and every headline number stays strictly what
 * was archived. An estimate added to a total stops being an estimate and
 * becomes a claim.
 *
 * The model is the obvious one for this shape of data: a month is its SEASON
 * times the LEVEL around it. July is reliably a third of a normal month here,
 * so a missing July should be estimated as a third of a normal month - not as
 * the average of the days either side of a three-month hole, which is what a
 * flat daily rate gives and which is wrong in exactly the way the eye notices.
 *
 * - the seasonal index of a month is its size relative to its own year, averaged
 *   over every year that has it
 * - the level is interpolated between the deseasonalised months either side of
 *   the gap, so a workspace that doubled while nobody was looking is estimated
 *   as having doubled gradually rather than jumping at the far edge
 * - the interval is how much the years DISAGREE about that month, which is the
 *   honest source of uncertainty: a month the years agree on gets a narrow
 *   band and one they do not gets a wide one
 */
export interface MonthEstimate {
  estimate: number;
  low: number;
  high: number;
  /** Days of that month the archive is missing. */
  missingDays: number;
}

export function estimateMissingByMonth(
  monthly: Record<string, number>,
  gaps: Array<Gap>,
): Record<string, MonthEstimate> {
  const known = Object.entries(monthly).filter(([, count]) => count > 0);

  if (known.length === 0) return {};

  const season = seasonalIndex(monthly);
  const estimates: Record<string, MonthEstimate> = {};

  for (const gap of gaps) {
    for (const [month, missingDays] of Object.entries(missingByMonth(gap))) {
      const level = levelAround(monthly, season, month);

      if (level === undefined) continue;

      const index = season[monthOf(month)];
      const share = missingDays / daysInMonth(month);
      const middle = level * (index?.mean ?? 1) * share;
      const spread = level * (index?.spread ?? 0) * share;
      const existing = estimates[month];
      const estimate = {
        estimate: Math.round(middle),
        low: Math.max(0, Math.round(middle - spread)),
        high: Math.round(middle + spread),
        missingDays,
      };

      estimates[month] = existing
        ? {
            estimate: existing.estimate + estimate.estimate,
            low: existing.low + estimate.low,
            high: existing.high + estimate.high,
            missingDays: existing.missingDays + missingDays,
          }
        : estimate;
    }
  }

  return estimates;
}

/**
 * How big each calendar month is relative to its own year, and how much the
 * years disagree about it.
 */
function seasonalIndex(
  monthly: Record<string, number>,
): Record<string, { mean: number; spread: number }> {
  const byYear = new Map<string, Map<string, number>>();

  for (const [month, count] of Object.entries(monthly)) {
    if (count <= 0) continue;
    const [year] = month.split("-");
    const months = byYear.get(year) || new Map();
    months.set(monthOf(month), count);
    byYear.set(year, months);
  }

  const ratios = new Map<string, Array<number>>();

  for (const months of byYear.values()) {
    // A year with two months in it says nothing about seasons.
    if (months.size < 6) continue;

    const mean = [...months.values()].reduce((a, b) => a + b, 0) / months.size;

    if (mean <= 0) continue;

    for (const [month, count] of months) {
      ratios.set(month, [...(ratios.get(month) || []), count / mean]);
    }
  }

  const index: Record<string, { mean: number; spread: number }> = {};

  for (const [month, values] of ratios) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.length > 1
        ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
          (values.length - 1)
        : 0;

    index[month] = { mean, spread: Math.sqrt(variance) };
  }

  return index;
}

/**
 * The deseasonalised size of a normal month around this one, interpolated
 * between the nearest known month on each side.
 */
function levelAround(
  monthly: Record<string, number>,
  season: Record<string, { mean: number; spread: number }>,
  month: string,
): number | undefined {
  const before = nearestKnown(monthly, month, -1);
  const after = nearestKnown(monthly, month, 1);
  const deseasonalise = (key: string) =>
    monthly[key] / (season[monthOf(key)]?.mean || 1);

  if (before && after) {
    const span = monthsBetween(before, after);
    const along = monthsBetween(before, month) / span;

    return deseasonalise(before) * (1 - along) + deseasonalise(after) * along;
  }

  const only = before || after;

  return only ? deseasonalise(only) : undefined;
}

function nearestKnown(
  monthly: Record<string, number>,
  month: string,
  direction: number,
): string | undefined {
  const keys = Object.keys(monthly)
    .filter((key) => monthly[key] > 0)
    .sort();
  const candidates =
    direction < 0
      ? keys.filter((key) => key < month).reverse()
      : keys.filter((key) => key > month);

  return candidates[0];
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);

  return (ty - fy) * 12 + (tm - fm);
}

function monthOf(month: string): string {
  return month.split("-")[1];
}

function daysInMonth(month: string): number {
  const [year, m] = month.split("-").map(Number);

  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** The days of each month a gap covers. */
function missingByMonth(gap: Gap): Record<string, number> {
  const months: Record<string, number> = {};
  const day = new Date(`${gap.from}T00:00:00Z`);
  const last = new Date(`${gap.to}T00:00:00Z`);

  while (day <= last) {
    const month = day.toISOString().slice(0, 7);
    months[month] = (months[month] || 0) + 1;
    day.setUTCDate(day.getUTCDate() + 1);
  }

  return months;
}
