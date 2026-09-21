import type { PageRow } from './pageFields';
import { readReasons, reasonPhrase } from './reasonCodes';

/**
 * The Work queue, derived: seven internal request states read as four human
 * lanes, each row carrying the sentence a person needs instead of the fields
 * a database holds.
 *
 * Work answers five questions and nothing else: what do we owe, what is
 * actually happening, what is blocked, what comes next, and why. The page
 * that asked those questions of the raw `request` record could not answer
 * them, because the record speaks in state machine (`triaged`,
 * `recommendationState: proposed`, `sizeClass: major`) and a person does not.
 * So the translation happens HERE, once, in one pure function over rows, and
 * the page manifest declares `derive: workQueue` rather than sixteen columns
 * that each say a fragment of the answer.
 *
 * It is a named derivation with a closed set of one for the same reason the
 * `report` archetype's `subject` is an enum of one: a derivation is an
 * ASSEMBLY that knows what these records mean, not a generic expression
 * language on a page. A second derivation should be declared here when it
 * exists rather than pretended at now.
 *
 * Four lanes, in this order:
 *
 *  - **Next**, what we owe and have not started.
 *  - **In progress**, what a worker is building right now.
 *  - **Waiting on you**, which is NOT a stored state. It is a cut across the
 *    others: an outcome whose recommendation nobody has decided is not
 *    moving, whatever its state says, and a work page that hides that behind
 *    `building` is lying about what is happening. Work owns the work state;
 *    Review still owns the decision itself.
 *  - **Done recently**, capped, because Work is about current and future
 *    work. The rest is Activity's job.
 *
 * Three things are deliberately dropped rather than shown:
 *
 *  1. **Probes.** A token probe and an end to end record are legitimate
 *     history and are not management information.
 *  2. **The archive.** `out_of_scope` was decided against; it is not queued.
 *  3. **The overflow.** Rows past a lane's cap. The lane heading says how
 *     many went, so the page never pretends the queue is shorter than it is.
 *
 * Ranking follows the platform rule: a request with no recorded reason is not
 * ranked at all. An unranked queue is a real and reportable condition, not
 * something to paper over with a priority integer, so the counts a page needs
 * to say so out loud are stamped on every row it keeps.
 */

/** The four lanes, in the order a person reads them. */
export const WORK_LANES = ['next', 'progress', 'waiting', 'done'] as const;
export type WorkLane = typeof WORK_LANES[number];

/** How many rows each lane draws before the heading carries the remainder. */
export const NEXT_SHOWN = 3;
export const DONE_SHOWN = 5;
/** How far back "done recently" reaches. Older work is Activity's. */
export const DONE_WITHIN_DAYS = 14;

/** Request states that mean the work has finished, however it finished. */
const DONE_STATES = new Set(['shipped', 'answered']);
/** The archive: decided against, so not part of the queue at all.  */
const ARCHIVE_STATES = new Set(['out_of_scope']);

/** What a recommendation asks the person to decide. */
const OUTCOME_VERB: Record<string, string> = {
  build: 'build it',
  answer: 'answer it',
  decline: 'decline it',
  merge: 'merge it into another request',
};

/** Where a queued outcome has got to, in words. */
const NEXT_STATE_LINE: Record<string, string> = {
  new: 'not triaged yet',
  triaged: 'triaged, not scheduled',
  in_scope: 'in scope, not started',
};

export type WorkQueueOptions = {
  now?: Date;
  nextShown?: number;
  doneShown?: number;
  doneWithinDays?: number;
};

function meta(row: PageRow): Record<string, unknown> {
  return row.meta ?? {};
}

function str(row: PageRow, key: string): string | null {
  const v = meta(row)[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(row: PageRow, key: string): number | null {
  const v = meta(row)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function tags(row: PageRow): string[] {
  const v = meta(row).tags;
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

function date(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Whether this record is a probe: something a test harness filed to prove a
 * path works, rather than something a person wants.
 *
 * Read off how it arrived, never off a keyword in the title alone, because
 * "Filter e2e-suite submissions at intake and tag them test" is a real
 * outcome ABOUT probes and belongs in the queue. A harness source, a
 * smoke-test tag, or a title in one of the harnesses' own fixed forms is
 * evidence about the record; the word "e2e" appearing somewhere in it is not.
 * @param row - The row.
 */
export function isProbeRow(row: PageRow): boolean {
  if (str(row, 'source') === 'e2e-suite') {
    return true;
  }
  if (tags(row).includes('smoke-test')) {
    return true;
  }
  const title = row.title.trim();
  return /^e2e\s+\w+:/i.test(title)
    || /^token probe\b/i.test(title)
    || /^probe$/i.test(title)
    || /^intake smoke test\b/i.test(title);
}

/**
 * Whether this outcome is stopped on a person. A recommendation the Product
 * manager has put up and nobody has decided holds the work still, whatever
 * the state field says.
 * @param row - The row.
 */
export function isWaitingOnPerson(row: PageRow): boolean {
  return str(row, 'recommendationState') === 'proposed';
}

/**
 * Which lane a row belongs in. Finished first (a stale recommendation on
 * shipped work is not a person blocking anything), then waiting, then
 * building, then queued. A record with no state at all is owed and has not
 * started, so it is Next.
 * @param row - The row.
 */
export function laneOf(row: PageRow): WorkLane {
  const state = str(row, 'state');
  if (state && DONE_STATES.has(state)) {
    return 'done';
  }
  if (isWaitingOnPerson(row)) {
    return 'waiting';
  }
  return state === 'building' ? 'progress' : 'next';
}

/**
 * When a finished outcome finished, best evidence first.
 * @param row
 */
function finishedAt(row: PageRow): Date | null {
  return date(meta(row).answeredAt)
    ?? date(meta(row).rollupsUpdatedAt)
    ?? date(meta(row).decidedAt)
    ?? row.createdAt;
}

/**
 * When the ask arrived, best evidence first.
 * @param row
 */
function askedAt(row: PageRow): Date | null {
  return date(meta(row).askedAt) ?? row.createdAt;
}

/**
 * How long ago, in the words a person would use.
 * @param then - The moment.
 * @param now - The clock.
 */
export function daysAgoLabel(then: Date, now: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) {
    return 'today';
  }
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Cents as dollars, for the one line a row says about money.
 * @param cents
 */
function dollars(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

/** How long a standing-in sentence may be before it stops being a line. */
const NOTE_MAX = 120;

/**
 * One line of grounding, not the analysis. A Product manager's note can run
 * to a paragraph with the asker, the date and the promise in it; all of that
 * belongs on the outcome's own page, and the row takes its first sentence.
 * @param note - The recorded prose.
 */
function firstSentence(note: string): string {
  const first = /^.*?[.!?](?=\s|$)/.exec(note)?.[0].trim() ?? note;
  if (first.length <= NOTE_MAX) {
    return first;
  }
  const cut = first.slice(0, NOTE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

/**
 * Why this outcome is here, as one sentence in human words.
 *
 * The codes are a closed list and are never rendered raw: `manual_toil` is
 * schema, "it removes manual toil" is the reason. With no codes the Product
 * manager's own sentence stands in; with neither, the row says nothing at
 * all, and the page reports the gap once instead of printing "not recorded"
 * down a column.
 * @param row - The row.
 */
export function whyLine(row: PageRow): string | null {
  const reasons = readReasons(meta(row), ['whyNote', 'priorityReason']);
  if (reasons.codes.length > 0) {
    return reasons.codes.map(reasonPhrase).join(' · ');
  }
  return reasons.note === null ? null : firstSentence(reasons.note);
}

/**
 * What is happening to this outcome, in one line: the question a person owes
 * an answer to, the build that is running, or the day it finished.
 * @param row - The row.
 * @param lane - The lane it landed in.
 * @param now - The clock.
 */
export function workLine(row: PageRow, lane: WorkLane, now: Date): string {
  if (lane === 'waiting') {
    const verb = OUTCOME_VERB[str(row, 'recommendedOutcome') ?? ''] ?? null;
    return verb
      ? `waiting on you to decide; Vocion recommends we ${verb}`
      : 'waiting on you to decide';
  }
  if (lane === 'progress') {
    const tasks = num(row, 'taskCount');
    return tasks ? `building, ${tasks} ${tasks === 1 ? 'task' : 'tasks'} underway` : 'building';
  }
  if (lane === 'done') {
    const when = finishedAt(row);
    const verb = str(row, 'state') === 'answered' ? 'answered' : 'shipped';
    return when ? `${verb} ${daysAgoLabel(when, now)}` : verb;
  }
  return NEXT_STATE_LINE[str(row, 'state') ?? ''] ?? 'queued';
}

/**
 * What this outcome costs, said the way the lane makes sense of money:
 * an estimate while it is queued, spend against the estimate while it runs,
 * and what it actually cost once it is done. Nothing when nothing is
 * recorded, because a dash in a money column is not a figure.
 * @param row - The row.
 * @param lane - The lane it landed in.
 */
export function costLine(row: PageRow, lane: WorkLane): string | null {
  const estimate = num(row, 'estimateCents');
  const actual = num(row, 'actualCents');
  if (lane === 'done') {
    return actual === null ? null : dollars(actual);
  }
  if (lane === 'progress') {
    if (actual !== null && estimate !== null) {
      return `${dollars(actual)} of about ${dollars(estimate)}`;
    }
    if (actual !== null) {
      return `${dollars(actual)} so far`;
    }
  }
  return estimate === null ? null : `about ${dollars(estimate)}`;
}

/**
 * The conditional facts, which appear only when they are true. A flag the
 * lane heading already states is not repeated on the row.
 * @param row - The row.
 * @param lane - The lane it landed in.
 */
export function flagsOf(row: PageRow, lane: WorkLane): string[] {
  const out: string[] = [];
  if (str(row, 'severity') === 'p1' || str(row, 'kind') === 'incident') {
    out.push('urgent');
  }
  if (isWaitingOnPerson(row) && lane !== 'waiting') {
    out.push('waiting on you');
  }
  if (str(row, 'sizeClass') === 'major') {
    out.push('major');
  }
  return out;
}

/**
 * A lane's heading, which carries what the lane could not draw.
 * @param lane
 * @param counts
 * @param counts.total
 * @param counts.shown
 * @param counts.ranked
 * @param counts.minutes
 */
function laneLabel(lane: WorkLane, counts: { total: number; shown: number; ranked: number; minutes: number }): string {
  const hidden = counts.total - counts.shown;
  if (lane === 'progress') {
    return 'In progress';
  }
  if (lane === 'waiting') {
    return counts.minutes > 0 ? `Waiting on you · about ${counts.minutes} min to decide` : 'Waiting on you';
  }
  if (lane === 'done') {
    return hidden > 0 ? `Done recently · ${hidden} more in Activity` : 'Done recently';
  }
  if (counts.total > 0 && counts.ranked === 0) {
    return `Next · nothing ranked, no reason recorded on ${counts.total} queued`;
  }
  return hidden > 0 ? `Next · ${hidden} more queued` : 'Next';
}

type Ordered = { row: PageRow; lane: WorkLane; rank: number | null };

/**
 * Order one lane's rows and hand the ranked ones their number.
 *
 * Next is the only lane with a rank, and only a row whose reason was
 * recorded earns one: an outcome nobody wrote a reason for cannot be argued
 * to be second most important, so it queues behind the ranked work unnumbered
 * rather than borrowing a position it never earned.
 * @param lane - The lane.
 * @param rows - Its rows.
 * @param now - The clock.
 */
function orderLane(lane: WorkLane, rows: PageRow[], now: Date): Ordered[] {
  const time = (r: PageRow) => (lane === 'done' ? finishedAt(r) : askedAt(r))?.getTime() ?? now.getTime();
  if (lane === 'done') {
    return [...rows].sort((a, b) => time(b) - time(a)).map(row => ({ row, lane, rank: null }));
  }
  if (lane !== 'next') {
    return [...rows].sort((a, b) => time(a) - time(b)).map(row => ({ row, lane, rank: null }));
  }
  const rankable = rows.filter(r => readReasons(meta(r)).recorded);
  const rest = rows.filter(r => !readReasons(meta(r)).recorded);
  rankable.sort((a, b) => (num(b, 'priority') ?? 0) - (num(a, 'priority') ?? 0) || time(a) - time(b));
  rest.sort((a, b) => time(a) - time(b));
  return [
    ...rankable.map((row, i) => ({ row, lane, rank: i + 1 })),
    ...rest.map(row => ({ row, lane, rank: null })),
  ];
}

/**
 * The Work page's rows: the queue, in four lanes, each row carrying its own
 * sentences and each lane carrying what it could not draw.
 *
 * Pure, so the mapping can be argued with in a test rather than in a browser.
 * Rows are copied, never mutated, and every kept row carries the same set of
 * figures for the whole queue (`meta.nextCount` and friends) so the page's
 * top line counts what EXISTS rather than what fitted.
 * @param rows - Every request row, unfiltered.
 * @param options - Clock and lane caps, for tests and for tuning.
 */
export function deriveWorkQueue(rows: PageRow[], options: WorkQueueOptions = {}): PageRow[] {
  const now = options.now ?? new Date();
  const nextShown = options.nextShown ?? NEXT_SHOWN;
  const doneShown = options.doneShown ?? DONE_SHOWN;
  const withinMs = (options.doneWithinDays ?? DONE_WITHIN_DAYS) * 86_400_000;

  const kept = rows.filter((r) => {
    if (isProbeRow(r)) {
      return false;
    }
    const state = str(r, 'state');
    if (state && ARCHIVE_STATES.has(state)) {
      return false;
    }
    if (laneOf(r) !== 'done') {
      return true;
    }
    const when = finishedAt(r);
    return when !== null && now.getTime() - when.getTime() <= withinMs;
  });

  const byLane = new Map<WorkLane, PageRow[]>(WORK_LANES.map(l => [l, [] as PageRow[]]));
  for (const r of kept) {
    byLane.get(laneOf(r))!.push(r);
  }

  const nextRows = byLane.get('next')!;
  const waitingRows = byLane.get('waiting')!;
  const figures = {
    nextCount: nextRows.length,
    progressCount: byLane.get('progress')!.length,
    waitingCount: waitingRows.length,
    doneCount: byLane.get('done')!.length,
    urgentCount: kept.filter(r => flagsOf(r, laneOf(r)).includes('urgent')).length,
    unreasonedCount: nextRows.filter(r => !readReasons(meta(r)).recorded).length,
    waitingMinutes: waitingRows.reduce((a, r) => a + (num(r, 'decisionCost') ?? 0), 0),
  };

  const out: PageRow[] = [];
  WORK_LANES.forEach((lane, laneIndex) => {
    const ordered = orderLane(lane, byLane.get(lane)!, now);
    const cap = lane === 'next' ? nextShown : lane === 'done' ? doneShown : ordered.length;
    const shown = ordered.slice(0, cap);
    const label = laneLabel(lane, {
      total: ordered.length,
      shown: shown.length,
      ranked: ordered.filter(o => o.rank !== null).length,
      minutes: figures.waitingMinutes,
    });
    for (const [i, { row, rank }] of shown.entries()) {
      const flags = flagsOf(row, lane);
      out.push({
        ...row,
        meta: {
          ...row.meta,
          ...figures,
          lane: label,
          laneKey: lane,
          order: laneIndex * 1000 + i,
          rank: rank === null ? undefined : String(rank),
          whyLine: whyLine(row) ?? undefined,
          workLine: workLine(row, lane, now),
          costLine: costLine(row, lane) ?? undefined,
          flags: flags.length > 0 ? flags : undefined,
        },
      });
    }
  });
  return out;
}
