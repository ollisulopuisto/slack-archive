import { Gap } from "./gaps.js";

/**
 * What was probably said while nobody was archiving.
 *
 * The charts drop to zero across the five gaps, which reads as "the workspace
 * fell silent for eight months" - and it did not; the archiver was not running
 * and Slack has since thrown those messages away. So the charts draw a dotted
 * line at the estimate instead, and every headline number stays strictly what
 * was archived. An estimate that is added to a total stops being an estimate
 * and starts being a claim.
 *
 * The estimate is the daily rate either side of the gap, times the missing
 * days. The interval is a 95% confidence interval on that rate, so a gap next
 * to erratic weeks gets a wide band and a gap next to steady ones gets a
 * narrow one. That is the honest shape: it is not ±5% because we do not know
 * that it is ±5%.
 */
export interface MonthEstimate {
  estimate: number;
  low: number;
  high: number;
  /** Days of that month the archive is missing. */
  missingDays: number;
}

export function estimateMissingByMonth(
  daily: Record<string, number>,
  gaps: Array<Gap>,
  window: number = 45,
): Record<string, MonthEstimate> {
  const estimates: Record<string, MonthEstimate> = {};

  for (const gap of gaps) {
    const flanking = [
      ...daysWithData(daily, gap.from, -window),
      ...daysWithData(daily, gap.to, window),
    ];

    if (flanking.length === 0) continue;

    const mean = flanking.reduce((a, b) => a + b, 0) / flanking.length;
    const spread = 1.96 * standardError(flanking);

    for (const [month, missingDays] of Object.entries(missingByMonth(gap))) {
      const existing = estimates[month];
      const estimate = {
        estimate: Math.round(mean * missingDays),
        low: Math.max(0, Math.round((mean - spread) * missingDays)),
        high: Math.round((mean + spread) * missingDays),
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

/** Counts for the days just before or just after a gap, skipping empty ones. */
function daysWithData(
  daily: Record<string, number>,
  edge: string,
  span: number,
): Array<number> {
  const counts: Array<number> = [];
  const step = span < 0 ? -1 : 1;
  const day = new Date(`${edge}T00:00:00Z`);

  for (let i = 0; i < Math.abs(span); i++) {
    day.setUTCDate(day.getUTCDate() + step);
    const count = daily[day.toISOString().slice(0, 10)];

    if (count !== undefined && count > 0) counts.push(count);
  }

  return counts;
}

function standardError(values: Array<number>): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);

  return Math.sqrt(variance / values.length);
}
