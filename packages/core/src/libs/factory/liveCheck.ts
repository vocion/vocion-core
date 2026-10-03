/**
 * THE LIVE CHECK, the decisions (pure). The browser session is
 * `services/factory/liveBrowser.ts`, the records `services/factory/liveCheck.ts`;
 * the tools are the `browser_*` tools and `record_live_check`.
 *
 * Chris, 2026-10-01, after release #280: the check a product's deploy ran
 * replayed QA's pre-merge flows on production, waited for the mock build's
 * records, and reached 0 of 6 states, while the release still read healthy
 * and the request shipped. So Vocion runs it: a release linked to what it
 * shipped wakes QA, which looks at the live product signed in as its QA
 * account and records what it saw, line by line, on the release and each
 * feature. An HTTP 200 never stands in for it.
 *
 * THE STRUCTURE IS ON THE EVIDENCE, NOT THE STEPS (Chris, 2026-10-03, FE-402
 * line 6): a step language made QA write `click: "Save"` for "a blank name is
 * not saved"; Save was correctly disabled, the click waited 15 s, and a
 * correct feature read broken. QA now drives a browser by the page's
 * accessibility snapshot (it sees `button "Save" [disabled]`) and records
 * each acceptance line as seen, not seen or not observable, citing what it
 * captured in this run's session. Core names no product, page or flow.
 */

import { z } from 'zod';
import { featureProof } from '@/libs/workspace/featureProof';

/** The role a live shot carries on the release, beside QA's pre-merge `qa-screenshot`. */
export const LIVE_ROLE = 'live-screenshot';

/** Attempts a release gets: the first, and the one retry carrying what the first learned. */
export const LIVE_ATTEMPTS = 2;

/**
 * WHY A LIVE CHECK DID NOT SEE THE CHANGE, typed where it happened (run 2,
 * 2026-10-01): release REL-302 read "setup "Setup upload doc" (desktop) did not
 * finish: step 2 (upload "input[type=file]") failed: locator.setInputFiles:
 * Timeout 15000ms exceeded". A person reads what could not be checked and why,
 * in a sentence ({@link liveReasonSentence}), from the kind the check set at
 * the place it failed, never read back out of the message; the message itself
 * is the `detail`, one click away.
 */
export const LIVE_REASON_KINDS = ['sign_in_failed', 'visitor_sent_to_sign_in', 'setup_failed', 'page_not_found', 'not_visible', 'app_error', 'could_not_run', 'not_checked', 'not_seen'] as const;
export type LiveReasonKind = typeof LIVE_REASON_KINDS[number];

/** One reason, typed: its kind, the flow and step it stopped at, and the check's own words. */
export type LiveReason = {
  kind: LiveReasonKind;
  /** The flow it stopped in. */
  flow?: string | null;
  /** The step it stopped at: 1-based, its verb, what it named, and the runner's own words for why. */
  step?: { n: number; verb: string; target: string; error?: string } | null;
  /** The page, for a page that was not there. */
  path?: string | null;
  /** The check's own words, kept whole for whoever fixes it. */
  detail: string;
};

const quoteTarget = (t: string) => (t ? `"${t.slice(0, 60)}"` : '');

/**
 * What a step was doing, in words.
 * @param verb - The step's verb.
 * @param target - What it named.
 */
function stepDoing(verb: string, target: string): string {
  switch (verb) {
    case 'upload':
      return 'uploading a test file';
    case 'click':
      return `clicking ${quoteTarget(target) || 'a control'}`;
    case 'fill':
      return `filling ${quoteTarget(target) || 'a field'}`;
    case 'wait_for':
      return `waiting for ${quoteTarget(target) || 'the page'}`;
    case 'goto':
      return `opening ${quoteTarget(target) || 'a page'}`;
    case 'remember':
      return 'reading a value off the page';
    case 'expect_response':
      return `checking the response to ${quoteTarget(target) || 'a request'}`;
    default:
      return verb;
  }
}

/**
 * What could not be checked and why, in one sentence a person reads.
 * @param r - The reason.
 */
export function liveReasonSentence(r: LiveReason): string {
  const at = r.step ? `${stepDoing(r.step.verb, r.step.target)} (step ${r.step.n}${r.flow ? ` of "${r.flow}"` : ''})` : null;
  switch (r.kind) {
    case 'sign_in_failed':
      return 'QA could not sign in to the live product as its QA account';
    case 'visitor_sent_to_sign_in':
      return `${r.flow ? `"${r.flow}"` : 'A flow'} ran signed out, and the page it opened${r.path ? ` (${r.path})` : ''} needs sign-in`;
    case 'setup_failed':
      return `QA could not set up the test data it needed${at ? `: it stopped at ${at}` : r.flow ? ` ("${r.flow}")` : ''}`;
    case 'page_not_found':
      return `The page QA opened was not there on the live product${r.path ? ` (${r.path})` : ''}`;
    case 'not_visible':
      if (r.step?.verb === 'expect_response') {
        return `QA reached the page, but the API did not answer as promised${r.step.error ? `: ${r.step.error.replace(/[.\s]+$/, '')}` : at ? `: it stopped at ${at}` : ''}`;
      }
      return `QA reached the page, but the change was not visible${r.step?.verb === 'wait_for' && r.step.target ? `: it waited for ${quoteTarget(r.step.target)} and it never appeared` : at ? `: it stopped at ${at}` : ''}`;
    case 'app_error':
      return 'The page showed an error instead of the change';
    case 'not_checked':
      return r.detail.replace(/[.\s]+$/, '');
    case 'not_seen':
      return `QA looked on the live product and did not see it: ${r.detail.replace(/[.\s]+$/, '')}`;
    default:
      return `The live check could not run: ${r.detail.replace(/[.\s]+$/, '')}`;
  }
}

/**
 * A reason read back from a record, or null.
 * @param v - What was stored.
 */
export function readLiveReason(v: unknown): LiveReason | null {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  if (!r || !(LIVE_REASON_KINDS as readonly string[]).includes(String(r.kind)) || typeof r.detail !== 'string') {
    return null;
  }
  const step = r.step && typeof r.step === 'object' ? r.step as Record<string, unknown> : null;
  return {
    kind: r.kind as LiveReasonKind,
    flow: typeof r.flow === 'string' ? r.flow : null,
    step: step && Number.isInteger(step.n) && typeof step.verb === 'string' ? { n: Number(step.n), verb: step.verb, target: String(step.target ?? ''), ...(typeof step.error === 'string' ? { error: step.error } : {}) } : null,
    path: typeof r.path === 'string' ? r.path : null,
    detail: r.detail,
  };
}

/**
 * ONE ACCEPTANCE LINE, BY ITS NUMBER (2026-10-02, FE-314 / REL-347): QA wrote a check for "A visitor
 * can open the shared link and download the file", a line FE-314 never had, and the release read
 * "Not seen live" while its one live-observable promise (signed-in GET /v1/documents returns 200)
 * held. The check records a line of the request by its position; the words come from the
 * record, so a check can only prove what the feature promised.
 */
export type AcceptanceLine = {
  /** 1-based, as QA cites it. */
  n: number;
  text: string;
  /** QA's pre-merge verdict proved it, with evidence (`featureProof`). */
  provenBeforeMerge: boolean;
  /** QA's verdict left it to the live check (`live`): only the running product can show it. Present only when true. */
  leftToLive?: true;
};

/** The words the line list puts on a line QA's verdict left to the live check. */
export const LEFT_TO_LIVE = 'QA left this to the live check';

/**
 * A request's acceptance lines, numbered, read the one way every surface reads them
 * (`libs/workspace/featureProof.ts`) — and, when the attempts the release shipped are given, every
 * other line their verdict left to the live check (FE-392, 2026-10-03: a plan-risk line QA marked
 * `live` was never put in front of the live check, so the feature page read it "Unverified" after a
 * check that "saw 4 of 4"). Those follow the acceptance lines, numbered on from them, so the check
 * must record each like any other line.
 * @param meta - The request's metadata.
 * @param shipped - The release's attempts at this request (`tasks`) and which of them it shipped.
 * @param shipped.tasks - The attempts.
 * @param shipped.shippedTaskIds - The ones the release carried.
 */
export function acceptanceLines(meta: Record<string, unknown>, shipped: { tasks: Array<{ id: number; meta: Record<string, unknown> }>; shippedTaskIds?: Iterable<number> } = { tasks: [] }): AcceptanceLine[] {
  const proof = featureProof({ request: { id: 0, meta }, tasks: shipped.tasks, shippedTaskIds: shipped.shippedTaskIds });
  const line = (c: (typeof proof.acceptance)[number], n: number): AcceptanceLine => ({
    n,
    text: c.statement,
    // A line the live check itself passed is not one QA proved before the merge.
    provenBeforeMerge: c.state === 'passed' && c.from !== 'live',
    ...(c.leftToLive ? { leftToLive: true as const } : {}),
  });
  const own = proof.acceptance.map((c, i) => line(c, i + 1));
  const known = new Set(own.map(l => l.text));
  const left = proof.risks.filter(c => c.leftToLive && !known.has(c.statement));
  return [...own, ...left.map((c, i) => line(c, own.length + i + 1))];
}

/** A line QA says the live product cannot show: proven before merge, or not proven at all. */
export type BeforeMergeLine = { requestId: number; line: number; text: string; why: string; proven: boolean };

/** What QA found of one line: seen on the live product, looked for and not seen, or not something production can show. */
export const LIVE_RESULTS = ['seen', 'not_seen', 'not_observable'] as const;
export type LiveResult = typeof LIVE_RESULTS[number];

/** At most this many evidence ids on one line. */
export const MAX_EVIDENCE_PER_LINE = 12;

/** One acceptance line as QA records it (`record_live_check`): the result, what in this run's browser session shows it, and why. */
export const RecordedLineSchema = z.object({
  request_id: z.number().int().positive().optional(),
  line: z.number().int().positive(),
  result: z.enum(LIVE_RESULTS),
  evidence: z.array(z.string().trim().min(1).max(40)).max(MAX_EVIDENCE_PER_LINE).default([]),
  why: z.string().trim().min(1).max(400),
});
export type RecordedLine = z.infer<typeof RecordedLineSchema>;

/** One recorded line, tied to the record's words. */
export type ResolvedLine = { requestId: number; line: AcceptanceLine; result: LiveResult; evidence: string[]; why: string };

/** The words a person reads for a line production cannot show that QA proved before the merge. */
export const PROVEN_BEFORE_MERGE = 'proven before merge by QA\'s verdict';

/**
 * The lines of one request, numbered, as the refusal and the tool's answer list them.
 * @param requestId - The request.
 * @param lines - Its lines.
 */
export function linesList(requestId: number, lines: readonly AcceptanceLine[]): string {
  return lines.length === 0
    ? `request #${requestId} has no acceptance lines`
    : `request #${requestId}'s acceptance lines:\n${lines.map(l => `  ${l.n}. ${l.text}${l.provenBeforeMerge ? ` (${PROVEN_BEFORE_MERGE})` : l.leftToLive ? ` (${LEFT_TO_LIVE})` : ''}`).join('\n')}`;
}

export type ResolvedRecording
  = | { ok: true; lines: ResolvedLine[]; beforeMerge: BeforeMergeLine[] }
    | { ok: false; refusal: string };

/**
 * Tie each recorded line to the acceptance line it names, and refuse what does not hold: a line the
 * record does not have, a line recorded twice, a seen or not-seen line that cites no evidence, and a
 * recording that leaves a line of a shipped request unaccounted for (Walk 7, 2026-10-02: release
 * #363 read "1 of 6 states reached" because QA named one line and no other). Every refusal lists
 * the request's lines, numbered, so QA corrects itself in the same turn; nothing is written on one.
 * Whether the evidence ids came from this run's browser session is the service's to check.
 * @param recorded - What QA recorded.
 * @param linesByRequest - Each request the release shipped, and its lines.
 */
export function resolveRecordedLines(recorded: readonly RecordedLine[], linesByRequest: ReadonlyMap<number, AcceptanceLine[]>): ResolvedRecording {
  const shipped = [...linesByRequest.keys()];
  const only = shipped.length === 1 ? shipped[0]! : null;
  const all = () => shipped.map(id => linesList(id, linesByRequest.get(id) ?? [])).join('\n');
  const fix = 'Record each line by its number (line: n, with request_id when the release shipped more than one request): seen or not_seen citing what you captured, or not_observable with why production cannot show it.';
  const out: ResolvedLine[] = [];
  for (const r of recorded) {
    const what = `line ${r.line}`;
    const id = r.request_id ?? only;
    if (id === null) {
      return { ok: false, refusal: `${what} names no request_id, and this release shipped ${shipped.length === 0 ? 'no request' : `requests ${shipped.map(n => `#${n}`).join(', ')}`}.\n${all()}\n${fix}` };
    }
    const lines = linesByRequest.get(id);
    if (!lines) {
      return { ok: false, refusal: `${what} names request #${id}, which this release did not ship (it shipped ${shipped.map(n => `#${n}`).join(', ') || 'none'}).\n${all()}\n${fix}` };
    }
    const line = lines.find(l => l.n === r.line);
    if (!line) {
      return { ok: false, refusal: `${what} of request #${id} is not there: it ${lines.length === 0 ? 'has no acceptance lines' : `has ${lines.length}`}.\n${linesList(id, lines)}\n${fix}` };
    }
    if (out.some(o => o.requestId === id && o.line.n === line.n)) {
      return { ok: false, refusal: `${what} of request #${id} is recorded twice: record each line once, with everything that shows it in its evidence.\n${linesList(id, lines)}` };
    }
    const evidence = [...new Set(r.evidence)];
    if (r.result !== 'not_observable' && evidence.length === 0) {
      return { ok: false, refusal: `${what} of request #${id} is recorded ${r.result} and cites no evidence. Cite what you captured in this run's browser that shows it (a snapshot, screenshot, response or action id), or record it not_observable with why production cannot show it.` };
    }
    out.push({ requestId: id, line, result: r.result, evidence, why: r.why });
  }
  const missing = shipped.flatMap(id => (linesByRequest.get(id) ?? []).filter(l => !out.some(o => o.requestId === id && o.line.n === l.n)).map(line => ({ id, line })));
  if (missing.length > 0) {
    const byRequest = shipped.filter(id => missing.some(m => m.id === id));
    const list = byRequest.map(id => `request #${id}: ${missing.filter(m => m.id === id).map(m => `line ${m.line.n} (${m.line.text.slice(0, 160)})`).join('; ')}`).join('\n');
    return { ok: false, refusal: `${missing.length === 1 ? 'An acceptance line is' : `${missing.length} acceptance lines are`} not recorded:\n${list}\nEvery line is recorded: seen or not_seen with the evidence you captured, or not_observable with why production cannot show it.\n${byRequest.map(id => linesList(id, linesByRequest.get(id) ?? [])).join('\n')}` };
  }
  const beforeMerge: BeforeMergeLine[] = out
    .filter(o => o.result === 'not_observable')
    .map(o => ({ requestId: o.requestId, line: o.line.n, text: o.line.text, why: o.why.slice(0, 300), proven: o.line.provenBeforeMerge }));
  return { ok: true, lines: out, beforeMerge };
}

/**
 * The row a line no check reached on production stands as: one production cannot show that QA's
 * verdict did not prove before merge (or, in a record written before every line had to be
 * recorded, one QA never named). Either way it is unproven, said why.
 * @param requestId - The request.
 * @param line - The line.
 * @param cannotShow - QA said production cannot show it (and the verdict did not prove it).
 */
export function uncheckedRow(requestId: number, line: AcceptanceLine, cannotShow: boolean): LiveRow {
  const detail = cannotShow
    ? `Line ${line.n} of request #${requestId} cannot be seen on the live product, and QA's verdict did not prove it before merge`
    : `QA did not check line ${line.n} of request #${requestId} on the live product, and did not say production cannot show it`;
  return { requestId, flow: `line ${line.n}`, line: line.n, criterion: line.text, viewport: 'desktop', artifactId: null, status: 'not_reached', reason: detail, why: { kind: 'not_checked', detail }, url: null };
}

/**
 * True when a path is a sign-in page — the runner's own test (`isSignInPath`).
 * @param pathname - The page's path.
 */
export function isSignInPath(pathname: string): boolean {
  return /sign-?in|login/.test(pathname);
}

/** One acceptance line as the live check found it on production, as the release keeps it (`liveEvidence`). `flow` names the line (`line 3`) on records written since the browser tools. */
export type LiveRow = {
  requestId: number | null;
  flow: string;
  /** The acceptance line it proves, by its number in the request. */
  line?: number;
  criterion: string | null;
  viewport: string;
  artifactId: number | null;
  status: 'reached' | 'not_reached';
  reason?: string;
  /** The reason, typed where it happened. */
  why?: LiveReason;
  url: string | null;
  /** The caption of the screenshot it cites. */
  label?: string;
  /** The responses it cites, as a person reads them: "GET /v1/documents returned 200 signed in". */
  proved?: string[];
  /** The evidence ids it cites, from the run's browser session. */
  evidence?: string[];
};

export type LiveState = 'seen' | 'partial' | 'not_seen';

/** What a live check concluded, said once: on the release, the feature and the tool's answer. */
export type LiveVerdict = {
  state: LiveState;
  line: string;
  /** The check's own words for why, for whoever fixes the flows. */
  reason: string | null;
  /** Why, typed, for a person: the line says it in a sentence, and `detail` is `reason`. */
  why: LiveReason | null;
  reached: number;
  total: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Seen, partly seen, or not seen — from the check rows and what stopped the
 * check. Nothing reached is a failure said with its reason, never a pass.
 * @param rows - The lines' states.
 * @param problems - What stopped the check from looking at all (sign-in, the browser, no environment).
 * @param beforeMerge - The lines production cannot show, and whether QA's verdict proved them.
 */
export function liveVerdict(rows: readonly LiveRow[], problems: readonly (string | LiveReason)[] = [], beforeMerge: readonly BeforeMergeLine[] = []): LiveVerdict {
  const total = rows.length;
  const reached = rows.filter(r => r.status === 'reached').length;
  const miss = rows.find(r => r.status === 'not_reached');
  // Lines production cannot show, that QA's verdict proved before the merge: said, never counted as
  // unreached (a line it did not prove stands as an unreached row instead, `uncheckedRow`).
  const proven = beforeMerge.filter(b => b.proven).length;
  const tail = proven > 0 ? `. ${plural(proven, 'more line')} ${PROVEN_BEFORE_MERGE}` : '';
  const proved = [...new Set(rows.filter(r => r.status === 'reached').flatMap(r => r.proved ?? []))];
  if (total > 0 && reached === total) {
    return { state: 'seen', line: `Seen live: ${reached} of ${plural(total, 'state')} reached${proved.length > 0 ? ` (${proved.slice(0, 3).join('; ')})` : ''}${tail}`, reason: null, why: null, reached, total };
  }
  if (total === 0 && proven > 0 && problems.length === 0) {
    return { state: 'seen', line: `Nothing to see on the live product: ${plural(proven, 'line')} ${PROVEN_BEFORE_MERGE}`, reason: null, why: null, reached, total };
  }
  // Typed where it happened, said as a sentence; a reason only in words (recorded before it was
  // typed) is said in its own words, as it was.
  const first: string | LiveReason = problems[0] ?? miss?.why ?? miss?.reason ?? (total === 0 ? 'no line was checked on the live product' : 'no state was reached');
  const why = typeof first === 'string' ? null : { ...first, detail: first.detail.slice(0, 400) };
  const reason = (why?.detail ?? (first as string)).slice(0, 400);
  if (reached === 0) {
    return { state: 'not_seen', line: `${notSeenLine(why ?? reason)}${tail}`, reason, why, reached, total };
  }
  return { state: 'partial', line: `Partly seen live: ${reached} of ${plural(total, 'state')} reached. Not reached: ${why ? liveReasonSentence(why) : reason}${tail}`, reason, why, reached, total };
}

/**
 * A check that saw nothing, for a person: what could not be checked, then
 * why, in the check's own words (2026-10-01, release #280 led with "/documents/[id]
 * names a placeholder no record on production resolved to").
 * @param reason - Why: typed, said as a sentence; or the check's own words, for a reason recorded before it was typed.
 */
export function notSeenLine(reason: string | LiveReason): string {
  if (typeof reason !== 'string') {
    return `Not seen live: ${liveReasonSentence(reason).replace(/[.\s]+$/, '')}`;
  }
  return `Not seen live: QA could not reach the change on the live product. Why: ${reason.replace(/[.\s]+$/, '')}`;
}

/**
 * What happens next to a release the live check did not fully see, from how
 * many checks it has had: one more while an attempt is left, else nothing
 * by itself, said plainly with what a person can do.
 * @param attempts - Checks already written (`liveAttempts`), or null when unknown.
 * @param limit - Checks in all.
 */
export function liveNext(attempts: number | null, limit: number = LIVE_ATTEMPTS): string {
  return attempts !== null && attempts < limit
    ? 'Next: QA checks once more, carrying this reason.'
    : 'Next: nothing checks it again by itself. Check it by hand on the live product, or fix what stopped QA and the next release is checked.';
}

/**
 * The picture an announcement can lead with: the first reached shot of an
 * acceptance line, desktop first. Null when there is none.
 * @param rows - The check rows.
 */
export function pickAnnouncementImage(rows: readonly LiveRow[]): number | null {
  const candidates = rows.filter(r => r.status === 'reached' && r.artifactId !== null && r.criterion);
  return (candidates.find(r => r.viewport === 'desktop') ?? candidates[0])?.artifactId ?? null;
}

/** What the live check saw of one line, kept on the request's `liveCheck.lines`. */
export type LiveLineMark = { line: number | null; text: string; result: 'reached' | 'not_reached' | 'not_checked'; url: string | null; reason: string | null };

/**
 * What the check saw of each line it accounted for, by the line's words: reached when every state
 * of it was, not checked when nothing checked it on production, else not reached with the first
 * reason. `featureProof` reads it for a line QA left to the live check.
 * @param rows - One feature's check rows.
 */
export function lineResults(rows: readonly LiveRow[]): LiveLineMark[] {
  const byText = new Map<string, LiveRow[]>();
  for (const r of rows) {
    if (r.criterion) {
      byText.set(r.criterion, [...(byText.get(r.criterion) ?? []), r]);
    }
  }
  return [...byText.entries()].map(([text, own]) => {
    const miss = own.find(r => r.status !== 'reached');
    const result = !miss ? 'reached' : own.every(r => r.why?.kind === 'not_checked') ? 'not_checked' : 'not_reached';
    return {
      line: own[0]!.line ?? null,
      text: text.slice(0, 300),
      result,
      url: (own.find(r => r.status === 'reached' && r.url) ?? own.find(r => r.url))?.url ?? null,
      reason: miss ? (miss.why?.detail ?? miss.reason ?? null)?.slice(0, 300) ?? null : null,
    };
  });
}

/** Where a feature stands on the live product, on its request (`liveCheck`). */
export type RequestLiveMark = {
  state: LiveState;
  line: string;
  releaseId: number;
  checkedAt: string;
  attempt: number;
  /** Why it was not seen, typed; its `detail` is the check's own words. */
  why?: LiveReason | null;
  /** The lines production cannot show, and whether QA's verdict proved them before the merge. */
  beforeMerge?: BeforeMergeLine[];
  /** What it saw of each line, by the line's words (`lineResults`). */
  lines?: LiveLineMark[];
};

type Meta = Record<string, unknown>;

function bag(v: unknown): Meta {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Meta : {};
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * The live check a release carries, read once for every surface: what the
 * check wrote (`liveState`, `liveSummary`), or for a release checked before
 * `liveState` existed, its rows (`liveEvidence`). Null when none ran.
 * @param meta - The release's metadata.
 */
export function readReleaseLive(meta: Meta): { state: LiveState; line: string; checkedAt: string | null; detail: string | null } | null {
  const state = meta.liveState === 'seen' || meta.liveState === 'partial' || meta.liveState === 'not_seen' ? meta.liveState : null;
  const summary = text(meta.liveSummary);
  const attempts = Number.isInteger(meta.liveAttempts) ? Number(meta.liveAttempts) : null;
  const next = (line: string) => `${line.replace(/[.\s]+$/, '')}. ${liveNext(attempts)}`;
  if (state) {
    if (state === 'seen') {
      return { state, line: summary ?? 'Seen live', checkedAt: text(meta.liveCheckedAt), detail: null };
    }
    const reason = text(meta.liveReason);
    const why = readLiveReason(meta.liveWhy);
    const line = state === 'not_seen' && (why ?? reason) ? notSeenLine(why ?? reason!) : summary ?? notSeenLine(reason ?? 'no reason was recorded');
    return { state, line: next(line), checkedAt: text(meta.liveCheckedAt), detail: why?.detail ?? reason };
  }
  const rows = Array.isArray(meta.liveEvidence) ? meta.liveEvidence.map(bag) : [];
  if (rows.length === 0) {
    return null;
  }
  const verdict = liveVerdict(rows.map(r => ({
    requestId: null,
    flow: text(r.flow) ?? 'flow',
    criterion: text(r.criterion),
    viewport: text(r.viewport) ?? 'desktop',
    artifactId: null,
    status: r.status === 'reached' ? 'reached' : 'not_reached',
    ...(text(r.reason) ? { reason: text(r.reason)! } : {}),
    url: null,
  })), Array.isArray(meta.liveProblems) ? meta.liveProblems.filter((p): p is string => typeof p === 'string') : []);
  return { state: verdict.state, line: verdict.state === 'seen' ? verdict.line : next(verdict.line), checkedAt: text(meta.liveCheckedAt), detail: verdict.reason };
}

/**
 * Where one feature stands on the live product, from its request's
 * `liveCheck`. Null when no live check has looked at it.
 * @param meta - The request's metadata.
 */
export function readRequestLive(meta: Meta): { state: LiveState; line: string; checkedAt: string | null; releaseId: number | null; detail: string | null } | null {
  const m = bag(meta.liveCheck);
  const state = m.state === 'seen' || m.state === 'partial' || m.state === 'not_seen' ? m.state : null;
  if (!state) {
    return null;
  }
  const releaseId = Number(m.releaseId);
  const why = state === 'seen' ? null : readLiveReason(m.why);
  return { state, line: text(m.line) ?? (state === 'seen' ? 'Seen live' : 'Not yet seen live'), checkedAt: text(m.checkedAt), releaseId: Number.isSafeInteger(releaseId) && releaseId > 0 ? releaseId : null, detail: why?.detail ?? null };
}

/** What the live-check fire's end decides: done, once more with the reason, or written down. */
export type LiveAfterRun
  = | { do: 'done'; why: string }
    | { do: 'retry'; attempt: number; reason: string }
    | { do: 'give-up'; reason: string };

/**
 * The QA fire for a release's live check ended: seen (done), tried once more
 * carrying why the first saw nothing, or — once the attempts are spent — the
 * reason written on the release and its features.
 * @param meta - The release's metadata, read after the fire.
 * @param fire - What the fire left.
 * @param fire.startedAt - When the fire started; a check written before it is an older one.
 * @param fire.reason - Why it saw nothing, when the fire knows (its error, the tool's last answer).
 * @param fire.attempt - Which fire this was (1, then 2 on the retry): a QA run that never called
 *   its required tool spends an attempt too, so a seat that never checks cannot loop.
 * @param attempts - Attempts in all.
 */
export function liveAfterRun(meta: Meta, fire: { startedAt: Date; reason: string | null; attempt?: number }, attempts: number = LIVE_ATTEMPTS): LiveAfterRun {
  const checkedAt = text(meta.liveCheckedAt);
  const fresh = checkedAt !== null && new Date(checkedAt).getTime() >= fire.startedAt.getTime() - 1000;
  const live = fresh ? readReleaseLive(meta) : null;
  if (live?.state === 'seen') {
    return { do: 'done', why: 'seen live' };
  }
  const spent = Math.max(Number.isInteger(meta.liveAttempts) ? Number(meta.liveAttempts) : 0, Number.isInteger(fire.attempt) ? Number(fire.attempt) : 1);
  const reason = (live ? text(meta.liveReason) ?? live.line : null) ?? fire.reason ?? 'the QA run ended without a live check';
  if (live?.state === 'partial' && spent >= attempts) {
    return { do: 'done', why: 'partly seen, and the attempts are spent' };
  }
  return spent < attempts ? { do: 'retry', attempt: spent + 1, reason } : { do: 'give-up', reason };
}
