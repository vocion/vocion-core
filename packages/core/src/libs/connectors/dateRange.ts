/**
 * The date range a family read tool takes — `from` and `to` as days,
 * inclusive — read the same way by the analytics and ads tools, so "the last
 * 30 days" means one thing everywhere.
 */

/** A range of whole days, inclusive. */
export type DayRange = { from: string; to: string };

/** The longest range one call reads. */
const MAX_RANGE_DAYS = 366;

/**
 * A range as the tools take it: `from` and `to` as YYYY-MM-DD, inclusive,
 * defaulting to the 30 days ending yesterday; refused when backwards or longer
 * than `MAX_RANGE_DAYS`.
 * @param input - The tool's arguments.
 * @param input.from - First day.
 * @param input.to - Last day.
 * @param now - The clock.
 */
export function rangeFrom(input: { from?: string; to?: string }, now: Date = new Date()): DayRange {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = input.to ?? day(new Date(now.getTime() - 86_400_000));
  const from = input.from ?? day(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new Error('from and to are days, YYYY-MM-DD.');
  }
  if (fromMs > toMs) {
    throw new Error(`from (${from}) is after to (${to}).`);
  }
  if ((toMs - fromMs) / 86_400_000 + 1 > MAX_RANGE_DAYS) {
    throw new Error(`That range is longer than ${MAX_RANGE_DAYS} days; read it in pieces.`);
  }
  return { from, to };
}
