/**
 * THE LIVE CHECK, the decisions (pure). The browser, the records and the
 * artifacts are `services/factory/liveCheck.ts`; the tool is `check_live`.
 *
 * Chris, 2026-10-01, after release #280: the check a product's deploy ran
 * replayed QA's pre-merge flows on production, waited for the mock build's
 * records, and reached 0 of 6 states, while the release still read healthy
 * and the request shipped. "You do it. Make it work. Make it run from Vocion
 * where possible." So:
 *
 *   - VOCION RUNS IT. A release linked to what it shipped wakes QA, which
 *     writes the live flow from the acceptance criteria and the live app (not
 *     the mock flow) and runs it with `check_live`, signed in as the product's
 *     QA account, in the browser where agents' tools run.
 *   - IT PREPARES ITS OWN STATE. A flow has a phase: `setup` makes what the
 *     check needs on production as the QA account (upload a record, open its
 *     link once as a visitor), `check` shoots each acceptance line, `cleanup`
 *     removes what setup made, and always runs. Values carry between flows
 *     (`remember`, `{{name}}`).
 *   - IT SAYS WHAT IT SAW. Seen, partly seen, or "Live check could not reach
 *     the change: <reason>" — on the release and on each feature. An HTTP 200
 *     never stands in for it.
 *
 * Core names no product, page or flow: the flows are QA's, written per
 * feature and kept on the request (`liveCheck.flows`); the product's own
 * notes on how to prepare state are its environment's `liveSetup`.
 */

import { z } from 'zod';

/** The role a live shot carries on the release, beside QA's pre-merge `qa-screenshot`. */
export const LIVE_ROLE = 'live-screenshot';

/** The phases of a live check, in the order they run. Cleanup runs whatever happened before it. */
export const LIVE_PHASES = ['setup', 'check', 'cleanup'] as const;
export type LivePhase = typeof LIVE_PHASES[number];

/**
 * The step vocabulary — the runner's (`packages/runner/contract/schema.json`),
 * one contract both sides hold to (`liveCheck.test.ts` reads the runner's
 * list and compares).
 */
export const LIVE_STEP_VERBS = ['click', 'fill', 'wait_for', 'shoot', 'upload', 'offline', 'goto', 'remember', 'pause'] as const;

/** The viewports a flow may name — the runner's. */
export const LIVE_VIEWPORTS = ['desktop', 'phone'] as const;

/** At most this many flows, steps per flow, and flow-viewport runs in one check, and this long for all of it. */
export const LIVE_LIMITS = { flows: 12, steps: 16, runs: 24, seconds: 480 } as const;

/**
 * The value a check and a cleanup read the page setup ended on by: `{{setupPage}}`, the full
 * address the last setup flow that finished stood on. Anything setup `remember`ed carries too.
 */
export const SETUP_PAGE_VAR = 'setupPage';

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
export const LIVE_REASON_KINDS = ['sign_in_failed', 'setup_failed', 'page_not_found', 'not_visible', 'app_error', 'could_not_run'] as const;
export type LiveReasonKind = typeof LIVE_REASON_KINDS[number];

/** One reason, typed: its kind, the flow and step it stopped at, and the check's own words. */
export type LiveReason = {
  kind: LiveReasonKind;
  /** The flow it stopped in. */
  flow?: string | null;
  /** The step it stopped at: 1-based, its verb and what it named. */
  step?: { n: number; verb: string; target: string } | null;
  /** The page, for a page that was not there. */
  path?: string | null;
  /** The check's own words, kept whole for whoever fixes it. */
  detail: string;
};

/** A step failure as the runner reports it (`shootFlow`'s `stepFailures`). */
export type RunnerStepFailure = { index: number; verb: string; target: string; error: string };

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
    default:
      return verb;
  }
}

/**
 * A step that failed, typed by where it ran: in setup it is the test data
 * that could not be made; in a check, a page that would not open is a page not
 * there, and anything else is the change not visible.
 * @param phase - The flow's phase.
 * @param flow - The flow's name.
 * @param f - The runner's step failure.
 * @param detail - The check's own words for it.
 */
export function stepReason(phase: LivePhase, flow: string, f: RunnerStepFailure, detail: string): LiveReason {
  const step = { n: f.index + 1, verb: f.verb, target: String(f.target ?? '') };
  if (phase !== 'check') {
    return { kind: 'setup_failed', flow, step, detail };
  }
  return { kind: f.verb === 'goto' ? 'page_not_found' : 'not_visible', flow, step, ...(f.verb === 'goto' ? { path: step.target } : {}), detail };
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
    case 'setup_failed':
      return `QA could not set up the test data it needed${at ? `: it stopped at ${at}` : r.flow ? ` ("${r.flow}")` : ''}`;
    case 'page_not_found':
      return `The page QA opened was not there on the live product${r.path ? ` (${r.path})` : ''}`;
    case 'not_visible':
      return `QA reached the page, but the change was not visible${r.step?.verb === 'wait_for' && r.step.target ? `: it waited for ${quoteTarget(r.step.target)} and it never appeared` : at ? `: it stopped at ${at}` : ''}`;
    case 'app_error':
      return 'The page showed an error instead of the change';
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
    step: step && Number.isInteger(step.n) && typeof step.verb === 'string' ? { n: Number(step.n), verb: step.verb, target: String(step.target ?? '') } : null,
    path: typeof r.path === 'string' ? r.path : null,
    detail: r.detail,
  };
}

const stepSchema = z.record(z.string(), z.unknown()).superRefine((step, ctx) => {
  const keys = Object.keys(step);
  if (keys.length !== 1 || !(LIVE_STEP_VERBS as readonly string[]).includes(keys[0]!)) {
    ctx.addIssue({ code: 'custom', message: `a step names exactly one of ${LIVE_STEP_VERBS.join(', ')}; got ${keys.join(', ') || 'nothing'}` });
  }
});

export const LiveFlowSchema = z.object({
  name: z.string().trim().min(1).max(60),
  phase: z.enum(LIVE_PHASES).default('check'),
  /** The feature a check flow proves; omitted when the release shipped one. */
  request_id: z.number().int().positive().optional(),
  /** The acceptance line a check flow's shots prove, in the request's words. */
  criterion: z.string().trim().max(300).optional(),
  /** Run signed in as the product's QA account (default), or as a visitor with no session. */
  signed_in: z.boolean().default(true),
  /** The environment surface it runs on (`web` …); the one with the QA sign-in when omitted. */
  surface: z.string().trim().max(40).optional(),
  /** A path on the environment, an address on it, or `{{name}}` an earlier flow remembered. */
  path: z.string().trim().min(1).max(2000),
  viewports: z.array(z.enum(LIVE_VIEWPORTS)).min(1).max(2).default(['desktop']),
  steps: z.array(stepSchema).max(LIVE_LIMITS.steps).default([]),
});
export type LiveFlow = z.infer<typeof LiveFlowSchema>;

/**
 * The flows in the order they run: setup, check, cleanup, each phase in the
 * order written.
 * @param flows - The flows as given.
 */
export function orderedFlows<T extends { phase: LivePhase }>(flows: readonly T[]): T[] {
  return LIVE_PHASES.flatMap(p => flows.filter(f => f.phase === p));
}

/** One shot as the runner's `shootFlow` returns it. */
export type RunnerShot = { file: string; label: string; at: string; errorState?: boolean; shortOf?: string; text?: string };

/**
 * True when a path is a sign-in page — the runner's own test (`isSignInPath`).
 * @param pathname
 */
export function isSignInPath(pathname: string): boolean {
  return /sign-?in|login/.test(pathname);
}

/**
 * Reached or not, for one shot of one flow on production, with the reason
 * when not: a step that failed, a page that bounced to sign-in, a page that
 * shows an app error.
 * @param flowPath - The flow's own path (a flow written for the sign-in page may land there).
 * @param shot - The shot.
 */
export function shotStatus(flowPath: string, shot: RunnerShot): { status: 'reached' | 'not_reached'; reason?: string; kind?: LiveReasonKind } {
  if (shot.shortOf) {
    return { status: 'not_reached', reason: shot.shortOf, kind: 'not_visible' };
  }
  const at = String(shot.at || '').split(/[?#]/)[0] ?? '';
  if (at && isSignInPath(at) && !isSignInPath(flowPath)) {
    return { status: 'not_reached', reason: `production sent the page to sign-in (${at})`, kind: 'sign_in_failed' };
  }
  if (shot.errorState) {
    return { status: 'not_reached', reason: 'the page shows an app error', kind: 'app_error' };
  }
  return { status: 'reached' };
}

/**
 * The shots worth keeping from one check run: every `shoot`, plus the final
 * picture when the flow shot nothing of its own or a step failed (it shows
 * where the page got).
 * @param flowPath - The flow's path.
 * @param result - What `shootFlow` returned.
 * @param result.shots - Its shots.
 * @param result.stepFailures - The steps that failed.
 */
export function keptShots(flowPath: string, result: { shots: RunnerShot[]; stepFailures: unknown[] }): Array<{ shot: RunnerShot; status: 'reached' | 'not_reached'; reason?: string; kind?: LiveReasonKind }> {
  const failed = result.stepFailures.length > 0;
  const labeled = result.shots.some(s => s.label);
  return result.shots.filter(s => s.label || failed || !labeled).map(shot => ({ shot, ...shotStatus(flowPath, shot) }));
}

/** One state of a check flow on production, as the release keeps it (`liveEvidence`). */
export type LiveRow = {
  requestId: number | null;
  flow: string;
  criterion: string | null;
  viewport: string;
  artifactId: number | null;
  status: 'reached' | 'not_reached';
  reason?: string;
  /** The reason, typed where it happened. */
  why?: LiveReason;
  url: string | null;
  /** The shot's own label, when the flow named it. */
  label?: string;
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
 * @param rows - The check flows' states.
 * @param problems - What stopped a flow from running at all (setup, sign-in, the browser).
 */
export function liveVerdict(rows: readonly LiveRow[], problems: readonly (string | LiveReason)[] = []): LiveVerdict {
  const total = rows.length;
  const reached = rows.filter(r => r.status === 'reached').length;
  const miss = rows.find(r => r.status === 'not_reached');
  if (total > 0 && reached === total) {
    return { state: 'seen', line: `Seen live: ${reached} of ${plural(total, 'state')} reached`, reason: null, why: null, reached, total };
  }
  // Typed where it happened, said as a sentence; a reason only in words (recorded before it was
  // typed) is said in its own words, as it was.
  const first: string | LiveReason = problems[0] ?? miss?.why ?? miss?.reason ?? (total === 0 ? 'no check flow was run' : 'no state was reached');
  const why = typeof first === 'string' ? null : { ...first, detail: first.detail.slice(0, 400) };
  const reason = (why?.detail ?? (first as string)).slice(0, 400);
  if (reached === 0) {
    return { state: 'not_seen', line: notSeenLine(why ?? reason), reason, why, reached, total };
  }
  return { state: 'partial', line: `Partly seen live: ${reached} of ${plural(total, 'state')} reached. Not reached: ${why ? liveReasonSentence(why) : reason}`, reason, why, reached, total };
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

/** Where a feature stands on the live product, on its request (`liveCheck`). */
export type RequestLiveMark = {
  state: LiveState;
  line: string;
  releaseId: number;
  checkedAt: string;
  attempt: number;
  /** The flows that checked it — the feature's live QA flow, reused and amended next time. */
  flows: LiveFlow[];
  /** Why it was not seen, typed; its `detail` is the check's own words. */
  why?: LiveReason | null;
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
 *   `check_live` spends an attempt too, so a seat that never checks cannot loop.
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
