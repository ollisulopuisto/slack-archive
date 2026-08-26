import { MonthEstimate } from "./estimate.js";

/**
 * What the archive might have held, kept apart from what it does hold.
 *
 * Every headline number on these pages counts what was archived. This is the
 * other question - "so how much is missing?" - answered separately, shown only
 * when somebody asks for it, and never mixed into the first answer. The moment
 * an estimate is added into a total that is presented as a count, the page has
 * stopped saying what it knows and started saying what it supposes.
 *
 * Reactions are estimated at the rate the archive itself shows: if the
 * archived messages carry a quarter of a reaction each, the missing ones
 * probably did too. That is a weaker claim than the message estimate, which at
 * least has seasonality behind it, and it is labelled as speculation for the
 * same reason.
 */
export interface SpeculativeTotals {
  messages: number;
  reactions: number;
  missingMessages: number;
  missingReactions: number;
}

export function speculativeTotals(
  archived: { messages: number; reactions: number },
  estimates: Record<string, MonthEstimate>,
): SpeculativeTotals {
  const missingMessages = Object.values(estimates).reduce(
    (total, month) => total + month.estimate,
    0,
  );
  const perMessage =
    archived.messages > 0 ? archived.reactions / archived.messages : 0;
  const missingReactions = Math.round(missingMessages * perMessage);

  return {
    messages: archived.messages + missingMessages,
    reactions: archived.reactions + missingReactions,
    missingMessages,
    missingReactions,
  };
}

/** The same estimates, gathered per year, for the yearly bars. */
export function estimatesByYear(
  estimates: Record<string, MonthEstimate>,
): Record<string, MonthEstimate> {
  const years: Record<string, MonthEstimate> = {};

  for (const [month, estimate] of Object.entries(estimates)) {
    const year = month.slice(0, 4);
    const running = years[year];

    years[year] = running
      ? {
          estimate: running.estimate + estimate.estimate,
          low: running.low + estimate.low,
          high: running.high + estimate.high,
          missingDays: running.missingDays + estimate.missingDays,
        }
      : { ...estimate };
  }

  return years;
}

/**
 * One person's (or channel's) share of what is missing.
 *
 * Their share of the archive, applied to the estimate. It assumes the people
 * who were talking before a gap were the people talking during it, which is a
 * weaker assumption than the seasonal one behind the total - so it is offered
 * on the same toggle and never on its own, and the totals it produces are
 * labelled as estimates like everything else here.
 */
export function shareOfMissing(
  theirs: number,
  everyone: number,
  missing: number,
): number {
  if (everyone <= 0 || missing <= 0) return 0;

  return Math.round(missing * (theirs / everyone));
}

/**
 * Somebody's share of the missing days, with the interval carried through.
 *
 * The share itself is treated as exact - if you wrote a tenth of the archive,
 * this assumes you wrote a tenth of what is missing - and the uncertainty
 * comes entirely from the total, which is where it was actually measured. That
 * UNDERSTATES the real spread, because the share is a guess too; it is the
 * honest half of the uncertainty rather than an invented whole.
 */
export function shareOfRange(
  theirs: number,
  everyone: number,
  range: { estimate: number; low: number; high: number },
): { estimate: number; low: number; high: number } | undefined {
  if (everyone <= 0 || theirs <= 0) return undefined;

  const share = theirs / everyone;
  const estimate = Math.round(range.estimate * share);

  if (estimate <= 0) return undefined;

  return {
    estimate,
    low: Math.round(range.low * share),
    high: Math.round(range.high * share),
  };
}
