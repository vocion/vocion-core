/**
 * WHAT AN AUTOMATION SAVED, AND WHAT IT COST — one reading for every surface
 * that answers "what has this saved us?": a batch's header, an automation's
 * page, `routine_report`, and the savings dashboard. Pure and client-safe;
 * the server reads the runs (`services/routines/savingsReads.ts`).
 *
 * Saved time is the work the finished runs would have taken by hand, at each
 * automation's own baseline (`RoutineSpec.manualMinutes`), less the time
 * people still spent on those runs' decisions (`humanMs`). Its worth is that
 * time at the workspace's hourly rate (`defaults.hourlyRate`). What the runs
 * cost and their tokens come from the spend ledger (`model_call`), never an
 * estimate. With no baseline the saving is not stated at all: the surface
 * shows what the runs cost and stays smaller.
 */

import type { RoutineRunStatus } from './types';

/** An hour of the people whose work an automation takes over, and whose time that is ("specialist"). */
export type HourlyRate = { cents: number; of: string | null };

/** One run, as savings count it. */
export type SavingsRun = {
  status: RoutineRunStatus;
  /** Its version's baseline: minutes the same work takes by hand. Null when the automation has none. */
  manualMinutes: number | null;
  /** Time people spent on its decisions. */
  humanMs: number;
  /** What its model calls cost. */
  cents: number;
  tokens: number;
  /** How many times its expert answered it (an escalation, a held step). */
  decisions: number;
  /** When it ended, else when it started: the week it counts in. */
  at: string | null;
  /** Work for the batch rather than a row (a reconciliation): its cost counts, it is not a run of the work. */
  overhead?: boolean;
};

export type Savings = {
  /** Runs counted, whatever became of them. */
  runs: number;
  /** Runs that finished their work. */
  done: number;
  /** Finished runs with a baseline: the ones the saving is counted on. */
  measured: number;
  tokens: number;
  /** What the runs cost, failed ones too: the money was spent. */
  costCents: number;
  /** People's time on every run. */
  peopleMs: number;
  decisions: number;
  /** The baseline each finished run used, distinct values, for the method line. */
  baselines: number[];
  /** Minutes the finished runs would have taken by hand. Null when none had a baseline. */
  byHandMinutes: number | null;
  /** By hand, less the people's time those runs still took. Null without a baseline. */
  savedMinutes: number | null;
  /** The saved time at the hourly rate. Null without a baseline or a rate. */
  savedCents: number | null;
  rate: HourlyRate | null;
};

/**
 * Sum the runs into one reading.
 * @param runs - The runs (row 0, a reconciliation, is the caller's to leave out).
 * @param rate - The workspace's hourly rate, or null.
 */
export function savingsOf(runs: readonly SavingsRun[], rate: HourlyRate | null): Savings {
  const rows = runs.filter(r => !r.overhead);
  const done = rows.filter(r => r.status === 'done');
  const measured = done.filter(r => typeof r.manualMinutes === 'number' && r.manualMinutes > 0);
  const byHand = measured.length > 0 ? measured.reduce((s, r) => s + (r.manualMinutes ?? 0), 0) : null;
  const peopleOnMeasured = measured.reduce((s, r) => s + r.humanMs, 0) / 60_000;
  const saved = byHand === null ? null : byHand - peopleOnMeasured;
  return {
    runs: rows.length,
    done: done.length,
    measured: measured.length,
    tokens: runs.reduce((s, r) => s + r.tokens, 0),
    costCents: runs.reduce((s, r) => s + r.cents, 0),
    peopleMs: runs.reduce((s, r) => s + r.humanMs, 0),
    decisions: runs.reduce((s, r) => s + r.decisions, 0),
    baselines: [...new Set(measured.map(r => r.manualMinutes!))].sort((a, b) => a - b),
    byHandMinutes: byHand,
    savedMinutes: saved,
    savedCents: saved !== null && rate ? Math.round((saved / 60) * rate.cents) : null,
    rate,
  };
}

/**
 * A day as `YYYY-MM-DD` in a zone.
 * @param ms - The moment.
 * @param timeZone - The zone.
 */
function dayIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(ms));
}

/**
 * The Monday of the week a moment falls in, in a zone, as `YYYY-MM-DD`.
 * @param ms - The moment.
 * @param timeZone - The zone.
 */
export function weekOf(ms: number, timeZone: string): string {
  const [y, m, d] = dayIn(ms, timeZone).split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(y, m - 1, d);
  const back = (new Date(utc).getUTCDay() + 6) % 7;
  return new Date(utc - back * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "Nov 2" for a `YYYY-MM-DD`.
 * @param day - The day.
 */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export type SavingsWeek = { week: string; label: string; savings: Savings };

/**
 * The last `weeks` weeks, oldest first, each summed; a week with no runs is there, empty.
 * @param runs - The runs.
 * @param rate - The hourly rate.
 * @param opts - How many weeks, up to when, in which zone.
 * @param opts.weeks - How many weeks, this one included.
 * @param opts.now - Now, ms.
 * @param opts.timeZone - The workspace's zone.
 */
export function weeklySavings(runs: readonly SavingsRun[], rate: HourlyRate | null, opts: { weeks: number; now: number; timeZone: string }): SavingsWeek[] {
  const last = weekOf(opts.now, opts.timeZone);
  const lastMs = Date.parse(`${last}T00:00:00Z`);
  const keys = Array.from({ length: opts.weeks }, (_, i) => new Date(lastMs - (opts.weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10));
  const byWeek = new Map<string, SavingsRun[]>(keys.map(k => [k, []]));
  for (const r of runs) {
    const t = r.at ? Date.parse(r.at) : Number.NaN;
    if (Number.isFinite(t)) {
      byWeek.get(weekOf(t, opts.timeZone))?.push(r);
    }
  }
  return keys.map(k => ({ week: k, label: dayLabel(k), savings: savingsOf(byWeek.get(k)!, rate) }));
}

/**
 * Runs since a moment (this month, the last eight weeks).
 * @param runs - The runs.
 * @param fromMs - The start, ms.
 */
export function runsSince(runs: readonly SavingsRun[], fromMs: number): SavingsRun[] {
  return runs.filter((r) => {
    const t = r.at ? Date.parse(r.at) : Number.NaN;
    return Number.isFinite(t) && t >= fromMs;
  });
}

/**
 * The first instant of this month in a zone, as ms.
 * @param now - Now, ms.
 * @param timeZone - The zone.
 */
export function monthStart(now: number, timeZone: string): number {
  const [y, m] = dayIn(now, timeZone).split('-').map(Number) as [number, number];
  // Midnight on the 1st in the zone: UTC midnight moved by the zone's offset that day.
  const utcMidnight = Date.UTC(y, m - 1, 1);
  return utcMidnight - offsetHours(utcMidnight, timeZone) * 3_600_000;
}

function offsetHours(ms: number, timeZone: string): number {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(ms)));
  const utcHour = new Date(ms).getUTCHours();
  let diff = hour - utcHour;
  if (diff > 12) {
    diff -= 24;
  }
  if (diff < -12) {
    diff += 24;
  }
  return diff;
}

/* ── Words ─────────────────────────────────────────────────────────────── */

/**
 * Dollars as people say them: "$2,480" from ten dollars up, "$4.10" under.
 * @param cents - Cents.
 */
export function dollars(cents: number): string {
  const d = Math.max(0, cents) / 100;
  return d >= 10 ? `$${Math.round(d).toLocaleString('en-US')}` : `$${d.toFixed(2)}`;
}

/**
 * A stretch of time as people say it: "45 minutes", "2.5 hours", "31 hours".
 * @param minutes - Minutes.
 */
export function duration(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m < 59.5) {
    const n = Math.max(1, Math.round(m));
    return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
  }
  const h = m / 60;
  const shown = h < 10 ? Math.round(h * 10) / 10 : Math.round(h);
  return `${shown} ${shown === 1 ? 'hour' : 'hours'}`;
}

/**
 * Tokens, short: "840", "38k", "1.2M".
 * @param n - Tokens.
 */
export function tokensLabel(n: number): string {
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Whose time the rate is: "specialist time", else "people's time".
 * @param rate - The rate.
 */
function whoseTime(rate: HourlyRate | null): string {
  return rate?.of?.trim() ? `${rate.of.trim()} time` : 'people’s time';
}

/**
 * Whether a reading has a saving worth stating: a baseline, and more time saved than spent.
 * @param s
 */
export function hasSaving(s: Savings): boolean {
  return s.savedMinutes !== null && s.savedMinutes >= 1;
}

/**
 * The conclusion: "Saved 31 hours this month, $2,480 of specialist time, for $41 of runs." Null when
 * there is no saving to state (no baseline, or nothing finished): the surface shows the cost alone.
 * @param s - The reading.
 * @param when - The period, as words after the time ("this month", "in the last 8 weeks"), or none.
 */
export function savingSentence(s: Savings, when?: string | null): string | null {
  if (!hasSaving(s)) {
    return null;
  }
  const value = s.savedCents !== null ? `, ${dollars(s.savedCents)} of ${whoseTime(s.rate)}` : '';
  return `Saved ${duration(s.savedMinutes!)}${when ? ` ${when}` : ''}${value}, for ${dollars(s.costCents)} of runs.`;
}

/**
 * How each number is worked out, a line each: what the method view shows one click from the
 * conclusion, and what `routine_report` hands the model to explain it.
 * @param s - The reading.
 */
export function savingMethod(s: Savings): string[] {
  const lines: string[] = [];
  if (s.byHandMinutes !== null) {
    const each = s.baselines.length === 1 ? `${s.baselines[0]} min each, the automation’s baseline` : 'each at its automation’s own baseline';
    lines.push(`By hand: ${duration(s.byHandMinutes)} for the ${s.measured} finished ${s.measured === 1 ? 'run' : 'runs'} (${each}).`);
    const people = s.peopleMs / 60_000;
    lines.push(`People still spent ${people >= 1 ? duration(people) : 'under a minute'}${s.decisions > 0 ? ` on ${s.decisions} ${s.decisions === 1 ? 'decision' : 'decisions'}` : ''}, leaving ${duration(Math.max(0, s.savedMinutes ?? 0))} saved.`);
    if (s.savedCents !== null && s.rate) {
      lines.push(`At ${dollars(s.rate.cents)} an hour of ${whoseTime(s.rate)}, that is ${dollars(s.savedCents)}.`);
    }
  }
  lines.push(`The runs cost ${dollars(s.costCents)}: ${tokensLabel(s.tokens)} tokens of model calls across ${s.runs} ${s.runs === 1 ? 'run' : 'runs'}, from the spend ledger.`);
  return lines;
}

/** One automation over time, as its page draws it. */
export type RoutineSavingsView = {
  month: Savings;
  /** The last weeks of the trend, together. */
  recent: Savings;
  total: Savings;
  weeks: SavingsWeek[];
  /** The first day after seeded sample history, `YYYY-MM-DD`, when any is counted. */
  sampleBefore: string | null;
};
