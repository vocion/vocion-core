import type { ProofRecord } from './featureProof';
import type { PageRow } from './pageFields';
import { seatLabel } from '@/libs/gates/handoffGate';
import { readRecovery, recoveryStage } from '@/services/factory/recovery';
import { featureProof, shippedTaskIdsOf } from './featureProof';
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

/** The three lanes, in the order a person reads them. */
export const WORK_LANES = ['progress', 'proposed', 'done'] as const;
export type WorkLane = typeof WORK_LANES[number];

/** How many rows each lane draws before the heading carries the remainder. */
export const PROPOSED_SHOWN = 6;
export const DONE_SHOWN = 5;
/**
 * How many undecided recommendations read "Decide" at once. Twenty-five
 * Decide badges down one phone screen is not a queue of decisions, it is a
 * wall (Chris, 2026-09-24: "700 items need attention is uselessly
 * overwhelming"). The first few lead; the rest are STAGED — still owed,
 * still undecided, drawn after the ranked work with a muted badge, and they
 * move up as decisions land. Nothing is stored: staging is a reading.
 */
export const DECIDE_SHOWN = 3;

/** The mark a row wears when it has no picture: what KIND of thing it is. */
const KIND_ICON: Record<string, string> = { bug: 'bug', gap: 'puzzle', idea: 'lightbulb', incident: 'siren', question: 'circle-help' };

/**
 * The icon for a row's kind, so every card has a mark at its left edge even
 * before anyone has drawn it a picture.
 * @param row
 */
export function kindIconOf(row: PageRow): string {
  return KIND_ICON[(str(row, 'kind') ?? '').toLowerCase()] ?? 'list-checks';
}
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

export type WorkQueueOptions = {
  now?: Date;
  proposedShown?: number;
  doneShown?: number;
  doneWithinDays?: number;
  decideShown?: number;
  /**
   * The engineering tasks and releases, so a row's acceptance count is the
   * one its feature page shows (`featureProof`). Without them a row counts
   * only the marks on the request itself, through the same function.
   */
  tasks?: PageRow[];
  releases?: PageRow[];
  /**
   * Build cards (`factory.dispatch_task`) filed and waiting on a person, by
   * request. A row with one is waiting on you whatever its recommendation
   * says: journey 4's #214 had its Build card pending and read as queued.
   */
  pendingBuilds?: ReadonlyArray<{ requestId: number; runId: number; at: Date | null }>;
};

/**
 * How long a row may promise "no action needed" without anything on its
 * record moving. After that the promise is a guess, and the row says how long
 * it has been still instead (backlog 032: #40 read "5 tasks written, none
 * picked up yet. No action needed from you." for four days).
 */
export const STALL_AFTER_MS = 86_400_000;

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
  return str(row, 'recommendationState') === 'proposed' || num(row, 'pendingBuildRunId') !== null;
}

/**
 * Which lane a row belongs in. Finished first (a stale recommendation on
 * shipped work is not a person blocking anything), then building, and
 * everything else is proposed — owed and not started.
 *
 * Waiting on a person used to be a lane of its own and is now a STATE on the
 * row ({@link stateOf}). The lane answers "has a worker got to it"; whether a
 * person owes a decision is a different question, and asking both of one axis
 * put the same outcome in two places. A record with no state at all is owed
 * and has not started, so it is proposed.
 * @param row - The row.
 */
/** Sources that mean an AGENT filed the request on its own schedule. */
const AGENT_SOURCES = new Set(['product-manager', 'designer', 'task-planner', 'planner', 'mission', 'automation', 'agent']);

/**
 * A request a person asked for, as opposed to one an agent proposed on its own schedule.
 * @param row
 */
export function askedByPerson(row: PageRow): boolean {
  // Who asked: a name, or a person object (`askedBy: {name, email}`), never an agent handle.
  const asked = meta(row).askedBy ?? meta(row).requestedBy ?? meta(row).requester;
  const by = typeof asked === 'string' ? asked.trim() : asked && typeof asked === 'object' ? 'person' : '';
  if (by !== '' && !by.startsWith('agent:') && !by.startsWith('automation:') && !by.startsWith('mission:')) {
    return true;
  }
  // Where it came from: a chat, a form, an email is a person; a mission or an agent slug is not.
  const source = (str(row, 'source') ?? '').toLowerCase();
  return source !== '' && !AGENT_SOURCES.has(source) && !source.startsWith('agent:');
}

const SEVERITY_RANK: Record<string, number> = { p0: 4, critical: 4, blocker: 4, p1: 3, high: 3, major: 2, p2: 2, medium: 2, minor: 1, p3: 1, low: 1 };

/**
 * Which undecided recommendation a person should read first: what a person
 * asked for over what an agent proposed, the more severe over the less, the
 * higher priority over the lower, the older over the newer.
 * @param a
 * @param b
 * @param time - When each was asked.
 */
function decideOrder(a: PageRow, b: PageRow, time: (r: PageRow) => number): number {
  return Number(askedByPerson(b)) - Number(askedByPerson(a))
    || (SEVERITY_RANK[(str(b, 'severity') ?? '').toLowerCase()] ?? 0) - (SEVERITY_RANK[(str(a, 'severity') ?? '').toLowerCase()] ?? 0)
    || (num(b, 'priority') ?? 0) - (num(a, 'priority') ?? 0)
    || time(a) - time(b);
}

/**
 * A proposal a person dismissed: out of scope, or its recommendation rejected.
 * @param row - The row.
 */
export function isDismissed(row: PageRow): boolean {
  // A duplicate ends where it is marked (`duplicateOf`); its work is the other request's.
  return str(row, 'state') === 'out_of_scope' || str(row, 'recommendationState') === 'rejected' || (num(row, 'duplicateOf') ?? 0) > 0;
}

export function laneOf(row: PageRow): WorkLane {
  const state = str(row, 'state');
  if (state && DONE_STATES.has(state)) {
    return 'done';
  }
  // The factory carrying it — planning, recovering, stopped at the limit — is
  // work in progress whatever the request's own state says (backlog 038).
  return state === 'building' || recoveryStage(meta(row)) !== null ? 'progress' : 'proposed';
}

/** The stages of the loop, in the order a person sees them. `answered` and `deferred` are the two exits. */
export const WORK_STAGES = ['asked', 'decided', 'planned', 'building', 'qa', 'released', 'answered', 'deferred'] as const;
export type WorkStage = typeof WORK_STAGES[number];

/** An actual obstacle, as the record wrote it: what, who clears it, the one move. */
export type Blocker = { what: string; owner: string | null; next: string | null };

/**
 * The obstacle on a row, if the record names one.
 *
 * STAGE, ACTIVITY AND BLOCKER ARE THREE FACTS (review, 2026-09-24). Until
 * now "tasks written, none running" read as Blocked, which mislabelled work
 * awaiting dispatch, awaiting QA, ready to merge and waiting on an approved
 * dependency — normal waiting reported as failure. Blocked now means an
 * obstacle somebody wrote down (`request.blocker`: what, owner, next), and
 * nothing else; the waits are states of their own ({@link stateOf}).
 * @param row - The row.
 */
export function blockerOf(row: PageRow): Blocker | null {
  const raw = meta(row).blocker;
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const b = raw as Record<string, unknown>;
  const what = typeof b.what === 'string' && b.what.trim() !== '' ? b.what.trim() : null;
  if (what === null) {
    return null;
  }
  const text = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() !== '' ? (b[k] as string).trim() : null);
  return { what, owner: text('owner'), next: text('next') };
}

/**
 * Is there an actual obstacle on this outcome? Only when the record names
 * one, and never on finished work.
 * @param row - The row.
 */
export function isBlocked(row: PageRow): boolean {
  return laneOf(row) !== 'done' && blockerOf(row) !== null;
}

/**
 * Where in the loop this outcome is, read off the records and never stored:
 * the request's state, the tasks under it and what they are waiting on.
 * @param row - The row.
 */
export function stageOf(row: PageRow): WorkStage {
  const state = str(row, 'state');
  if (state === 'answered') {
    return 'answered';
  }
  if (state === 'shipped') {
    return 'released';
  }
  if (state === 'deferred') {
    return 'deferred';
  }
  if (state === 'building') {
    return (num(row, 'awaitingReviewTaskCount') ?? 0) > 0 || (num(row, 'acceptedTaskCount') ?? 0) > 0 ? 'qa' : 'building';
  }
  if (state === 'in_scope' || state === 'out_of_scope') {
    return (num(row, 'taskCount') ?? 0) > 0 ? 'planned' : 'decided';
  }
  return 'asked';
}

/**
 * Which wait a building outcome is in, when it is not actually running.
 * @param row - The row.
 */
function waitOf(row: PageRow): 'merge' | 'qa' | 'stuck' | 'changes' | 'dispatch' | null {
  const tasks = num(row, 'taskCount') ?? 0;
  const running = num(row, 'runningTaskCount') ?? 0;
  const review = num(row, 'awaitingReviewTaskCount') ?? 0;
  const accepted = num(row, 'acceptedTaskCount') ?? 0;
  const changes = num(row, 'changesRequestedTaskCount') ?? 0;
  const stuck = num(row, 'reviewFailedTaskCount') ?? 0;
  if (running > 0) {
    return null;
  }
  if (accepted > 0 && accepted >= tasks) {
    return 'merge';
  }
  if (review > 0) {
    return 'qa';
  }
  if (stuck > 0) {
    return 'stuck';
  }
  // QA SENT IT BACK, AND THAT IS THE READER'S MOVE (2026-09-26: #131 read
  // "Awaiting QA; no action needed" under a verdict of 0 of 8 proven).
  if (changes > 0) {
    return 'changes';
  }
  return tasks > 0 ? 'dispatch' : null;
}

/**
 * The factory's own stage on a building row, when it is the truest thing to
 * say: planning while nothing runs, an automatic attempt out after a failure,
 * or stopped at the limit. A wait with a person's name on it (QA, a merge,
 * changes asked) still reads as that wait.
 * @param row - The row.
 */
function carryingLabel(row: PageRow): ReturnType<typeof recoveryStage> {
  const carrying = recoveryStage(meta(row));
  if (!carrying) {
    return null;
  }
  const wait = waitOf(row);
  if (carrying.stage === 'stopped') {
    return carrying;
  }
  if (carrying.stage === 'planning') {
    return (num(row, 'runningTaskCount') ?? 0) > 0 ? null : carrying;
  }
  return wait === null || wait === 'dispatch' ? carrying : null;
}

/** What a queued outcome is called before anyone has started it. */
const PROPOSED_STATE_LABEL: Record<string, string> = {
  new: 'Not triaged',
  triaged: 'Triaged',
  in_scope: 'In scope',
};

/**
 * The row's state, as one badge.
 *
 * This is what replaced the section headings. Three lanes each used to carry
 * two or three sub-headings, and every row under one repeated the heading's
 * own sentence back ("waiting on you to decide", nine times down a column).
 * The badge says it once, on the row, so one list can hold rows in different
 * states without a heading between every pair of them.
 *
 * The label only: which tone paints it is presentation, and the page manifest
 * owns that through `format: badge` + `tones`, the same way every other
 * badged field on every other page does.
 * @param row - The row.
 * @param lane - The lane it landed in.
 * @param opts
 * @param opts.staged
 * @param opts.now
 */
export function stateOf(row: PageRow, lane: WorkLane, opts: { staged?: boolean; now?: Date } = {}): string {
  if (lane !== 'done' && isBlocked(row)) {
    return 'Blocked';
  }
  // A gate sent it back: the seat named owes the fix, and the row says so
  // before anything else — a returned outcome is not waiting on a person.
  const returnedTo = str(row, 'returnedTo');
  if (lane !== 'done' && returnedTo) {
    return `Returned to ${seatLabel(returnedTo)}`;
  }
  if (lane === 'progress') {
    const carrying = carryingLabel(row);
    if (carrying) {
      return carrying.label;
    }
    switch (waitOf(row)) {
      case 'merge':
        return 'Ready to merge';
      case 'qa':
        return 'Awaiting QA';
      case 'stuck':
        return 'QA could not finish';
      case 'changes':
        return 'Changes asked';
      case 'dispatch':
        // Nothing sends written tasks to a worker by itself: past a day it
        // is not waiting, it has stalled.
        return isStale(row, opts.now ?? new Date()) ? 'Stalled' : 'Awaiting dispatch';
      default:
        return 'Building';
    }
  }
  if (lane === 'done') {
    if (str(row, 'state') === 'answered') {
      return 'Answered';
    }
    const result = str(row, 'result');
    return result === 'helped' ? 'Shipped · helped' : result === 'did_not_help' ? 'Shipped · did not help' : 'Shipped';
  }
  if (str(row, 'state') === 'deferred') {
    return 'Deferred';
  }
  if (isWaitingOnPerson(row)) {
    return opts.staged ? 'Staged' : 'Decide';
  }
  return PROPOSED_STATE_LABEL[str(row, 'state') ?? ''] ?? 'Queued';
}

/**
 * When a finished outcome finished, best evidence first.
 * @param row
 */
function finishedAt(row: PageRow): Date | null {
  // The day it shipped, when the record says so. `rollupsUpdatedAt` is the
  // last time a figure under it was recounted, which is not when it finished
  // (#39 shipped 09-20 and read "4 days ago" on 09-28 off a 09-24 recount).
  const shipped = date(meta(row).shippedAt);
  const answered = date(meta(row).answeredAt);
  return (str(row, 'state') === 'shipped' ? shipped ?? answered : answered ?? shipped)
    ?? date(meta(row).rollupsUpdatedAt)
    ?? date(meta(row).decidedAt)
    ?? row.createdAt;
}

/**
 * When something on this outcome last moved, best evidence first: the
 * factory's own log, a gate's return, a blocker written down, a task's
 * figures recounted, a decision, the contract frozen, the ask itself.
 * @param row
 */
export function movedAt(row: PageRow): Date | null {
  const m = meta(row);
  const recovery = readRecovery(m);
  const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
  const candidates = [
    ...recovery.log.map(l => l.at),
    ...recovery.attempts.map(a => a.at),
    recovery.planRequestedAt,
    recovery.since,
    obj(m.gate).at,
    obj(m.blocker).at,
    m.rollupsUpdatedAt,
    m.decidedAt,
    m.acceptanceFrozenAt,
    m.askedAt,
  ].map(date).filter((d): d is Date => d !== null);
  const newest = candidates.sort((a, b) => b.getTime() - a.getTime())[0];
  return newest ?? row.createdAt;
}

/**
 * Has nothing on this outcome moved for longer than a promise of "no action
 * needed" can stand on?
 * @param row
 * @param now
 */
export function isStale(row: PageRow, now: Date): boolean {
  const moved = movedAt(row);
  return moved !== null && now.getTime() - moved.getTime() > STALL_AFTER_MS;
}

/**
 * The factory's own stage, dated: when the newest line of its log was written.
 * @param row
 */
function carriedAt(row: PageRow): Date | null {
  const r = readRecovery(meta(row));
  const at = [...r.log.map(l => l.at), ...r.attempts.map(a => a.at), r.planRequestedAt].map(date).filter((d): d is Date => d !== null);
  return at.sort((a, b) => b.getTime() - a.getTime())[0] ?? movedAt(row);
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
 * A sentence with the date it happened on the end: "… · today".
 * @param sentence - What happened.
 * @param at - When.
 * @param now - The clock.
 */
function dated(sentence: string, at: Date | null, now: Date): string {
  const text = sentence.trim().replace(/[\s.;:,]+$/, '');
  return at ? `${text} · ${daysAgoLabel(at, now)}` : `${text}.`;
}

/**
 * A clause, closed with one full stop.
 * @param text
 */
function said(text: string): string {
  const t = text.trim().replace(/[\s.;:,]+$/, '');
  return t.endsWith('…') || /[!?]$/.test(t) ? t : `${t}.`;
}

/**
 * "No action needed from you" only while the record is moving. A promise
 * nothing has kept for a day becomes how long it has been still.
 * @param row
 * @param now
 */
function stillOrFine(row: PageRow, now: Date): string {
  if (!isStale(row, now)) {
    return 'No action needed from you';
  }
  const days = Math.floor((now.getTime() - movedAt(row)!.getTime()) / 86_400_000);
  return `Nothing has moved in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The first clause of a reason, before its list or its advice: "6 of 6
 * acceptance criteria are not met — Pressing Send mails …" is "6 of 6
 * acceptance criteria are not met".
 * @param text
 */
function firstClause(text: string): string {
  const head = text.split(/\s[—–]\s/)[0] ?? text;
  return firstSentence(head);
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
 * @param opts
 * @param opts.staged
 * @param opts.ahead
 */
export function workLine(row: PageRow, lane: WorkLane, now: Date, opts: { staged?: boolean; ahead?: number } = {}): string | null {
  // A PLAIN SENTENCE: what is happening, and whether it needs the reader.
  // "Awaiting QA. Engineering finished; no action needed from you." — not a
  // count that the reader has to turn into a state (review, 2026-09-24).
  // EVERY LINE SAYS WHAT HAPPENED AND WHEN (backlog 032). A sentence with no
  // date cannot be checked against the record, and "no action needed" is a
  // promise that only holds while something is moving ({@link stillOrFine}).
  const blocker = lane !== 'done' ? blockerOf(row) : null;
  if (blocker) {
    const who = blocker.owner ? `${blocker.owner} to ${blocker.next ?? 'clear it'}` : blocker.next ?? 'nobody is named to clear it';
    const raw = meta(row).blocker as Record<string, unknown>;
    return dated(`${said(blocker.what)} ${who}`, date(raw.at) ?? movedAt(row), now);
  }
  const returnedTo = str(row, 'returnedTo');
  if (lane !== 'done' && returnedTo) {
    // Nothing picks a returned outcome up by itself: the seat named owes the
    // fix, and the row says what the gate found and when — never "no action
    // needed" (#121 read that for three days over a 400-character reason).
    const gate = meta(row).gate as { name?: string; at?: string; failed?: Array<{ field: string; why: string }>; judged?: string; reasonCode?: string; example?: string; note?: string } | undefined;
    const at = date(gate?.at) ?? movedAt(row);
    const by = gate?.name ? ` by the "${gate.name}" gate` : ' by a gate';
    const head = `Sent back to ${seatLabel(returnedTo)}${by}`;
    const first = gate?.failed?.[0];
    if (first) {
      const more = (gate?.failed?.length ?? 0) > 1 ? ` (+${gate!.failed!.length - 1} more)` : '';
      return dated(`${head}: ${firstClause(first.why)}${more}`, at, now);
    }
    if (gate?.judged === 'return') {
      const what = gate.example || gate.note || gate.reasonCode || 'it did not pass the rubric';
      return dated(`${head}: ${firstClause(what)}`, at, now);
    }
    return dated(head, at, now);
  }
  if (lane === 'progress') {
    const carrying = carryingLabel(row);
    if (carrying) {
      const line = said(firstSentence(carrying.line));
      return carrying.stage === 'stopped'
        ? dated(`${line} A person decides next`, carriedAt(row), now)
        : dated(`${line} ${stillOrFine(row, now)}`, carriedAt(row), now);
    }
    const tasks = num(row, 'taskCount') ?? 0;
    const noun = tasks === 1 ? 'task' : 'tasks';
    const at = movedAt(row);
    switch (waitOf(row)) {
      case 'merge':
        return dated('QA approved. The merge is waiting on a person', at, now);
      case 'qa':
        return dated(`Engineering finished. Awaiting QA; ${stillOrFine(row, now).toLowerCase()}`, at, now);
      case 'stuck':
        return dated('The review ended without a verdict. Build again starts a fresh attempt', at, now);
      case 'changes':
        return dated('QA sent it back with what would settle each criterion. Build again carries it', at, now);
      case 'dispatch':
        // Written and never sent: nothing will send it by itself, so this is
        // never "no action needed" (backlog 032, #40).
        return dated(`${tasks} ${noun} written, none sent to a worker. Build again sends ${tasks === 1 ? 'it' : 'them'}`, at, now);
      default:
        return tasks ? dated(`${tasks} ${noun} underway. ${stillOrFine(row, now)}`, at, now) : null;
    }
  }
  if (lane === 'done') {
    const when = finishedAt(row);
    const ago = when ? daysAgoLabel(when, now) : null;
    if (str(row, 'state') === 'answered') {
      return ago;
    }
    const result = str(row, 'result');
    if (result === 'helped' || result === 'did_not_help') {
      const note = str(row, 'resultNote');
      return note ? firstSentence(note) : ago;
    }
    if (result === 'not_enough_evidence') {
      return `${ago ?? 'Shipped'} · result: not enough evidence yet`;
    }
    const check = date(meta(row).checkAfter);
    if (check) {
      return check.getTime() > now.getTime() ? `${ago ?? 'Shipped'} · result checked ${check.toISOString().slice(0, 10)}` : `${ago ?? 'Shipped'} · result not checked yet`;
    }
    return ago;
  }
  if (str(row, 'state') === 'deferred') {
    const until = date(meta(row).deferredUntil);
    const reason = str(row, 'deferReason');
    const head = until ? `Deferred until ${until.toISOString().slice(0, 10)}` : 'Deferred';
    return reason ? `${head}: ${firstSentence(reason)}` : head;
  }
  if (isWaitingOnPerson(row)) {
    const verb = OUTCOME_VERB[str(row, 'recommendedOutcome') ?? ''] ?? null;
    // The action, and how long it has waited — "Decide whether to build ·
    // waiting 2 days" — not a sentence about who recommended what.
    const since = date(meta(row).recommendedAt) ?? date(meta(row).rankedAt) ?? askedAt(row);
    const days = since ? Math.floor((now.getTime() - since.getTime()) / 86_400_000) : null;
    const waited = days === null ? '' : days < 1 ? ' · waiting since today' : ` · waiting ${days} day${days === 1 ? '' : 's'}`;
    if (opts.staged) {
      const ahead = opts.ahead ?? 0;
      return `Behind ${ahead} decision${ahead === 1 ? '' : 's'}, moves up as they land${waited}`;
    }
    // A Build card already filed: the decision is that card, and it is
    // made on the feature page (Build it approves it, with Undo).
    const buildCard = num(row, 'pendingBuildRunId');
    if (buildCard !== null) {
      const at = date(meta(row).pendingBuildAt);
      const cardDays = at ? Math.floor((now.getTime() - at.getTime()) / 86_400_000) : days;
      const cardWaited = cardDays === null ? '' : cardDays < 1 ? ' · waiting since today' : ` · waiting ${cardDays} day${cardDays === 1 ? '' : 's'}`;
      return `Build card waiting on you (action #${buildCard})${cardWaited}`;
    }
    return verb ? `Decide whether to ${verb}${waited}` : `Decide${waited}`;
  }
  // A queued row's state is already on its badge, so the line says only
  // when it arrived: a row with no date cannot be checked against anything.
  const asked = askedAt(row);
  return asked ? `Filed ${daysAgoLabel(asked, now)}` : null;
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
  // A zero is not a figure (2026-09-26: "$0.00 of about $0.00", "$13.04 of
  // about $0.00" on the Work page). An estimate of nothing is no estimate,
  // and nothing spent yet is not worth a line.
  const positive = (n: number | null): number | null => (n !== null && n > 0 ? n : null);
  const estimate = positive(num(row, 'estimateCents'));
  const actual = positive(num(row, 'actualCents'));
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
 * The surfaces that owe a picture. A change to the machine underneath is not
 * one a person can look at, so asking it for a mockup would be a gate nobody
 * could pass and everybody would learn to route around.
 */
const VISUAL_SURFACES = new Set(['ui', 'flow']);

/**
 * What this outcome has to show for itself, counted.
 * @param row
 */
function visualsOf(row: PageRow): { before: number; after: number; reason: string | null } {
  const raw = meta(row).visuals;
  const v = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const count = (k: string) => (Array.isArray(v[k]) ? (v[k] as unknown[]).length : 0);
  const note = typeof v.noVisualReason === 'string' && v.noVisualReason.trim() !== '' ? v.noVisualReason.trim() : null;
  // The mock is `mockupArtifactIds` (draw_mockup); a record from before the
  // split kept it on `beforeArtifactIds`, which now holds the screenshot the
  // mockup was drawn on — a picture of today, not a proposal.
  const mocks = count('mockupArtifactIds');
  return { before: mocks > 0 ? mocks : count('beforeArtifactIds'), after: count('afterArtifactIds'), reason: note };
}

/** What a row's acceptance count reads beside the request: its attempts, and which of them shipped. */
export type AcceptanceContext = { tasks: ProofRecord[]; shippedTaskIds: number[] };

/**
 * How many acceptance criteria a row carries, and how many are proven — the
 * count its feature page and its release show (`featureProof`), never the
 * request's own `met` flags read on their own. A line marked met with no
 * evidence is not proven there, so it is not proven here.
 * @param row - The request row.
 * @param related - Its attempts and what shipped, when the page loaded them.
 */
export function acceptanceOf(row: PageRow, related?: AcceptanceContext): { total: number; proven: number; frozen: boolean } {
  const proof = featureProof({ request: { id: Number(row.id), meta: meta(row) }, tasks: related?.tasks ?? [], shippedTaskIds: related?.shippedTaskIds ?? [] });
  return { total: proof.total, proven: proof.proven, frozen: str(row, 'acceptanceFrozenAt') !== null };
}

/**
 * What a person is being asked to agree to, or the fact that nothing has been
 * written down yet.
 *
 * Acceptance criteria are the contract: what has to be true before this is
 * done, written before the work starts, in the language of the product. "Done
 * when it works" is not a contract, because nobody can tell whether it was
 * met — so an outcome put in front of a person with nothing written is the
 * gap this reports, and it reports it the same way the page already reports
 * an unranked queue and a missing mockup.
 *
 * A row already being built says how far the contract has been settled
 * instead, because by then the question is no longer "what did we agree" but
 * "how much of it holds".
 * @param row - The row.
 * @param lane - The lane it landed in.
 * @param related
 */
export function acceptanceLine(row: PageRow, lane: WorkLane, related?: AcceptanceContext): string | null {
  const { total, proven } = acceptanceOf(row, related);
  if (lane === 'proposed') {
    // Nothing, rather than "no criteria" on every row that has none: the gap
    // is on the feature page, and a phrase repeated down a list is noise.
    return total === 0 ? null : `${total} ${total === 1 ? 'criterion' : 'criteria'}`;
  }
  if (lane === 'progress' && total > 0) {
    return `${proven} of ${total} proven`;
  }
  if (lane === 'done' && total > 0) {
    return proven === total ? `all ${total} proven` : `${proven} of ${total} proven`;
  }
  return null;
}

/**
 * A finished outcome whose contract does not hold.
 *
 * This is the QA gate, and it is STRUCTURAL rather than a prompt. A request
 * that reached `shipped` with criteria nobody checked, or criteria that
 * failed, is not done — it is a claim. Stating that in code means it cannot
 * be argued away by a model having a confident day, which is the whole reason
 * the criteria carry evidence in the first place.
 *
 * An outcome with no criteria at all is NOT reported here: that gap belongs
 * to the proposal, where {@link acceptanceLine} already reports it as "no
 * criteria". Reporting it twice would put the same complaint on a row at both
 * ends of its life.
 * @param row - The row.
 * @param lane - The lane it landed in.
 * @param related
 */
export function contractGap(row: PageRow, lane: WorkLane, related?: AcceptanceContext): string | null {
  if (lane !== 'done') {
    return null;
  }
  const { total, proven } = acceptanceOf(row, related);
  if (total === 0 || proven === total) {
    return null;
  }
  // The feature page's own words: "0 of 5 proven", not "5 of 5 unmet" — an
  // unchecked line is unproven, which is not the same as failed.
  return `${proven} of ${total} proven`;
}

/**
 * What this row cannot show, in the words the row would use.
 *
 * A decision about something a person will look at should be taken against
 * something a person can look at, and work that shipped should be checkable
 * against the running product. So a `ui` or `flow` outcome owes a mockup or a
 * diagram before it is decided, and an after-shot before it is closed.
 *
 * The gap is DRAWN rather than enforced silently: the row says what is
 * missing and the lane counts it, which is what this page already does with
 * an unranked queue. A recorded `noVisualReason` closes it — a way out
 * somebody wrote down, never a skip nobody noticed. An outcome nobody has
 * classified reports that instead, because "we do not know whether this
 * changes what a person sees" is its own missing fact.
 * @param row - The row.
 * @param lane - The lane it landed in.
 */
export function visualGap(row: PageRow, lane: WorkLane): string | null {
  if (lane === 'progress') {
    return null;
  }
  // An outcome nobody has classified claims NO gap. Reporting one would put
  // "surface not set" on every row the day this shipped, and a column where
  // every entry is the same complaint reports nothing at all — the same
  // argument this page already makes about "not recorded". Classifying is
  // what the backfill does; a gap appears once we know a picture is owed.
  const surface = str(row, 'surface');
  if (surface === null || !VISUAL_SURFACES.has(surface)) {
    return null;
  }
  const v = visualsOf(row);
  if (v.reason !== null) {
    return null;
  }
  if (lane === 'proposed') {
    return v.before === 0 ? 'no mock' : null;
  }
  return v.after === 0 ? 'no after' : null;
}

/**
 * WHICH PICTURE this row shows, as an artifact id.
 *
 * One card, one picture, and which one depends on where the work is. A row
 * that has shipped shows what it looks like NOW — an after-shot beats a
 * mockup of it the moment there is one, because the mockup has stopped being
 * a proposal and become a historical claim. Everywhere else the row shows
 * what is proposed, which is the thing a decision is taken against.
 *
 * The id rather than a URL: the record names an artifact, and the page layer
 * resolves it once for the whole page (`services/workspace/pageImages.ts`).
 * Nothing is stored here that could disagree with the artifact.
 * @param row - The row.
 * @param lane - The lane it landed in.
 */
export function visualArtifactId(row: PageRow, lane: WorkLane): number | null {
  const raw = meta(row).visuals;
  const v = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const first = (key: string): number | null => {
    const list = v[key];
    const id = Array.isArray(list) ? list[0] : undefined;
    return Number.isInteger(id) && (id as number) > 0 ? id as number : null;
  };
  // The platform's own drawing is the floor under the picture, never the
  // gate: the card shows it when nothing real exists, and `visualGap` keeps
  // saying `no mock` until Design files one (review, 2026-09-24).
  // The row's picture is a REAL one — a mockup somebody filed, or the
  // after-shot once it shipped. The platform's drawing is the feature page's
  // fallback, not a list thumbnail (Chris, 2026-09-25).
  const proposed = first('mockupArtifactIds') ?? first('beforeArtifactIds');
  return lane === 'done' ? first('afterArtifactIds') ?? proposed : proposed;
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
  // On the proposed lane the row's own badge already reads "Decide"; this
  // flag exists for the outcome a worker is building while the recommendation
  // behind it is still undecided, which no lane would otherwise show.
  if (isWaitingOnPerson(row) && lane === 'progress') {
    out.push('waiting on you');
  }
  if (str(row, 'sizeClass') === 'major') {
    out.push('major');
  }
  return out;
}

/**
 * A lane's name — short, because it is a tab a person taps rather than a
 * sentence they read. What the lane could not draw rides on {@link laneNote}.
 * @param lane - The lane.
 */
function laneLabel(lane: WorkLane): string {
  if (lane === 'progress') {
    return 'In progress';
  }
  return lane === 'done' ? 'Done' : 'Proposed';
}

/**
 * The one line a lane carries that its rows could not: the decision time it
 * is holding, the work it could not draw, the gap in what was recorded.
 *
 * It is a NOTE rather than part of the label because the label is now a tab,
 * and a tab that grows a clause every time the data changes stops being a
 * place to tap.
 * @param lane - The lane.
 * @param counts - What the lane knows about itself.
 * @param counts.total - Rows in the lane.
 * @param counts.shown - Rows it drew.
 * @param counts.ranked - Rows that earned a rank.
 * @param counts.queued - Rows nobody is waiting on a decision for.
 * @param counts.minutes - Decision minutes the lane is holding.
 * @param counts.blocked - Rows that have stopped.
 * @param counts.noVisual - Rows that owe a picture and have none.
 * @param counts.deciding
 * @param counts.staged
 */
function laneNote(lane: WorkLane, counts: { total: number; shown: number; ranked: number; queued: number; minutes: number; blocked: number; noVisual: number; deciding: number; staged: number }): string | null {
  const hidden = counts.total - counts.shown;
  if (lane === 'progress') {
    return counts.blocked > 0 ? `${counts.blocked} blocked` : null;
  }
  if (lane === 'done') {
    const shipped: string[] = [];
    if (counts.noVisual > 0) {
      shipped.push(`${counts.noVisual} without an after`);
    }
    if (hidden > 0) {
      shipped.push(`${hidden} more in Activity`);
    }
    return shipped.length > 0 ? shipped.join(' · ') : null;
  }
  const parts: string[] = [];
  if (counts.deciding > 0) {
    parts.push(`${counts.deciding} to decide${counts.minutes > 0 ? ` · about ${counts.minutes} min` : ''}`);
  }
  if (counts.staged > 0) {
    parts.push(`${counts.staged} staged behind them`);
  }
  if (counts.queued > 0 && counts.ranked === 0) {
    parts.push(`nothing ranked, no reason recorded on ${counts.queued}`);
  }
  // "N without a visual" was a complaint in the heading; the gap is on each
  // row's own badge where it can be acted on (Chris, 2026-09-24).
  if (hidden > 0) {
    parts.push(`${hidden} more queued`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

type Ordered = { row: PageRow; lane: WorkLane; rank: number | null; staged?: boolean; ahead?: number };

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
 * @param decideShown
 */
function orderLane(lane: WorkLane, rows: PageRow[], now: Date, decideShown = DECIDE_SHOWN): Ordered[] {
  const time = (r: PageRow) => (lane === 'done' ? finishedAt(r) : askedAt(r))?.getTime() ?? now.getTime();
  if (lane === 'done') {
    return [...rows].sort((a, b) => time(b) - time(a)).map(row => ({ row, lane, rank: null }));
  }
  // A stopped run costs a day; a running one costs nothing to leave alone. So
  // blocked sorts above building, and the lane's note says how many stopped.
  if (lane === 'progress') {
    return [...rows]
      .sort((a, b) => Number(isBlocked(b)) - Number(isBlocked(a)) || time(a) - time(b))
      .map(row => ({ row, lane, rank: null }));
  }
  // Proposed holds two kinds of row, and only one of them is stopped on a
  // person: an outcome whose recommendation nobody has decided sits above the
  // queue whatever its reason or age, because it is the only work here that
  // moves the moment it is read.
  const deferred = rows.filter(r => str(r, 'state') === 'deferred');
  // DISMISSED leaves the page (Chris, 2026-09-25: "a mechanism to dismiss a
  // proposal"). Out of scope, or a recommendation a person rejected, is a
  // decision already made; it stays on the record and in search, not in the
  // queue of things to decide.
  const live = rows.filter(r => str(r, 'state') !== 'deferred' && !isDismissed(r));
  const waiting = live.filter(r => isWaitingOnPerson(r));
  const queued = live.filter(r => !isWaitingOnPerson(r));
  const rankable = queued.filter(r => readReasons(meta(r)).recorded);
  const rest = queued.filter(r => !readReasons(meta(r)).recorded);
  waiting.sort((a, b) => decideOrder(a, b, time));
  rankable.sort((a, b) => (num(b, 'priority') ?? 0) - (num(a, 'priority') ?? 0) || time(a) - time(b));
  rest.sort((a, b) => time(a) - time(b));
  // The first few decisions lead. The rest are staged: after the ranked
  // queue, muted, each saying how many decisions stand ahead of it.
  const deciding = waiting.slice(0, decideShown);
  const staged = waiting.slice(decideShown);
  return [
    ...deciding.map(row => ({ row, lane, rank: null })),
    ...rankable.map((row, i) => ({ row, lane, rank: i + 1 })),
    ...staged.map((row, i) => ({ row, lane, rank: null, staged: true, ahead: deciding.length + i })),
    ...rest.map(row => ({ row, lane, rank: null })),
    // Not now, by a person's decision: last, unranked, and back at the top when the date passes.
    ...deferred.sort((a, b) => time(a) - time(b)).map(row => ({ row, lane, rank: null })),
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
  const proposedShown = options.proposedShown ?? PROPOSED_SHOWN;
  const doneShown = options.doneShown ?? DONE_SHOWN;
  const decideShown = options.decideShown ?? DECIDE_SHOWN;
  const withinMs = (options.doneWithinDays ?? DONE_WITHIN_DAYS) * 86_400_000;
  const tasksByRequest = new Map<number, ProofRecord[]>();
  for (const t of options.tasks ?? []) {
    const rid = Number(meta(t).requestId);
    if (Number.isSafeInteger(rid)) {
      tasksByRequest.set(rid, [...(tasksByRequest.get(rid) ?? []), { id: Number(t.id), meta: meta(t) }]);
    }
  }
  const shippedTaskIds = shippedTaskIdsOf((options.releases ?? []).map(r => ({ meta: meta(r) })));
  const relatedOf = (r: PageRow): AcceptanceContext => ({ tasks: tasksByRequest.get(Number(r.id)) ?? [], shippedTaskIds });
  const buildCards = new Map((options.pendingBuilds ?? []).map(b => [b.requestId, b] as const));
  const annotated = buildCards.size === 0
    ? rows
    : rows.map((r) => {
        const card = buildCards.get(Number(r.id));
        return card && laneOf(r) === 'proposed' ? { ...r, meta: { ...r.meta, pendingBuildRunId: card.runId, pendingBuildAt: card.at?.toISOString() } } : r;
      });

  const kept = annotated.filter((r) => {
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

  const proposedRows = byLane.get('proposed')!;
  const progressRows = byLane.get('progress')!;
  const waitingRows = proposedRows.filter(r => isWaitingOnPerson(r));
  const queuedRows = proposedRows.filter(r => !isWaitingOnPerson(r));
  const figures = {
    progressCount: progressRows.length,
    proposedCount: proposedRows.length,
    doneCount: byLane.get('done')!.length,
    blockedCount: progressRows.filter(r => isBlocked(r)).length,
    waitingCount: waitingRows.length,
    decidingCount: Math.min(waitingRows.length, decideShown),
    stagedCount: Math.max(0, waitingRows.length - decideShown),
    urgentCount: kept.filter(r => flagsOf(r, laneOf(r)).includes('urgent')).length,
    unreasonedCount: queuedRows.filter(r => !readReasons(meta(r)).recorded).length,
    waitingMinutes: waitingRows.reduce((a, r) => a + (num(r, 'decisionCost') ?? 0), 0),
  };

  const out: PageRow[] = [];
  WORK_LANES.forEach((lane, laneIndex) => {
    const ordered = orderLane(lane, byLane.get(lane)!, now, decideShown);
    const cap = lane === 'proposed' ? proposedShown : lane === 'done' ? doneShown : ordered.length;
    const shown = ordered.slice(0, cap);
    const note = laneNote(lane, {
      total: ordered.length,
      shown: shown.length,
      ranked: ordered.filter(o => o.rank !== null).length,
      queued: ordered.filter(o => !isWaitingOnPerson(o.row)).length,
      noVisual: ordered.filter(o => visualGap(o.row, lane) !== null).length,
      minutes: figures.waitingMinutes,
      blocked: figures.blockedCount,
      deciding: lane === 'proposed' ? figures.decidingCount : 0,
      staged: lane === 'proposed' ? figures.stagedCount : 0,
    });
    for (const [i, { row, rank, staged, ahead }] of shown.entries()) {
      const flags = flagsOf(row, lane);
      const state = stateOf(row, lane, { staged, now });
      const related = relatedOf(row);
      out.push({
        ...row,
        meta: {
          ...row.meta,
          ...figures,
          lane: laneLabel(lane),
          laneKey: lane,
          laneNote: note ?? undefined,
          order: laneIndex * 1000 + i,
          // The one line the row leads with: the outcome (what a person can
          // do afterwards), else the summary the record was filed with.
          problem: (str(row, 'outcome') ?? str(row, 'summary')) ?? undefined,
          rank: rank === null ? undefined : String(rank),
          state,
          stage: stageOf(row),
          blockerLine: blockerOf(row) && lane !== 'done' ? blockerOf(row)!.what : undefined,
          visualGap: visualGap(row, lane) ?? undefined,
          visual: visualArtifactId(row, lane) ?? undefined,
          kindIcon: kindIconOf(row),
          acceptanceLine: acceptanceLine(row, lane, related) ?? undefined,
          contractGap: contractGap(row, lane, related) ?? undefined,
          // Why it is worth doing is the proposal's argument; once it is
          // building or done the row says what is happening, not why.
          whyLine: lane === 'proposed' ? (whyLine(row) ?? undefined) : undefined,
          workLine: workLine(row, lane, now, { staged, ahead }) ?? undefined,
          costLine: costLine(row, lane) ?? undefined,
          flags: flags.length > 0 ? flags : undefined,
        },
      });
    }
  });
  return out;
}
