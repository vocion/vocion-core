import type { ProofRecord } from './featureProof';
import type { PageRow } from './pageFields';
import type { LiveRun } from '@/libs/factory/liveStatus';
import type { StatusModel, StatusPlace } from '@/libs/objects/statusModel';
import { nounCode } from '@/libs/codes';
import { deliveryLine, readDelivery } from '@/libs/factory/delivery';
import { nowLine } from '@/libs/factory/liveStatus';
import { seatLabel } from '@/libs/gates/handoffGate';
import { placeOf } from '@/libs/objects/statusModel';
import { readRecovery } from '@/services/factory/recovery';
import { featureProof, shippedTaskIdsOf } from './featureProof';
import { readReasons, reasonPhrase } from './reasonCodes';

/**
 * The Work queue, derived: each request's ONE status field (its type's
 * `x-groups`, `libs/objects/statusModel.ts`) read as the lanes its groups
 * name, each row carrying the sentence a person needs instead of the fields a
 * database holds.
 *
 * WHERE A ROW STANDS IS STORED, NOT INFERRED (Chris, 2026-10-02). The lane
 * was rebuilt here from a state, a recovery stage, a recommendation, ship and
 * reopen times and a delivery, and it drifted from the feature page: FE-224
 * shipped while it sat under In progress; FE-130 waited on a person's merge
 * while its row read "Awaiting dispatch". Now the factory writes the status
 * at each transition, its group is the lane and its label is the badge. The
 * lines under it are still read off the records, as detail.
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

/** What a lane does with its rows: the group roles a page draws (`archived` is not drawn). */
export const WORK_LANES = ['progress', 'proposed', 'done'] as const;
export type WorkLane = typeof WORK_LANES[number];

/**
 * A type that declares no status: every row in one lane of work, so the page
 * still draws what exists rather than nothing.
 */
const NO_STATUS: StatusModel = {
  field: 'status',
  groups: [{ key: 'progress', label: 'In progress', role: 'progress', in: [], last: [], default: true }],
  labels: {},
  tones: {},
  needsYou: new Set(),
  transitions: [],
};

/** How many rows each lane draws before the heading carries the remainder. */
export const PROPOSED_SHOWN = 6;
export const DONE_SHOWN = 20;
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
  /**
   * THE NOW LINE per record — what is running for it right now, or null —
   * read in one batch for the page (`services/factory/liveStatusData.loadLiveRuns`).
   * Each in-progress row carries it with a live dot; absent, rows carry none.
   */
  live?: ReadonlyMap<number, LiveRun | null>;
  /** The request type's status model (`loadStatusModel`): which lane each status is, and its words. */
  statuses?: StatusModel | null;
};

/** A row's Now line as the `live` field format draws it. */
export type RowNow = { line: string; live: boolean; href: string | null };

/**
 * Where a row stands: its status's group, label and tone.
 * @param row - The row.
 * @param model - The status model.
 */
export function placeOfRow(row: PageRow, model: StatusModel | null | undefined): StatusPlace {
  return placeOf(model ?? NO_STATUS, meta(row));
}

/**
 * Whether a row is waiting on a person: its status says so (the type's
 * `x-needs-you`), or an obstacle is written down. These lead their lane.
 * @param row - The row.
 * @param place - Where it stands.
 */
export function needsPerson(row: PageRow, place: StatusPlace): boolean {
  return place.needsYou || isBlocked(row, place);
}

/**
 * Whether a DERIVED row (one `deriveWorkQueue` returned) waits on a person.
 * @param row - The derived row.
 */
export function waitsOnYou(row: PageRow): boolean {
  return meta(row).needsYou === true;
}

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
 * Which lane a row belongs in: its status's group. A null or unknown status
 * is the default group's (the request type puts it In progress).
 * @param row - The row.
 * @param model - The status model.
 */
export function laneOf(row: PageRow, model: StatusModel | null | undefined): WorkLane | 'archived' {
  return placeOfRow(row, model).group.role;
}

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
 * @param place - Where it stands.
 */
export function isBlocked(row: PageRow, place: StatusPlace): boolean {
  return place.group.role !== 'done' && place.group.role !== 'archived' && blockerOf(row) !== null;
}

/** A badge tone, the page vocabulary's (`pageFields` `tones`). */
export type StateTone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

/** A Work row's state: the badge's words, and the tone they are drawn in. */
export type WorkState = { label: string; tone: StateTone };

/** A decision staged behind the first few: still owed, drawn muted (a reading, not a status). */
const STAGED: WorkState = { label: 'Staged', tone: 'muted' };

/**
 * The row's badge: its status's label and tone, as the request type declares
 * them (`meta.stateTone`, which the Work page's badge reads through
 * `toneFrom`). A decision staged behind the first few reads Staged.
 * @param place - Where it stands.
 * @param opts
 * @param opts.staged - Staged behind the decisions that lead.
 */
export function workStateOf(place: StatusPlace, opts: { staged?: boolean } = {}): WorkState {
  return opts.staged ? STAGED : { label: place.label, tone: place.tone };
}

/**
 * When a finished outcome finished, best evidence first.
 * @param row
 */
function finishedAt(row: PageRow): Date | null {
  // The day it shipped, when the record says so. `rollupsUpdatedAt` is the
  // last time a figure under it was recounted, which is not when it finished
  // (#39 shipped 09-20 and read "4 days ago" on 09-28 off a 09-24 recount).
  return date(meta(row).shippedAt)
    ?? date(meta(row).answeredAt)
    ?? date(meta(row).statusAt)
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
    m.statusAt,
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
 * an answer to, the sentence its status was written with, or the day it
 * finished. Detail under the badge — the badge is the status.
 * @param row - The row.
 * @param place - Where it stands.
 * @param now - The clock.
 * @param opts
 * @param opts.staged
 * @param opts.ahead
 */
export function workLine(row: PageRow, place: StatusPlace, now: Date, opts: { staged?: boolean; ahead?: number } = {}): string | null {
  const lane = place.group.role;
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
    // What the merge recorded, else the sentence the status was written with
    // ("RUN-478 is building attempt 2", "QA approved 8 of 8; the merge waits
    // on a person"). A line a person's move answers is never "no action
    // needed"; any other says so only while something is moving.
    const delivery = readDelivery(meta(row));
    if (delivery) {
      // After the merge, what carries it is GitHub's run: its line is kept
      // current by the reconcile, and says whose move it is itself.
      return deliveryLine(delivery);
    }
    const line = str(row, 'statusLine');
    const at = date(meta(row).statusAt) ?? movedAt(row);
    if (line === null) {
      return dated(place.value === null ? 'No status recorded yet' : `${place.label}. ${stillOrFine(row, now)}`, at, now);
    }
    return place.needsYou ? dated(line, at, now) : dated(`${said(firstSentence(line))} ${stillOrFine(row, now)}`, at, now);
  }
  if (lane === 'done') {
    const when = finishedAt(row);
    const ago = when ? daysAgoLabel(when, now) : null;
    if (str(row, 'shippedAt') === null) {
      return ago;
    }
    const result = str(row, 'result');
    if (result === 'helped' || result === 'did_not_help') {
      const note = str(row, 'resultNote');
      const verdict = result === 'helped' ? 'Helped' : 'Did not help';
      return note ? `${verdict}: ${firstSentence(note)}` : `${ago ?? 'Shipped'} · ${verdict.toLowerCase()}`;
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
  if (place.value !== null && place.group.last.includes(place.value)) {
    const until = date(meta(row).deferredUntil);
    const reason = str(row, 'deferReason');
    const head = until ? `${place.label} until ${until.toISOString().slice(0, 10)}` : place.label;
    return reason ? `${head}: ${firstSentence(reason)}` : head;
  }
  if (place.needsYou || num(row, 'pendingBuildRunId') !== null) {
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
      return `Build card waiting on you (${nounCode('action', buildCard)})${cardWaited}`;
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
  // The feature's whole spend — engineering, agents and chat — as the request
  // carries it (`services/factory/featureSpend.ts`); the engineering rollup
  // until that is first written.
  const actual = positive(num(row, 'spentCents') ?? num(row, 'actualCents'));
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
 * badge already states is not repeated on the row.
 * @param row - The row.
 * @param place - Where it stands.
 */
export function flagsOf(row: PageRow, place: StatusPlace): string[] {
  const out: string[] = [];
  if (str(row, 'severity') === 'p1' || str(row, 'kind') === 'incident') {
    out.push('urgent');
  }
  // An obstacle somebody wrote down is a fact beside the status, not one:
  // the line says what it is and who clears it.
  if (isBlocked(row, place)) {
    out.push('blocked');
  }
  if (str(row, 'sizeClass') === 'major') {
    out.push('major');
  }
  return out;
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

type Placed = { row: PageRow; place: StatusPlace };
type Ordered = Placed & { lane: WorkLane; rank: number | null; staged?: boolean; ahead?: number };

/**
 * Order one lane's rows and hand the ranked ones their number.
 *
 * Next is the only lane with a rank, and only a row whose reason was
 * recorded earns one: an outcome nobody wrote a reason for cannot be argued
 * to be second most important, so it queues behind the ranked work unnumbered
 * rather than borrowing a position it never earned.
 * @param lane - The lane.
 * @param rows - Its rows, each with where it stands.
 * @param now - The clock.
 * @param decideShown
 */
function orderLane(lane: WorkLane, rows: Placed[], now: Date, decideShown = DECIDE_SHOWN): Ordered[] {
  const time = (p: Placed) => (lane === 'done' ? finishedAt(p.row) : askedAt(p.row))?.getTime() ?? now.getTime();
  if (lane === 'done') {
    return [...rows].sort((a, b) => time(b) - time(a)).map(p => ({ ...p, lane, rank: null }));
  }
  // A stopped run costs a day; a running one costs nothing to leave alone. So
  // blocked sorts above building, and the lane's note says how many stopped.
  // A row waiting on a person leads next (Chris, 2026-09-30: "'Needs you'
  // rows lead"): it moves the moment it is read.
  if (lane === 'progress') {
    return [...rows]
      .sort((a, b) => Number(isBlocked(b.row, b.place)) - Number(isBlocked(a.row, a.place)) || Number(needsPerson(b.row, b.place)) - Number(needsPerson(a.row, a.place)) || time(a) - time(b))
      .map(p => ({ ...p, lane, rank: null }));
  }
  // Proposed holds two kinds of row, and only one of them is stopped on a
  // person: an outcome whose recommendation nobody has decided sits above the
  // queue whatever its reason or age, because it is the only work here that
  // moves the moment it is read. The statuses the group puts `last` (a
  // person's "not now") follow everything else.
  const isLast = (p: Placed) => p.place.value !== null && p.place.group.last.includes(p.place.value);
  const waits = (p: Placed) => p.place.needsYou || num(p.row, 'pendingBuildRunId') !== null;
  const deferred = rows.filter(isLast);
  const live = rows.filter(p => !isLast(p));
  const waiting = live.filter(waits);
  const queued = live.filter(p => !waits(p));
  const rankable = queued.filter(p => readReasons(meta(p.row)).recorded);
  const rest = queued.filter(p => !readReasons(meta(p.row)).recorded);
  waiting.sort((a, b) => decideOrder(a.row, b.row, r => askedAt(r)?.getTime() ?? now.getTime()));
  rankable.sort((a, b) => (num(b.row, 'priority') ?? 0) - (num(a.row, 'priority') ?? 0) || time(a) - time(b));
  rest.sort((a, b) => time(a) - time(b));
  // The first few decisions lead. The rest are staged: after the ranked
  // queue, muted, each saying how many decisions stand ahead of it.
  const deciding = waiting.slice(0, decideShown);
  const staged = waiting.slice(decideShown);
  return [
    ...deciding.map(p => ({ ...p, lane, rank: null })),
    ...rankable.map((p, i) => ({ ...p, lane, rank: i + 1 })),
    ...staged.map((p, i) => ({ ...p, lane, rank: null, staged: true, ahead: deciding.length + i })),
    ...rest.map(p => ({ ...p, lane, rank: null })),
    // Not now, by a person's decision: last, unranked, and back at the top when the date passes.
    ...deferred.sort((a, b) => time(a) - time(b)).map(p => ({ ...p, lane, rank: null })),
  ];
}

/**
 * A row's Now line, as the `live` field format draws it.
 * @param live - The row's live run, or null.
 * @param now - The clock.
 */
function rowNow(live: LiveRun | null, now: Date): RowNow {
  return { line: nowLine(live, now), live: live !== null, href: live?.runHref ?? null };
}

/**
 * The Work page's rows: the queue, in the lanes the status groups name, each
 * row carrying its own sentences and each lane carrying what it could not draw.
 *
 * Pure, so the mapping can be argued with in a test rather than in a browser.
 * Rows are copied, never mutated, and every kept row carries the same set of
 * figures for the whole queue (`meta.nextCount` and friends) so the page's
 * top line counts what EXISTS rather than what fitted.
 * @param rows - Every request row, unfiltered.
 * @param options - Clock, lane caps and the status model, for tests and for tuning.
 */
export function deriveWorkQueue(rows: PageRow[], options: WorkQueueOptions = {}): PageRow[] {
  const now = options.now ?? new Date();
  const model = options.statuses ?? NO_STATUS;
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

  // Where each row stands is its status — read once, never inferred.
  const placed: Placed[] = rows.map((r) => {
    const place = placeOf(model, meta(r));
    const card = buildCards.get(Number(r.id));
    // A Build card up is the row's decision: its line names the card.
    const row = card && place.group.role === 'proposed' ? { ...r, meta: { ...r.meta, pendingBuildRunId: card.runId, pendingBuildAt: card.at?.toISOString() } } : r;
    return { row, place };
  });

  const kept = placed.filter(({ row, place }) => {
    // Probes are history, not management information; the archive was decided against.
    if (isProbeRow(row) || place.group.role === 'archived') {
      return false;
    }
    if (place.group.role !== 'done') {
      return true;
    }
    const when = finishedAt(row);
    return when !== null && now.getTime() - when.getTime() <= withinMs;
  });

  // The lanes, in the order the type declares its groups.
  const lanes = model.groups.filter(g => g.role !== 'archived');
  const byLane = new Map<string, Placed[]>(lanes.map(g => [g.key, [] as Placed[]]));
  for (const p of kept) {
    byLane.get(p.place.group.key)?.push(p);
  }
  const ofRole = (role: WorkLane) => lanes.filter(g => g.role === role).flatMap(g => byLane.get(g.key) ?? []);

  const proposedRows = ofRole('proposed');
  const progressRows = ofRole('progress');
  const waits = (p: Placed) => p.place.needsYou || num(p.row, 'pendingBuildRunId') !== null;
  const waitingRows = proposedRows.filter(waits);
  const queuedRows = proposedRows.filter(p => !waits(p));
  const figures = {
    progressCount: progressRows.length,
    proposedCount: proposedRows.length,
    doneCount: ofRole('done').length,
    blockedCount: progressRows.filter(p => isBlocked(p.row, p.place)).length,
    waitingCount: waitingRows.length,
    decidingCount: Math.min(waitingRows.length, decideShown),
    stagedCount: Math.max(0, waitingRows.length - decideShown),
    urgentCount: kept.filter(p => flagsOf(p.row, p.place).includes('urgent')).length,
    unreasonedCount: queuedRows.filter(p => !readReasons(meta(p.row)).recorded).length,
    waitingMinutes: waitingRows.reduce((a, p) => a + (num(p.row, 'decisionCost') ?? 0), 0),
  };

  const out: PageRow[] = [];
  lanes.forEach((group, laneIndex) => {
    const lane = group.role as WorkLane;
    const ordered = orderLane(lane, byLane.get(group.key) ?? [], now, decideShown);
    const cap = lane === 'proposed' ? proposedShown : lane === 'done' ? doneShown : ordered.length;
    const shown = ordered.slice(0, cap);
    const note = laneNote(lane, {
      total: ordered.length,
      shown: shown.length,
      ranked: ordered.filter(o => o.rank !== null).length,
      queued: ordered.filter(o => !waits(o)).length,
      noVisual: ordered.filter(o => visualGap(o.row, lane) !== null).length,
      minutes: figures.waitingMinutes,
      blocked: figures.blockedCount,
      deciding: lane === 'proposed' ? figures.decidingCount : 0,
      staged: lane === 'proposed' ? figures.stagedCount : 0,
    });
    for (const [i, { row, place, rank, staged, ahead }] of shown.entries()) {
      const flags = flagsOf(row, place);
      const { label: state, tone: stateTone } = workStateOf(place, { staged });
      const related = relatedOf(row);
      const blocker = isBlocked(row, place) ? blockerOf(row) : null;
      out.push({
        ...row,
        meta: {
          ...row.meta,
          ...figures,
          lane: group.label,
          laneKey: lane,
          // How many rows the lane holds, past its cap: the tab counts these.
          laneTotal: ordered.length,
          laneNote: note ?? undefined,
          order: laneIndex * 1000 + i,
          // The one line the row leads with: the outcome (what a person can
          // do afterwards), else the summary the record was filed with.
          problem: (str(row, 'outcome') ?? str(row, 'summary')) ?? undefined,
          rank: rank === null ? undefined : String(rank),
          state,
          stateTone,
          blocked: blocker ? true : undefined,
          blockerLine: blocker?.what,
          visualGap: visualGap(row, lane) ?? undefined,
          visual: visualArtifactId(row, lane) ?? undefined,
          kindIcon: kindIconOf(row),
          acceptanceLine: acceptanceLine(row, lane, related) ?? undefined,
          contractGap: contractGap(row, lane, related) ?? undefined,
          // Why it is worth doing is the proposal's argument; once it is
          // building or done the row says what is happening, not why.
          whyLine: lane === 'proposed' ? (whyLine(row) ?? undefined) : undefined,
          workLine: workLine(row, place, now, { staged, ahead }) ?? undefined,
          // What is running for it right now — "Waiting for a worker · queued
          // 3 min", "Writing the plan · 1 min" — or "Nothing running".
          now: lane === 'progress' && options.live ? rowNow(options.live.get(Number(row.id)) ?? null, now) : undefined,
          // Whose move it is: the status says so (`x-needs-you`), or an obstacle is written down.
          needsYou: (lane === 'proposed' ? waits({ row, place }) : needsPerson(row, place)) || undefined,
          costLine: costLine(row, lane) ?? undefined,
          flags: flags.length > 0 ? flags : undefined,
        },
      });
    }
  });
  return out;
}
