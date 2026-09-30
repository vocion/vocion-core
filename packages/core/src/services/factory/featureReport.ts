/**
 * The feature report — one request's whole story, assembled in order.
 *
 * The records were always all there, and all linked: a `request` asked for
 * it, an `engineering_task` contracted it, `worker_run` rows attempted it,
 * `ask` and `action_run` rows carry what a person decided, artifacts carry
 * the proof, a `release` carried it to people. What was missing was a
 * surface that put them in one column, in order, with the money and the
 * decisions on it. Chris, backlog #89: *"I want to be able to observe that
 * whole loop… like a full end to end feature report?"*
 *
 * This module is the assembly, and it is deliberately pure: plain records
 * in, a report out, no database and no clock of its own. Everything that
 * reads a table is in `featureReportData.ts`; everything that draws is in
 * `features/dashboard/factory/FeatureReportView.tsx`. The split is what lets
 * the honesty rules below be tested from fixtures rather than from a
 * seeded database.
 *
 * ## The honesty rules
 *
 * 1. **A stage that did not happen says so.** Every section renders. One
 *    with nothing in it carries a sentence naming what is absent — "No
 *    release carries this work" — because the absence is the finding. A
 *    section is never hidden to make the page look complete.
 * 2. **No stage is inferred from another.** A merged pull request does not
 *    make a run successful; a shipped release does not make a task
 *    accepted; a passing check does not stand in for QA evidence.
 * 3. **Contradictions are shown, not resolved.** A run that says `failed`
 *    whose pull request merged is a real defect we have — the worker's
 *    completion call can time out after the PR is open. The report shows
 *    both facts and flags the disagreement rather than picking a winner.
 *
 * ## The plan stage
 *
 * The plan sits between triage and the contract, because a plan reviewed after
 * the run is a record and not a gate. What it reads: `architecture_plan`
 * records pointing at the request, and the `plan` block each task recorded. The
 * rule that says whether one was needed is `planRule.ts`, the same rule the
 * worker refuses on in `factory/worker/plan.mjs`. A plan that was offered and
 * declined renders as `plan skipped: <reason>`, never as a blank, because a
 * blank is indistinguishable from a step nobody took.
 *
 * ## QA evidence, the shape a worker must post
 *
 * Nothing fills this slot yet; the section exists so the gap is visible.
 * Evidence is an ordinary core **artifact** (principle 7 — map onto the
 * nouns we have), attached to the `engineering_task` it proves:
 *
 * ```
 * recordType: 'object'            // business objects are `object` records
 * recordId:   '<engineering_task id>'
 * recordRole: 'qa-screenshot' | 'qa-video' | 'qa-report'
 * kind:       'file' | 'link' | 'markdown'
 * title:      'Checkout, empty cart'      // the caption on the gallery
 * spec:       { url, filename, contentType, bytes }   // kind: file
 *             { href, title, description }            // kind: link
 *             { md }                                  // kind: markdown
 * ```
 *
 * `recordRole` rather than `kind` carries the QA marker because
 * `artifact.kind` is a closed core enum (`libs/cards/specs.ts`) and a worker
 * cannot add `qa-screenshot` to it. A worker that writes the marker into
 * `spec.kind` instead is still read — {@link qaEvidenceRole} takes either —
 * so the convention can tighten later without dropping evidence already
 * posted.
 */

import type { BlockerFacts } from './blocker';
import type { PlanDecision, PlanRecord } from './planRule';
import type { LiveMissionRunInput, LiveRun, RecordStatus, StatusMove, StatusYou } from '@/libs/factory/liveStatus';
import type { PullSignals, WorkFacts } from '@/libs/factory/workFacts';
import type { ProofCriterion } from '@/libs/workspace/featureProof';
import type { RecordLinker } from '@/libs/workspace/recordHref';
import { MERGE_ACTION_ID } from '@/libs/actions/mergeAction';
import { pickLive, prLabel, youOf } from '@/libs/factory/liveStatus';
import { ciFact, mergeRuleFact, nextForAttempt, NO_PULL_SIGNALS, normalisePullUrl, pullFact, REQUEST_STAGE_LINE, requestStageOf, verdictFact } from '@/libs/factory/workFacts';
import { liveTopic } from '@/libs/live/topics';
import { featureProof, risksLine, shippedTaskIdsOf } from '@/libs/workspace/featureProof';
import { genericRecordLinker } from '@/libs/workspace/recordHref';
import { inboxHref } from '@/services/inbox/inboxRef';
import { blockerResolution } from './blocker';
import { planRecordFromTask, planRequirementForTask } from './planRule';
import { bare, classifyFailure, nextAfter, readRecovery, recoveryStage } from './recovery';

/** A business object as the report reads it — request, task or release. */
export type ReportObject = {
  id: number;
  title: string;
  status: string | null;
  createdAt: Date | null;
  meta: Record<string, unknown>;
};

/**
 * A task's stage. The record's own status column is the source of truth —
 * the worker writes it, record_verdict writes it, the rollups read it
 * (`rollups.ts` → `qualifying`). The metadata copy is read only for a record
 * whose column still holds the generic lifecycle value.
 * @param t - The task.
 */
export function taskStatus(t: ReportObject): string {
  const column = String(t.status ?? '');
  return column && !['active', 'candidate', 'new'].includes(column) ? column : String(t.meta.status ?? column);
}

/** A `worker_run` row, narrowed to what the report reads. */
export type ReportWorkerRun = {
  id: number;
  agentSlug: string;
  kind: string;
  status: string;
  attempt: number | null;
  cents: number | null;
  model: string | null;
  summary: string | null;
  error: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  heartbeatAt?: Date | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: Record<string, unknown>;
  /** The run's own failures (`check:<name>`, `contract`, …), when it failed. */
  failures?: Array<{ scope?: string; message?: string }>;
};

/** An `ask` row — a ruling or recommendation a person decided. */
export type ReportAsk = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  decision: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionCost: number | null;
  contextUrl: string | null;
  createdAt: Date;
  objectRefs: Array<{ type: string; id: string }>;
};

/** An `action_run` row — a hand-off proposed to a person. */
export type ReportActionRun = {
  id: number;
  actionId: string;
  status: string;
  input: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: Date | null;
  /** `false` = a person decided, `true` = the trust ladder released it, `null` = nobody has. */
  approvedByAgent: boolean | null;
  note: string | null;
  createdAt: Date;
  executedAt: Date | null;
};

/** An artifact attached to a record — QA evidence when its role says so. */
export type ReportArtifact = {
  id: number;
  kind: string;
  title: string;
  recordType: string | null;
  recordId: string | null;
  recordRole: string | null;
  spec: Record<string, unknown>;
  url: string | null;
  createdAt: Date;
};

export type FeatureReportInput = {
  request: ReportObject;
  tasks: ReportObject[];
  /** `architecture_plan` records pointing at this request. Absent on work that was never planned. */
  plans: ReportObject[];
  workerRuns: ReportWorkerRun[];
  asks: ReportAsk[];
  actionRuns: ReportActionRun[];
  releases: ReportObject[];
  artifacts: ReportArtifact[];
  /** The clock, passed in so "elapsed" is testable. */
  now: Date;
  /** Display names for the user ids the records carry (an approver), so no raw id reaches the page. */
  people?: Record<string, string>;
  /** Where a record opens in this workspace (`libs/workspace/recordHref.ts`); absent, the generic view. */
  link?: RecordLinker;
  /**
   * Agent runs working on this record right now or lately — the planning run
   * an automation fire started for it, a reviewer's run over its change
   * (`featureReportData.loadMissionRuns`). Absent, no agent run is known.
   */
  missionRuns?: LiveMissionRunInput[];
  /**
   * What GitHub and the merge action recorded about each pull request the
   * tasks carry — merged, closed, CI (`services/factory/pullSignals.ts`).
   * Absent, nothing is known, and nothing is said as a "no".
   */
  pulls?: ReadonlyMap<string, PullSignals>;
  /**
   * Whether QA's approve merges the current attempt on its own — the trust
   * ladder's answer for its class (`pullSignals.mergeRunsItself`). Absent,
   * not established.
   */
  mergeRule?: { runsItself: boolean | null; riskClass: string | null };
};

/** One labelled figure in a section. `value` null renders as "not recorded". */
export type ReportFact = {
  label: string;
  value: string | null;
  format?: 'text' | 'money' | 'mono' | 'quote';
  href?: string;
};

/** A checked-or-not line: a required check, an acceptance criterion. */
export type ReportCheck = { name: string; passed: boolean | null; detail: string | null };

/** A run, an approval or a pull request as a block inside a section. */
export type ReportEntry = {
  key: string;
  title: string;
  status: string | null;
  tone: Tone;
  at: Date | null;
  cents: number | null;
  facts: ReportFact[];
  /** The plan as a person approves it: numbered, in order, one line each. */
  steps?: string[];
  /** Facts that belong behind the entry's own disclosure — the reasoning, not the decision. */
  detailFacts?: ReportFact[];
  checks: ReportCheck[];
  /** Flags shown on the entry itself, e.g. the failed-run-merged-PR contradiction. */
  flags: string[];
};

/** A QA artifact as the gallery reads it. */
export type ReportEvidence = {
  id: number;
  /** The artifact's kind, so a gallery can draw a picture as a picture and a document as a document. */
  kind: string;
  /** A picture to draw, when this evidence IS one. */
  imageUrl: string | null;
  /** The document itself, when the evidence is one — a mockup nobody can see is not evidence. */
  body: string | null;
  role: string;
  title: string;
  caption: string | null;
  url: string | null;
  at: Date;
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export const REPORT_SECTION_KEYS = ['ask', 'triage', 'visuals', 'today', 'plan', 'contract', 'approvals', 'runs', 'change', 'qa', 'release', 'result', 'money'] as const;
export type ReportSectionKey = typeof REPORT_SECTION_KEYS[number];

/**
 * Which half of the page a section belongs to.
 *
 * `story` is the work as a person follows it — the plan, what it will take to
 * be done, what was built, the evidence, what remains, what it cost. `detail`
 * is the machinery that produced it: the original ask, the triage figures, the
 * per-task contracts, the approval records. Both are true and both are needed;
 * only one of them is what somebody opened the page to read. Chris,
 * 2026-09-22: *"Nothing is lost. It's simply put at the correct level."*
 */
export type ReportSectionGroup = 'story' | 'detail';

export type ReportSection = {
  key: ReportSectionKey;
  /** Lists that belong behind the section's own disclosure, not in front of the decision. */
  detailLists: Array<{ label: string; items: string[] }>;
  /** Where it sits: in the story, or behind Technical details. */
  group: ReportSectionGroup;
  title: string;
  /** Null when the stage happened. Otherwise the plain sentence saying it did not. */
  absence: string | null;
  facts: ReportFact[];
  lists: Array<{ label: string; items: string[] }>;
  entries: ReportEntry[];
  checks: ReportCheck[];
  evidence: ReportEvidence[];
  flags: string[];
};

export type TimelineEntry = {
  key: string;
  /** Null when the record carries no time for it; those sort last and say so. */
  at: Date | null;
  kind: 'asked' | 'triaged' | 'plan' | 'decision' | 'contract' | 'run' | 'change' | 'qa' | 'release';
  title: string;
  detail: string | null;
  cents: number | null;
  tone: Tone;
  href: string | null;
  /** A run still going: what it is doing, its last line, its log tail (backlog 007). */
  live?: LiveBuild;
};

/** What a person watching a build sees while it runs. */
export type LiveBuild = {
  step: string | null;
  lastLine: string | null;
  log: string[];
  /** Seconds since the run was claimed, or null when the row does not say. */
  sinceSec: number | null;
  /** Seconds since the last heartbeat — a build that went quiet says so. */
  quietSec: number | null;
};

const LIVE_STATUSES = new Set(['running', 'claimed', 'paused']);

/**
 * The live view of a run that is still going, or null once it is not.
 * @param run - The worker run.
 * @param now - The clock.
 */
export function liveOf(run: ReportWorkerRun & { heartbeatAt?: Date | null }, now: Date = new Date()): LiveBuild | null {
  if (!LIVE_STATUSES.has(run.status)) {
    return null;
  }
  const p = run.progress as { step?: unknown; log?: unknown };
  const log = Array.isArray(p.log) ? p.log.filter((l): l is string => typeof l === 'string').slice(-8) : [];
  const since = run.claimedAt ?? run.createdAt;
  return {
    step: typeof p.step === 'string' && p.step.trim() ? p.step.trim() : null,
    lastLine: log.at(-1) ?? null,
    log,
    sinceSec: since ? Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000)) : null,
    quietSec: run.heartbeatAt ? Math.max(0, Math.round((now.getTime() - run.heartbeatAt.getTime()) / 1000)) : null,
  };
}

export type FeatureReportSummary = {
  askedAt: Date | null;
  shippedAt: Date | null;
  /** "12d 4h", or null when nothing is dated. */
  elapsed: string | null;
  /** True while nothing has shipped — the elapsed figure is "so far". */
  elapsedOpen: boolean;
  totalCents: number;
  /** How many times a person decided — `null` when no decision record is linked at all, which is not the same as nobody deciding. */
  humanDecisions: number | null;
  /** How many worker runs ran — `null` when none is linked to work that plainly ran. */
  attempts: number | null;
};

export type MoneyLine = {
  estimateCents: number | null;
  actualCents: number | null;
  varianceCents: number | null;
  /** Variance as a percentage of the estimate, rounded; null when there is no estimate to divide by. */
  variancePct: number | null;
  /** What was actually charged across the worker runs, whatever the task rollup says. */
  runCents: number;
  estimateSource: string;
  actualSource: string;
};

/**
 * One thing that happened to this feature that a person may want to open:
 * a conversation it was discussed in, a mission run that worked on it, or an
 * engineering run building it. Opened in the preview pane (a sheet on a phone).
 */
export type ReportActivity = {
  kind: 'conversation' | 'mission_run' | 'worker_run';
  id: number;
  title: string;
  at: Date;
  status: string | null;
  detail: string | null;
};

export type FeatureReport = {
  /** Every conversation and run tied to this feature, newest first (loaded beside the report). */
  activity?: ReportActivity[];
  requestId: number;
  /** The plan a build would carry: the newest one not rejected or superseded. Null when there is none. */
  planId: number | null;
  /**
   * Whether "Build it" is the next move: nothing shipped and no task alive —
   * never built, or every attempt failed, was abandoned or rejected.
   */
  canBuild: boolean;
  title: string;
  summary: FeatureReportSummary;
  money: MoneyLine;
  /** Where the work is and what it wants from a person — the top of the page. */
  state: ReportState;
  /**
   * THE NOW LINE: the one run carrying this work right now — queued, building,
   * writing the plan, reviewing — or null when nothing is running
   * (`libs/factory/liveStatus.ts`). The page re-reads while it is set.
   */
  live: LiveRun | null;
  /** THE YOU LINE: nothing needs you, or the one move that does. */
  you: StatusYou;
  /** Which decision this page is for right now, and therefore what leads it. */
  phase: ReportPhase;
  /** The four steps and where this has got to, in place of four empty sections. */
  lifecycle: LifecycleStep[];
  /** What this work is FOR, in the requester's own words. Null when nobody wrote one. */
  goal: string | null;
  /** The ask as it arrived, kept as evidence under the outcome the page leads with. */
  asked: string;
  /** Product, size, spend and age — the line that says WHICH work this is, above the fold. */
  context: string[];
  /** The change as the person who will use it would tell it. Markdown. */
  story: string | null;
  /** The contract: what has to be true before this is done. */
  acceptance: ReportAcceptance;
  sections: ReportSection[];
  /** Oldest first — a person reads top to bottom and the newest entry is last. */
  timeline: TimelineEntry[];
  /** Disagreements between records, stated rather than resolved. */
  contradictions: string[];
  /** The picture that leads the page — the first mock or after-shot with an image — or null. */
  hero: ReportEvidence | null;
  /** The one or two sentences under the introduction: what is known, what is not, and the one move. */
  status: ReportStatus;
  /** Disagreements between records, each said as what is known, whether it blocks, and the move. */
  notices: ReportNotice[];
  /** The plan as the page shows it: scope, a plain status, who approved it and when. */
  planSummary: ReportPlanSummary;
  /** Build and the change in one: the latest attempt, the earlier ones counted, and the delivery ladder. */
  implementation: ReportImplementation;
  /** Live with evidence, release not verified, or not released — and where to open it. */
  release: ReportReleaseSummary;
  /** A few events worth a glance, newest first. The whole timeline is one tap away. */
  activityPreview: Array<TimelineEntry & { ago: string }>;
  /** Whether Dismiss is still an honest second way out: only before any work has started. */
  canDismiss: boolean;
  /** What this should change for people, as the record says it. The introduction carries it. */
  expectedBenefit: string | null;
  /** Where the running product shows this work, when the record says. */
  surfaceUrl: string | null;
  /**
   * THE FACTS, EACH ON ITS OWN FIELD (backlog 044): QA's verdict, the merge,
   * CI, the merge rule and the request's stage, for the current attempt — what
   * an agent reads so a finished run is never said as a shipped feature.
   */
  facts: WorkFacts;
  /**
   * What this page is made of, as live-stream topics (backlog 050): the
   * record, its tasks, plans and releases, the runs, cards, asks, artifacts
   * and agent runs it draws. A page or line showing this report follows
   * them and re-reads on a change, instead of polling.
   */
  follow?: string[];
};

/**
 * THE DRAWERS. Everything the page summarises opens in full in the preview
 * pane (`feature_section:<requestId>.<key>`) — linkable, closed by Back, one
 * pane, never stacked. `criterion-<n>` is one acceptance criterion (0-based).
 */
export type FeatureDrawerKey = 'status' | 'plan' | 'implementation' | 'acceptance' | 'release' | 'activity' | 'work' | 'cost' | 'details' | `criterion-${number}`;

/** The one move the page offers, and how it is made. */
export type ReportAction
  = | {
    kind: 'build';
    label: string;
    /**
     * The pending `factory.dispatch_task` card this press approves, when one
     * is already waiting — so the page approves THAT card (with its Undo)
     * rather than filing a second one beside it.
     */
    runId?: number;
  }
  | { kind: 'drawer'; label: string; drawer: FeatureDrawerKey }
  | { kind: 'link'; label: string; href: string };

/**
 * WHERE THIS IS, IN A SENTENCE (Chris, 2026-09-28). Derived from the same
 * records as `state`; the sentence says what is known and names what is not
 * established, and never turns "no evidence" into a "no".
 */
export type ReportStatus = {
  /** `bad` only for a confirmed obstacle. */
  tone: Tone;
  headline: string;
  sentence: string;
  action: ReportAction | null;
  /** A second, quieter way out: Dismiss before work starts, Build again beside a review. */
  secondary: ReportAction | { kind: 'dismiss'; label: string } | null;
  /**
   * THE NEXT LINE: what happens after the current step, said from the stage
   * this is in — "The build starts when the plan is approved". Null when
   * nothing follows on its own.
   */
  next?: string | null;
  /**
   * The run carrying it right now, when one is live — drawn under the state
   * as ONE row that opens the run (Chris, 2026-09-29: "is that 'current
   * state'?"). The row is the move, so a state with one names no other.
   */
  activeRun?: { attempt: ReportAttempt; of: number } | null;
};

/**
 * A record problem, in the reader's terms. `blocking` is reserved for a
 * confirmed obstacle; a disagreement between records is an `inconsistency`
 * and is drawn quietly, with the raw evidence one tap away.
 */
export type ReportNotice = {
  key: string;
  severity: 'blocking' | 'inconsistency';
  /** What is known, in one sentence. */
  known: string;
  /** Whether it blocks, and what cannot be established because of it. */
  blocks: string;
  action: { label: string; drawer: FeatureDrawerKey };
  /** The disagreement exactly as recorded. */
  evidence: string;
};

export type PlanStatus = 'Draft' | 'Awaiting approval' | 'Approved' | 'Superseded' | 'Rejected';

export type ReportPlanSummary = {
  planId: number | null;
  status: PlanStatus | null;
  /** What the plan changes, in a sentence. */
  scope: string | null;
  /** A person's name, or "Approver unavailable" — never a raw user id. */
  approver: string | null;
  approvedAt: Date | null;
  /** The first risk the plan names, when it names one. */
  risk: string | null;
  steps: number;
  /** Whether a plan was needed, in plain words — for the drawer. */
  requirement: string | null;
  /** Why the plan rule required one, one clause per trigger, in the rule's words. */
  reasons: string[];
  /** The approach, and why this one, as the plan says it. */
  approach: string | null;
  /** What changes, one line per component. */
  components: string[];
  /** Every risk the plan names. */
  risks: string[];
  /** The plan record's page, as the workspace links it (`libs/workspace/recordHref.ts`). */
  href: string | null;
  /** Said when there is no plan to summarise. */
  absence: string | null;
};

/** One engineering attempt as a row. */
export type ReportAttempt = {
  runId: number;
  /** "Completed", "Failed", "Running", "Refused — not executed". */
  outcome: string;
  tone: Tone;
  at: Date;
  cents: number | null;
  /** False for a run the worker refused or that never started: it is not executed work. */
  executed: boolean;
  /** "2 days ago", against the report's own clock. */
  ago: string;
  /** The first line of what went wrong, when something did. */
  why: string | null;
  /** The pull request this attempt opened, when it opened one. */
  prUrl: string | null;
  /** What its checks reported. Empty when it reported none. */
  checks: ReportCheck[];
  /** Which attempt it was, oldest first: 1 of N. */
  n: number;
  /** Still queued, running or paused — the run to watch. */
  live: boolean;
};

/** A delivery fact that is true, false or not established — never inferred from a neighbour. */
export type LadderStep = { key: 'run' | 'checks' | 'merged' | 'acceptance' | 'released'; label: string; value: string; state: 'yes' | 'no' | 'unknown' };

export type ReportImplementation = {
  latest: ReportAttempt | null;
  /** How many attempts came before the latest. */
  earlier: number;
  /** Every attempt, newest first. */
  attempts: ReportAttempt[];
  prUrl: string | null;
  merged: boolean;
  /** Run completed ≠ checks passed ≠ merged ≠ acceptance verified ≠ released. */
  ladder: LadderStep[];
  /** What was spent, when anything was. */
  spentCents: number | null;
  /** "Not estimated", or the estimate and its variance when a real estimate exists. */
  costLine: string;
  absence: string | null;
};

export type ReportReleaseSummary = {
  state: 'live' | 'unverified' | 'not_released';
  label: 'Live' | 'Release not verified' | 'Not released';
  sentence: string;
  at: Date | null;
  /** Where to open it: the running product, else the release record. */
  href: string | null;
};

// ---------------------------------------------------------------------------
// Reading values off free-form metadata
// ---------------------------------------------------------------------------

/**
 * A string off a metadata bag, trimmed, or null. Empty is null: a field set
 * to "" was not answered.
 * @param source - Any metadata object.
 * @param key - The key to read.
 */
function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = source?.[key];
  if (typeof v === 'string') {
    return v.trim() || null;
  }
  return typeof v === 'number' ? String(v) : null;
}

/**
 * An integer off a metadata bag, or null.
 * @param source - Any metadata object.
 * @param key - The key to read.
 */
function num(source: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = source?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * A list of strings off a metadata bag. Never null — an absent list is an
 * empty one, and the section says so in words.
 * @param source - Any metadata object.
 * @param key - The key to read.
 */
function list(source: Record<string, unknown> | null | undefined, key: string): string[] {
  const v = source?.[key];
  return Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).filter(s => s !== '') : [];
}

/**
 * A date off a metadata bag or a column. Strings and numbers parse; an
 * unparseable value is null rather than an Invalid Date.
 * @param v - The raw value.
 */
/**
 * The obstacle the record names, if any — what, who clears it, the one move.
 * Only this reads as Blocked; "no task running" is a wait, not a block.
 * @param meta - The request's metadata.
 */
export function blockerOf(meta: Record<string, unknown>): { what: string; owner: string | null; next: string | null } | null {
  const raw = meta.blocker;
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const b = raw as Record<string, unknown>;
  const text = (k: string) => (typeof b[k] === 'string' && (b[k] as string).trim() !== '' ? (b[k] as string).trim() : null);
  const what = text('what');
  return what === null ? null : { what, owner: text('owner'), next: text('next') };
}

/**
 * What the report's own records say about everything a blocker can name.
 * @param input - The report's inputs.
 */
function blockerFactsOf(input: FeatureReportInput): BlockerFacts {
  return {
    plans: input.plans.map(p => ({ id: p.id, status: p.meta.status, approvedAt: p.meta.approvedAt })),
    asks: input.asks.map(a => ({ id: a.id, status: a.status, decidedAt: a.decidedAt })),
    actions: input.actionRuns.map(r => ({ id: r.id, status: r.status, decidedAt: r.decidedAt, executedAt: r.executedAt })),
  };
}

export function asDate(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Cents as dollars. Same rendering as a `money` column on a list page, kept
 * here so the report does not depend on the page renderer.
 * @param cents - An integer number of cents.
 */
export function money(cents: number): string {
  const whole = Math.round(cents);
  return `${whole < 0 ? '-' : ''}$${(Math.abs(whole) / 100).toFixed(2)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A moment as a fixed UTC stamp — "14 Sep 2026, 09:32 UTC". UTC rather than
 * the reader's zone so two people comparing a report agree on the order, and
 * fixed rather than relative so a stamp printed in a PR stays true.
 * @param at - The moment, or null.
 */
export function formatStamp(at: Date | null): string {
  if (!at) {
    return 'time not recorded';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

/**
 * A span as the coarsest two units that are not zero — "12d 4h", "3h 20m",
 * "45s". Negative spans read as "0s"; a clock that runs backwards is not a
 * duration to report.
 * @param ms - Milliseconds.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0s';
  }
  const units: Array<[string, number]> = [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000], ['s', 1000]];
  const parts: string[] = [];
  let rest = Math.round(ms / 1000) * 1000;
  for (const [suffix, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 || parts.length > 0) {
      if (n > 0) {
        parts.push(`${n}${suffix}`);
      }
      if (parts.length === 2) {
        break;
      }
    }
    rest -= n * size;
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}

// ---------------------------------------------------------------------------
// QA evidence
// ---------------------------------------------------------------------------

/** The roles a worker may post QA evidence under. See the module docstring. */
export const QA_EVIDENCE_ROLES = ['qa-screenshot', 'qa-video', 'qa-report'] as const;
export type QaEvidenceRole = typeof QA_EVIDENCE_ROLES[number];

/**
 * The QA role an artifact claims, or null when it is not QA evidence.
 * `recordRole` is the convention; `spec.kind` is read too so a worker that
 * wrote the marker into the spec is not silently dropped.
 * @param artifact - The artifact.
 */
export function qaEvidenceRole(artifact: Pick<ReportArtifact, 'recordRole' | 'spec'>): QaEvidenceRole | null {
  const claimed = artifact.recordRole ?? str(artifact.spec, 'kind');
  return (QA_EVIDENCE_ROLES as readonly string[]).includes(claimed ?? '') ? (claimed as QaEvidenceRole) : null;
}

/**
 * Where the evidence actually is — the artifact's own URL, or the URL its
 * spec carries for a file or link artifact.
 * @param artifact - The artifact.
 */
function evidenceUrl(artifact: ReportArtifact): string | null {
  return artifact.url ?? str(artifact.spec, 'url') ?? str(artifact.spec, 'href') ?? null;
}

// ---------------------------------------------------------------------------
// Worker runs
// ---------------------------------------------------------------------------

const TERMINAL_BAD = new Set(['failed', 'cancelled', 'lost']);

/** What a worker says when it will not take a contract — the plan gate, most often. */
const REFUSAL = /\brefus|\bdeclined\b|requires? an? (?:approved )?plan|plan (?:is )?required|no approved plan|without an approved plan/i;

/**
 * Did this run do any work? A run the worker refused, or one that ended
 * before anything claimed it, is an attempt on the record and NOT executed
 * work: it wrote nothing, so it cannot make a plan "late" or a history
 * "complete" (Chris, 2026-09-28: "A refused worker attempt is not executed
 * work").
 * @param run - The run.
 */
export function executedRun(run: ReportWorkerRun): boolean {
  if (!TERMINAL_BAD.has(run.status)) {
    return true;
  }
  if (run.claimedAt === null) {
    return false;
  }
  const flagged = run.progress.refused === true || (run.result ?? {}).refused === true;
  return !flagged && !REFUSAL.test(`${run.error ?? ''} ${run.summary ?? ''}`);
}

/**
 * A run that is still going — queued, claimed, running or paused.
 * @param run - The run.
 */
function runIsLive(run: ReportWorkerRun): boolean {
  return !TERMINAL_BAD.has(run.status) && run.status !== 'completed';
}

/**
 * The newest attempt's engineering run failed and nothing is waiting on QA or
 * a merge: the feature is stopped, and the next move is Build again.
 * @param input - The report's records.
 * @param input.tasks - The feature's engineering tasks.
 * @param input.workerRuns - Their engineering runs.
 */
function engineeringStopped(input: Pick<FeatureReportInput, 'tasks' | 'workerRuns'>): boolean {
  const newestTask = [...input.tasks].sort((a, b) => b.id - a.id)[0];
  const newestRun = [...input.workerRuns].sort((a, b) => b.id - a.id)[0];
  return Boolean(newestTask && newestRun && TERMINAL_BAD.has(newestRun.status) && ['rejected', 'dispatched', 'running'].includes(taskStatus(newestTask)));
}

/** The recommended outcome, as a verb a person reads on the decision card. */
const OUTCOME_VERBS: Record<string, string> = { build: 'build it', answer: 'answer it', decline: 'decline it', merge: 'merge it into another feature', defer: 'defer it' };

/**
 * An age in a person's words — "2 days", "5 hours", "just now" — for the
 * context line. `formatDuration`'s "1d 21h" is a stopwatch reading; nobody
 * decides differently at 1d 21h than at 2 days (Chris, 2026-09-24).
 * @param ms - How long ago.
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) {
    return 'just now';
  }
  const days = Math.round(ms / 86_400_000);
  if (ms >= 36 * 3_600_000) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(ms / 3_600_000);
  if (hours >= 1) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return `${Math.round(ms / 60_000)} min ago`;
}

/**
 * What a run reported about the change. A completed run writes `pr_url`,
 * `branch`, `commit_sha`, `files_changed` and `checks` onto `result`; a
 * failed one has no result, and its kept work is on the last heartbeat's
 * `progress` as `keptBranch` / `prUrl` / `continue`. Same keys
 * `services/agents/tools/runs.ts` reads, because the same worker writes them.
 * @param run - The run.
 */
export function runChange(run: ReportWorkerRun): {
  prUrl: string | null;
  branch: string | null;
  commitSha: string | null;
  filesChanged: string[];
  checks: ReportCheck[];
  keptBranch: string | null;
  continueNote: string | null;
} {
  const result = run.result ?? {};
  const kept = str(run.progress, 'keptBranch');
  const rawChecks = Array.isArray(result.checks) ? (result.checks as unknown[]) : [];
  return {
    prUrl: str(result, 'pr_url') ?? str(run.progress, 'prUrl'),
    branch: str(result, 'branch') ?? kept,
    commitSha: str(result, 'commit_sha'),
    filesChanged: Array.isArray(result.files_changed) ? (result.files_changed as unknown[]).map(String) : [],
    checks: rawChecks.map((c) => {
      if (!c || typeof c !== 'object') {
        return { name: String(c), passed: null, detail: null };
      }
      const check = c as Record<string, unknown>;
      const passed = typeof check.passed === 'boolean' ? check.passed : str(check, 'status') === 'passed' ? true : str(check, 'status') === 'failed' ? false : null;
      const exit = num(check, 'exitCode') ?? num(check, 'exit_code');
      return {
        name: str(check, 'name') ?? str(check, 'check') ?? 'check',
        passed,
        detail: exit === null ? null : `exit ${exit}`,
      };
    }),
    keptBranch: kept,
    continueNote: str(run.progress, 'continue'),
  };
}

/**
 * How long a run took, from when it was claimed to when it completed. Null
 * while a run is still open or was never claimed — an unfinished run has no
 * duration, and guessing one from `createdAt` would charge it for the time
 * it spent queued.
 * @param run - The run.
 */
function runDuration(run: ReportWorkerRun): number | null {
  const start = run.claimedAt;
  return start && run.completedAt ? run.completedAt.getTime() - start.getTime() : null;
}

/**
 * The run's own place on the timeline: when it ended, else when it was
 * picked up, else when it was queued.
 * @param run - The run.
 */
function runAt(run: ReportWorkerRun): Date {
  return run.completedAt ?? run.claimedAt ?? run.createdAt;
}

/**
 * A status as a pill tone. Nothing here decides anything — it only colours a
 * word the record already says.
 * @param status - The raw status.
 */
export function statusTone(status: string | null): Tone {
  switch (status) {
    case 'completed':
    case 'accepted':
    case 'approved':
    case 'done':
    case 'shipped':
      return 'ok';
    case 'failed':
    case 'rejected':
    case 'review_failed':
    case 'cancelled':
    case 'lost':
      return 'bad';
    case 'awaiting_review':
    case 'changes_requested':
    case 'paused':
    case 'open':
    case 'pending':
      return 'warn';
    case 'running':
    case 'dispatched':
    case 'queued':
    case 'ready':
      return 'info';
    default:
      return 'muted';
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * A section with everything empty — sections are built by filling one of
 * these, so a new field never has to be added in nine places.
 * @param key - The section key.
 * @param title - Its heading.
 */
/**
 * The sections that are machinery rather than story: the original ask, the
 * triage figures, the per-task contracts and the approval records. Useful,
 * traceable, and not what a person opened this page to read.
 */
const DETAIL_SECTIONS: ReadonlySet<string> = new Set(['ask', 'triage', 'contract', 'approvals']);

function blank(key: ReportSectionKey, title: string): ReportSection {
  return { key, group: DETAIL_SECTIONS.has(key) ? 'detail' : 'story', title, absence: null, facts: [], lists: [], detailLists: [], entries: [], checks: [], evidence: [], flags: [] };
}

/**
 * Who asked, as one line: their name, else their email, else their id on the
 * channel, else the plain fact that the record does not say.
 * @param askedBy - The request's `askedBy` object.
 */
function askerLabel(askedBy: Record<string, unknown> | null): string {
  if (!askedBy) {
    return 'not recorded';
  }
  return str(askedBy, 'name') ?? str(askedBy, 'email') ?? str(askedBy, 'externalId') ?? 'not recorded';
}

/**
 * The ask — the request in the asker's own words, with who asked, when and
 * through which door.
 * @param request - The request record.
 */
function askSection(request: ReportObject): ReportSection {
  const s = blank('ask', 'The ask');
  const meta = request.meta;
  const askedBy = (meta.askedBy && typeof meta.askedBy === 'object' ? meta.askedBy : null) as Record<string, unknown> | null;
  const body = str(meta, 'body');
  s.facts = [
    { label: 'In their words', value: body, format: 'quote' },
    { label: 'Asked by', value: askerLabel(askedBy) },
    { label: 'Channel', value: str(meta, 'channel') },
    { label: 'Asked', value: formatStamp(asDate(meta.askedAt) ?? request.createdAt) },
    { label: 'Product', value: str(meta, 'product'), format: 'mono' },
  ];
  if (!body) {
    s.flags.push('The feature carries no body — only its title, which is ours, not theirs.');
  }
  const evidence = (meta.evidence && typeof meta.evidence === 'object' ? meta.evidence : null) as Record<string, unknown> | null;
  const urls = [...list(evidence, 'urls'), ...(str(evidence, 'videoUrl') ? [str(evidence, 'videoUrl')!] : [])];
  if (urls.length > 0) {
    s.lists.push({ label: 'Evidence the asker attached', items: urls });
  }
  return s;
}

/**
 * Triage — what the factory decided this was, before it decided to build it.
 * @param request - The request record.
 */
function triageSection(request: ReportObject): ReportSection {
  const s = blank('triage', 'Triage');
  const meta = request.meta;
  const state = str(meta, 'state');
  if (!state || state === 'new') {
    s.absence = 'No one triaged this feature; it is still in `new`.';
    return s;
  }
  const outcome = str(meta, 'recommendedOutcome');
  s.facts = [
    { label: 'Kind', value: str(meta, 'kind') },
    { label: 'State', value: state },
    { label: 'Severity', value: str(meta, 'severity') },
    { label: 'Size', value: str(meta, 'sizeClass') },
    { label: 'Risk floor', value: str(meta, 'riskFloor') ?? str(meta, 'riskClass') },
    { label: 'Decision cost', value: num(meta, 'decisionCost') === null ? null : `${num(meta, 'decisionCost')} min of a person` },
    { label: 'Priority', value: num(meta, 'priority') === null ? null : String(num(meta, 'priority')) },
    { label: 'Theme', value: str(meta, 'theme'), format: 'mono' },
    { label: 'Ranked', value: asDate(meta.rankedAt) ? formatStamp(asDate(meta.rankedAt)) : null },
  ];
  // The twenty-percent verdict is the product manager's recommendation and
  // the reason it gave — the playbook the factory judges an idea against.
  s.facts.push(
    { label: 'Twenty-percent verdict', value: outcome === null ? null : `${outcome}${str(meta, 'recommendationState') ? ` · ${str(meta, 'recommendationState')}` : ''}` },
    { label: 'Why', value: str(meta, 'priorityReason') ?? str(meta, 'decisionReason'), format: 'quote' },
  );
  if (!outcome) {
    s.flags.push('The twenty-percent test was never run on this feature — no recommendation is on the record.');
  }
  return s;
}

/**
 * What the plan rule decided for this request, taken across its tasks. The
 * strongest answer wins: if any task crosses a boundary, the work crossed it.
 * Null when there is no task yet to read a rule off.
 * @param tasks - The tasks pointing at this request.
 */
export function planDecisionForRequest(tasks: ReportObject[]): PlanDecision | null {
  if (tasks.length === 0) {
    return null;
  }
  const repos = tasks
    .map(t => str(t.meta, 'repoSlug') ?? str(t.meta, 'repo'))
    .filter((r): r is string => r !== null);
  const context = { taskCount: tasks.length, repos };
  const decisions = tasks.map(t => planRequirementForTask(t.meta, context));
  return decisions.find(d => d.level === 'required')
    ?? decisions.find(d => d.level === 'offered')
    ?? decisions[0]
    ?? null;
}

/**
 * The rule's answer as one sentence a person can read without the rule in
 * front of them.
 * @param decision - What the rule decided.
 */
function planLevelSentence(decision: PlanDecision): string {
  // "required, on 3 triggers" was the rule's own vocabulary (Chris,
  // 2026-09-28: replace the jargon). A person reads the reason.
  if (decision.level === 'required') {
    const first = decision.triggers[0]?.why;
    // Each reason said, never "N reasons, listed below" with the list
    // somewhere else (Chris, 2026-09-28, on #126's plan).
    const whys = [...new Set(decision.triggers.map(t => t.why))];
    return whys.length > 1
      ? `Yes — ${whys.slice(0, -1).join('; ')}; and ${whys.at(-1)}`
      : first ? `Yes — ${first}` : 'Yes';
  }
  if (decision.level === 'offered') {
    return 'Optional — it can be skipped with a written reason';
  }
  return 'No';
}

/**
 * What one task recorded about the plan, always as a sentence. A task that
 * recorded nothing says so; a skip is always written out as "plan skipped:
 * <reason>", never left blank, because a blank is exactly the thing nobody can
 * read six weeks later.
 * @param plan - The task's plan block, or null when it carries none.
 */
export function planRecordLine(plan: PlanRecord | null): string {
  if (plan === null) {
    return 'no plan decision was recorded';
  }
  if (plan.skipped === true) {
    return `plan skipped: ${plan.skipReason ?? 'no reason was recorded'}`;
  }
  const names = plan.planId ?? plan.url;
  if (names === null || names === undefined) {
    return 'a plan block is on the task and it names no plan';
  }
  return `planned against ${names}, ${plan.approvedBy === null || plan.approvedBy === undefined ? 'approved by nobody on the record' : `approved by ${plan.approvedBy}`}`;
}

/**
 * The plan: the approach, and why this one, reviewed before the work ran.
 *
 * This stage is read from `architecture_plan` records and from what each task
 * recorded about its own plan. Nothing here is inferred from the other stages:
 * an approval on the request is not a plan approval, and a contract that got
 * written is not evidence that anybody designed anything.
 * @param plans - The plan records pointing at this request.
 * @param tasks - The tasks pointing at this request.
 * @param hasRuns - Whether any worker run exists, which changes what an absent plan means.
 */
/**
 * Does this look like a user id rather than a name? A raw id is a handle, not
 * a person (the plan's approver read "user_2x9…" on the page).
 * @param s - The recorded value.
 */
function looksLikeUserId(s: string): boolean {
  return /^(?:user|usr)_[\w-]+$/i.test(s)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)
    || /^\d+$/.test(s)
    || (/^[\w-]{20,}$/.test(s) && /\d/.test(s));
}

/**
 * A recorded person as a name: the directory's name for an id, the value
 * itself when it already reads as one, and null for a bare id nobody could
 * resolve — the caller says "Approver unavailable" rather than print it.
 * @param raw - What the record carries (`approvedBy`, `decidedBy`).
 * @param people - Id → display name, loaded beside the records.
 */
export function personName(raw: string | null, people: Record<string, string> = {}): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const known = people[raw];
  if (known) {
    return known;
  }
  const agent = /^agent:(.+)$/.exec(raw);
  if (agent) {
    return `an agent (${agent[1]})`;
  }
  return looksLikeUserId(raw) ? null : raw;
}

function planSection(plans: ReportObject[], tasks: ReportObject[], hasRuns: boolean, people: Record<string, string> = {}): ReportSection {
  const s = blank('plan', 'Plan');
  const decision = planDecisionForRequest(tasks);
  const recorded = tasks.map(task => ({ task, plan: planRecordFromTask(task.meta) }));
  const skips = recorded.filter(r => r.plan?.skipped === true);
  const carried = recorded.filter(r => r.plan !== null && r.plan.skipped !== true);

  // THE PLAN CAN SPEAK FOR ITSELF.
  //
  // The rule's verdict is read off the TASKS, because that is where the
  // allowed paths and the estimate live — and before a plan is approved there
  // are no tasks yet. So a request with a plan sitting on it, written because
  // the rule required one, printed "Was a plan required? not recorded" above
  // the plan that says why it was. The plan records its own `ruleLevel` and
  // `ruleTriggers` at the moment it was written; when the tasks cannot answer,
  // they can.
  const fromPlan = plans.map(p => str(p.meta, 'ruleLevel')).find(level => level !== null) ?? null;
  const planTriggers = plans.flatMap(p => list(p.meta, 'ruleTriggers'));
  s.facts = [
    {
      label: 'Was a plan required?',
      value: decision !== null
        ? planLevelSentence(decision)
        : fromPlan === null
          ? null
          : `${fromPlan === 'required' ? 'Yes' : fromPlan === 'offered' ? 'It was offered' : 'No'} — as the plan itself recorded when it was written; no task has been contracted yet for the rule to re-read.`,
    },
  ];
  if (decision === null && planTriggers.length > 0) {
    s.lists.push({ label: 'Why the plan says it was required', items: planTriggers });
  }
  if (decision !== null && decision.triggers.length > 0) {
    s.lists.push({ label: 'Why a plan was required', items: decision.triggers.map(t => t.why) });
  }
  if (decision !== null && decision.offered !== null) {
    s.lists.push({ label: 'Why a plan was offered', items: [decision.offered] });
  }
  if (decision !== null && decision.unknown.length > 0) {
    s.lists.push({ label: 'What the rule could not check, so did not count', items: decision.unknown });
  }
  if (recorded.length > 0) {
    s.lists.push({ label: 'What each task recorded about the plan', items: recorded.map(r => `Task ${r.task.id}: ${planRecordLine(r.plan)}`) });
  }

  for (const r of skips) {
    if (r.plan?.skipReason === null || r.plan?.skipReason === undefined) {
      s.flags.push(`Task ${r.task.id} recorded a skipped plan with no reason. A skip with no reason cannot be told apart from a step nobody took.`);
    }
    if (decision?.level === 'required') {
      s.flags.push(`Task ${r.task.id} skipped the plan and the rule required one: ${decision.triggers[0]?.why ?? 'the rule did not say why'}.`);
    }
  }

  if (plans.length === 0) {
    if (carried.length === 0 && skips.length === 0) {
      s.absence = decision?.level === 'required'
        ? `A plan was required and none is on the record: ${decision.triggers[0]?.why ?? 'the rule did not say why'}.${hasRuns ? ' The work ran anyway.' : ''}`
        : decision?.level === 'offered'
          ? 'A plan was offered for this work. Nothing on the record says it was written, and nothing says it was declined.'
          : tasks.length === 0
            ? 'Nothing was planned, and nothing was contracted either; there is no task to judge the rule against.'
            : 'No plan was needed for this work under the plan rule, and none was written.';
      return s;
    }
    // A task named a plan the report cannot open. That is worth saying out loud
    // rather than drawing an empty stage.
    if (carried.length > 0) {
      s.flags.push('The tasks name a plan that is not on record here, so the approach cannot be read from this page.');
    }
    return s;
  }

  s.entries = plans.map((plan) => {
    const meta = plan.meta;
    return {
      key: `plan-${plan.id}`,
      title: str(meta, 'title') ?? plan.title,
      status: plan.status,
      tone: statusTone(plan.status),
      at: asDate(meta.approvedAt) ?? plan.createdAt,
      cents: null,
      // WHAT IS BEING APPROVED is the steps. The reasoning behind them is
      // excellent and it is not the thing a person says yes to — four
      // paragraphs of it at the top of a plan is a document, not a decision.
      // It moves to `detailFacts`, behind "Why this plan".
      facts: [
        { label: 'Approved by', value: str(meta, 'approvedBy') === null ? (plan.status === 'approved' ? 'not recorded' : 'nobody yet') : personName(str(meta, 'approvedBy'), people) ?? 'Approver unavailable' },
        { label: 'Approved', value: asDate(meta.approvedAt) ? formatStamp(asDate(meta.approvedAt)) : null },
      ],
      steps: list(meta, 'components'),
      detailFacts: [
        { label: 'The approach, and why this one', value: str(meta, 'approach'), format: 'quote' },
        { label: 'Written by', value: str(meta, 'writtenBy') },
        { label: 'Data or migration impact', value: str(meta, 'dataImpact'), format: 'quote' },
        { label: 'How it will be verified', value: str(meta, 'verification'), format: 'quote' },
      ],
      checks: [],
      flags: str(meta, 'approvedBy') === null && plan.status === 'approved'
        ? ['This plan is marked approved and names nobody who approved it.']
        : [],
    };
  });
  for (const plan of plans) {
    for (const [key, label] of [['interfaces', 'Interfaces added or altered'], ['risks', 'What could go wrong'], ['alternatives', 'Considered and rejected, and why']] as const) {
      const items = list(plan.meta, key);
      s.detailLists.push({ label, items: items.length > 0 ? items : ['This plan does not say. A plan that answers nothing here is a document, not a design.'] });
    }
  }
  return s;
}

/**
 * The contract — one entry per task: what the worker was allowed to do, and
 * what it would take to accept it.
 * @param tasks - The tasks pointing at this request.
 */
function contractSection(tasks: ReportObject[]): ReportSection {
  const s = blank('contract', 'The contract');
  if (tasks.length === 0) {
    s.absence = 'No task was written for this feature; nothing was dispatched.';
    return s;
  }
  s.entries = tasks.map((task) => {
    const meta = task.meta;
    return {
      key: `task-${task.id}`,
      title: str(meta, 'objective') ?? task.title,
      status: task.status,
      tone: statusTone(task.status),
      at: task.createdAt,
      cents: num(meta, 'estimateCents'),
      facts: [
        { label: 'Repository', value: str(meta, 'repoSlug') ?? str(meta, 'repo'), format: 'mono' },
        { label: 'Risk class', value: str(meta, 'riskClass') },
        { label: 'Size', value: str(meta, 'sizeClass') },
        { label: 'Attempt', value: num(meta, 'attempt') === null ? null : String(num(meta, 'attempt')) },
        { label: 'Estimate', value: num(meta, 'estimateCents') === null ? null : money(num(meta, 'estimateCents')!), format: 'money' },
        { label: 'Base commit', value: str(meta, 'baseSha'), format: 'mono' },
      ],
      checks: list(meta, 'requiredChecks').map(name => ({ name, passed: null, detail: null })),
      flags: list(meta, 'allowedPaths').length === 0 ? ['This contract names no allowed paths, so nothing bounded the blast radius.'] : [],
    };
  });
  for (const task of tasks) {
    const accept = list(task.meta, 'acceptanceContract');
    s.lists.push({
      label: `Acceptance criteria · task ${task.id}`,
      items: accept.length > 0 ? accept : ['No acceptance criteria were written for this task.'],
    });
    const paths = list(task.meta, 'allowedPaths');
    s.lists.push({
      label: `Allowed paths · task ${task.id}`,
      items: paths.length > 0 ? paths : ['No allowed paths were written for this task.'],
    });
  }
  return s;
}

/**
 * Who decided, when, and what they said — every ask and every hand-off tied
 * to this work. An ask still open is listed as open; nothing here is
 * counted as an approval that was not one.
 * @param asks - Asks tied to the request or its tasks.
 * @param actionRuns - Hand-off action runs tied to the same.
 * @param hasRuns - Whether any worker run exists, which changes what the absence means.
 */
function approvalsSection(asks: ReportAsk[], actionRuns: ReportActionRun[], hasRuns: boolean): ReportSection {
  const s = blank('approvals', 'Approvals');
  if (asks.length === 0 && actionRuns.length === 0) {
    s.absence = hasRuns
      ? 'No person approved this; it ran under earned autonomy.'
      : 'Nothing about this work was ever put in front of a person.';
    return s;
  }
  s.entries = [
    ...asks.map<ReportEntry>(ask => ({
      key: `ask-${ask.id}`,
      title: ask.title,
      status: ask.status,
      tone: statusTone(ask.status),
      at: ask.decidedAt ?? ask.createdAt,
      cents: null,
      facts: [
        { label: 'Kind', value: `ask · ${ask.kind}` },
        { label: 'Decided by', value: ask.decidedBy ?? (ask.status === 'open' ? 'nobody yet — this ask is still open' : 'not recorded') },
        { label: 'Decided', value: ask.decidedAt ? formatStamp(ask.decidedAt) : null },
        { label: 'Decision', value: ask.decision },
        { label: 'Note', value: ask.decisionNote ?? (ask.decidedAt ? 'No note was left.' : null), format: 'quote' },
        { label: 'Decision cost', value: ask.decisionCost === null ? null : `${ask.decisionCost} min of a person` },
      ],
      checks: [],
      flags: [],
    })),
    ...actionRuns.map<ReportEntry>(run => ({
      key: `action-${run.id}`,
      title: run.actionId,
      status: run.status,
      tone: statusTone(run.status),
      at: run.decidedAt ?? run.executedAt ?? run.createdAt,
      cents: null,
      facts: [
        { label: 'Kind', value: 'hand-off · action run' },
        {
          label: 'Decided by',
          value: run.approvedByAgent === true
            ? `${run.decidedBy ?? 'an agent'} — released by the trust ladder, not by a person`
            : run.approvedByAgent === false
              ? (run.decidedBy ?? 'a person, not named on the record')
              : 'nobody has decided this yet',
        },
        { label: 'Decided', value: run.decidedAt ? formatStamp(run.decidedAt) : null },
        { label: 'Executed', value: run.executedAt ? formatStamp(run.executedAt) : null },
        { label: 'Note', value: run.note ?? (run.decidedAt ? 'No note was left.' : null), format: 'quote' },
      ],
      checks: [],
      flags: [],
    })),
  ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  return s;
}

/**
 * The runs — every attempt, with its cost, its duration, its checks and, on
 * a failure, the branch and draft pull request it left behind.
 * @param runs - Worker runs for this work, oldest first.
 * @param mergedPrs - Pull requests the records say merged, for the contradiction flag.
 */
function runsSection(runs: ReportWorkerRun[], mergedPrs: Set<string>): ReportSection {
  // BUILD, not "the runs" — and newest first.
  //
  // Five attempts at one rename drew as five equal rows in the order they
  // happened, so the one that matters — the last one, the one that decided
  // whether this work stands — was at the bottom, under four that had already
  // been superseded. Chris, 2026-09-22: *"Translate that into a build story…
  // the fact that the factory needed five attempts can be interesting; the
  // contents of every failed contract are forensic."*
  //
  // So the latest attempt leads and says it is the latest; the earlier ones
  // follow, numbered and named as superseded, which is what they are.
  const s = blank('runs', 'Build');
  if (runs.length === 0) {
    s.absence = 'Nothing has been built yet — no run is recorded against this work.';
    return s;
  }
  const newestFirst = [...runs].reverse();
  s.entries = newestFirst.map((run, index) => {
    const change = runChange(run);
    const ms = runDuration(run);
    const failed = TERMINAL_BAD.has(run.status);
    const flags: string[] = [];
    if (failed && change.prUrl && mergedPrs.has(change.prUrl)) {
      flags.push(`This run says ${run.status} and its pull request merged. Both are on the record; neither was inferred from the other. The worker's completion call can time out after the pull request is already open.`);
    }
    const facts: ReportFact[] = [
      { label: 'Agent', value: run.agentSlug, format: 'mono' },
      { label: 'Attempt', value: run.attempt === null ? null : String(run.attempt) },
      { label: 'Model', value: run.model, format: 'mono' },
      { label: 'Started', value: run.claimedAt ? formatStamp(run.claimedAt) : `queued ${formatStamp(run.createdAt)}, never claimed` },
      { label: 'Ended', value: run.completedAt ? formatStamp(run.completedAt) : 'this run has not ended' },
      { label: 'Duration', value: ms === null ? 'not measurable — the run has no claim and completion pair' : formatDuration(ms) },
      { label: 'Cost', value: run.cents === null ? null : money(run.cents), format: 'money' },
      { label: 'What it said', value: run.summary, format: 'quote' },
      { label: 'Error', value: run.error, format: 'quote' },
    ];
    if (failed) {
      facts.push(
        { label: 'Kept branch', value: change.keptBranch ?? 'no branch was kept', format: 'mono' },
        { label: 'Draft pull request', value: change.prUrl ?? 'none was opened', href: change.prUrl ?? undefined },
        { label: 'How to continue', value: change.continueNote, format: 'quote' },
      );
    }
    return {
      key: `run-${run.id}`,
      title: index === 0
        ? `Latest attempt · Run #${run.id}`
        : `Earlier attempt ${newestFirst.length - index} of ${newestFirst.length} · Run #${run.id}, superseded`,
      status: run.status,
      tone: statusTone(run.status),
      at: runAt(run),
      cents: run.cents,
      facts,
      checks: change.checks,
      flags,
    };
  });
  if (s.entries.every(e => e.checks.length === 0)) {
    s.flags.push('No run reported a check result, so nothing here says the work was verified.');
  }
  return s;
}

/**
 * The change — the pull request, its checks, the merge commit and the files
 * it touched. Read off the task first, because the task is what a person
 * merged; a run's report fills what the task does not carry.
 * @param tasks - The tasks.
 * @param runs - The runs, for a pull request the task never recorded.
 */
function changeSection(tasks: ReportObject[], runs: ReportWorkerRun[]): ReportSection {
  const s = blank('change', 'The change');
  const fromTasks = tasks.filter(t => str(t.meta, 'prUrl'));
  const fromRuns = runs.map(runChange).filter(c => c.prUrl);
  if (fromTasks.length === 0 && fromRuns.length === 0) {
    s.absence = 'No pull request is recorded for this work.';
    return s;
  }
  s.entries = tasks.filter(t => str(t.meta, 'prUrl')).map((task) => {
    const meta = task.meta;
    const files = list(meta, 'filesChanged');
    const rawChecks = Array.isArray(meta.checks) ? (meta.checks as unknown[]) : [];
    return {
      key: `pr-task-${task.id}`,
      title: str(meta, 'prUrl')!,
      status: task.status,
      tone: statusTone(task.status),
      at: asDate(meta.costUpdatedAt) ?? task.createdAt,
      cents: null,
      facts: [
        { label: 'Pull request', value: str(meta, 'prUrl'), href: str(meta, 'prUrl') ?? undefined },
        { label: 'Title', value: task.title },
        { label: 'Branch', value: str(meta, 'branch'), format: 'mono' },
        { label: 'Merge commit', value: str(meta, 'commitSha') ?? 'no commit is recorded, so nothing here says this merged', format: 'mono' },
        { label: 'Files changed', value: files.length === 0 ? 'the record lists none' : String(files.length) },
      ],
      checks: rawChecks.map((c) => {
        const check = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
        const exit = num(check, 'exitCode');
        return {
          name: str(check, 'name') ?? 'check',
          passed: typeof check.passed === 'boolean' ? check.passed : null,
          detail: exit === null ? null : `exit ${exit}`,
        };
      }),
      flags: [],
    };
  });
  for (const task of tasks) {
    const files = list(task.meta, 'filesChanged');
    if (files.length > 0) {
      s.lists.push({ label: `Files changed · task ${task.id}`, items: files });
    }
  }
  // A pull request only a run knows about — the task record never caught up.
  const known = new Set(s.entries.map(e => e.title));
  for (const c of fromRuns) {
    if (c.prUrl && !known.has(c.prUrl)) {
      known.add(c.prUrl);
      s.flags.push(`A worker reported the pull request ${c.prUrl}, and no task record carries it.`);
    }
  }
  return s;
}

/**
 * QA evidence. Empty is the normal case today and the section says so
 * plainly, because the absence is the finding.
 * @param artifacts - Artifacts attached to the tasks.
 * @param taskCount - How many tasks, so the sentence reads right.
 */
function qaSection(artifacts: ReportArtifact[], taskCount: number): ReportSection {
  const s = blank('qa', 'QA');
  s.evidence = artifacts
    .map(a => ({ a, role: qaEvidenceRole(a) }))
    .filter((x): x is { a: ReportArtifact; role: QaEvidenceRole } => x.role !== null)
    .map(({ a, role }) => ({
      id: a.id,
      kind: a.kind,
      ...drawOf(a),
      role,
      title: a.title,
      caption: str(a.spec, 'caption') ?? str(a.spec, 'description') ?? str(a.spec, 'summary'),
      url: evidenceUrl(a),
      at: a.createdAt,
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime());
  if (s.evidence.length === 0) {
    // SAY WHAT IS OWED, not what the schema expects.
    //
    // This read "No QA evidence was captured for this task. Evidence attaches
    // as an artifact on the engineering task with recordRole: qa-screenshot |
    // qa-video | qa-report. Nothing posts it yet." — a developer TODO
    // accidentally exposed to the customer (Chris, 2026-09-22). A person
    // reading it learns the column name and not the thing that matters: no
    // one has looked at this yet, and here is what looking at it means.
    s.absence = taskCount === 0
      ? 'Not ready for review — nothing has been built yet, so there is nothing to look at.'
      : 'Not ready for review — nobody has looked at this running yet.';
    s.checks = [
      { name: 'A shot of it working, on a desktop', passed: null, detail: null },
      { name: 'A shot of it working, on a phone', passed: null, detail: null },
      { name: 'The thing it promised, done once end to end', passed: null, detail: null },
      { name: 'Before and after, where something visible changed', passed: null, detail: null },
    ];
  }
  return s;
}

/**
 * THE RESULT — did the shipped change do what it was for? Deployment health,
 * an after-shot and a reply prove delivery; this is the outcome, and it is
 * the section the page was missing (review, 2026-09-24: "Shipped and told
 * does not prove the outcome"). Four facts the record can carry — what
 * should change, how we will check, when there will be enough use to know,
 * and what the check showed — and the honest absences for each.
 * @param request - The request.
 * @param released - Whether anything has carried it to people yet.
 */
function resultSection(request: ReportObject, released: boolean): ReportSection {
  const s = blank('result', 'Result');
  const meta = request.meta;
  const expected = str(meta, 'expectedResult');
  const how = str(meta, 'howWeCheck');
  const checkAfter = asDate(meta.checkAfter);
  const result = str(meta, 'result');
  const note = str(meta, 'resultNote');
  const checkedAt = asDate(meta.resultCheckedAt);
  const told = meta.told !== null && typeof meta.told === 'object' ? meta.told as Record<string, unknown> : null;
  if (expected === null && result === null) {
    s.absence = released
      ? 'No expected result was written for this, so shipping it can be confirmed but never called a success. Write what should have changed, and how to check.'
      : 'No expected result yet. Before this is approved, say what should be different for people once it ships, and how we will know.';
    return s;
  }
  s.facts.push({ label: 'Expected result', value: expected });
  s.facts.push({ label: 'How we will check', value: how });
  s.facts.push({ label: 'Check after', value: checkAfter ? formatStamp(checkAfter) : null });
  if (result === null) {
    s.facts.push({ label: 'Result', value: released ? (checkAfter ? `not checked yet — due ${formatStamp(checkAfter)}` : 'not checked yet') : 'not shipped yet' });
  } else {
    const label = result === 'helped' ? 'Helped' : result === 'did_not_help' ? 'Did not help' : 'Not enough evidence';
    s.facts.push({ label: 'Result', value: checkedAt ? `${label} · checked ${formatStamp(checkedAt)}` : label });
    s.facts.push({ label: 'What the check showed', value: note });
    if (result === 'did_not_help') {
      s.flags.push('Did not help: this is a new feature, not a closed one.');
    }
  }
  if (told) {
    const status = typeof told.status === 'string' ? told.status : null;
    const what = typeof told.what === 'string' ? told.what : null;
    const channel = typeof told.channel === 'string' ? told.channel : null;
    s.facts.push({ label: 'The asker was told', value: status === 'sent' ? [what, channel ? `on ${channel}` : null].filter(Boolean).join(' · ') || 'yes' : status === 'failed' ? 'the reply was released and the channel refused it — still open' : status === 'not_needed' ? 'no external asker' : null });
  } else if (released) {
    s.facts.push({ label: 'The asker was told', value: 'not yet' });
  }
  return s;
}

/**
 * The release — what the notes said, what the announcement said, when it
 * reached people and where.
 * @param releases - Releases carrying any of this work's tasks.
 */
function releaseSection(releases: ReportObject[]): ReportSection {
  const s = blank('release', 'Release');
  if (releases.length === 0) {
    // "No release carries this task" is the join, said out loud. What a
    // person wants here is whether this can go out and what is between it
    // and going out.
    s.absence = 'Not released. Nothing has carried this work to people yet.';
    return s;
  }
  s.entries = releases.map((release) => {
    const meta = release.meta;
    const announcedTo = list(meta, 'announcedTo');
    return {
      key: `release-${release.id}`,
      title: `${str(meta, 'product') ?? 'release'} ${str(meta, 'version') ?? release.title}`,
      status: release.status,
      tone: statusTone(release.status),
      at: asDate(meta.releasedAt) ?? release.createdAt,
      cents: null,
      facts: [
        { label: 'Shipped', value: asDate(meta.releasedAt) ? formatStamp(asDate(meta.releasedAt)) : 'the release record carries no shipped time' },
        { label: 'Notes', value: str(meta, 'notes'), format: 'quote' },
        { label: 'Announcement', value: str(meta, 'announcement') ?? 'no announcement was written', format: 'quote' },
        { label: 'Announced', value: asDate(meta.announcedAt) ? formatStamp(asDate(meta.announcedAt)) : 'nothing was announced' },
        { label: 'Announced to', value: announcedTo.length > 0 ? announcedTo.join(', ') : 'no surface is recorded' },
        { label: 'Deploy run', value: str(meta, 'deployRunUrl'), href: str(meta, 'deployRunUrl') ?? undefined },
      ],
      checks: [],
      flags: [],
    };
  });
  return s;
}

/**
 * Estimate against actual, with both figures' sources named. The task
 * rollup and the sum of what the runs actually charged are reported
 * separately and a disagreement is flagged rather than averaged away.
 * @param request - The request, whose rollups are the fallback.
 * @param tasks - The tasks.
 * @param runs - The runs.
 */
export function moneyLine(request: ReportObject, tasks: ReportObject[], runs: ReportWorkerRun[]): MoneyLine {
  const runCents = runs.reduce((a, r) => a + (r.cents ?? 0), 0);
  const taskEstimates = tasks.map(t => num(t.meta, 'estimateCents')).filter((n): n is number => n !== null);
  const taskActuals = tasks.map(t => num(t.meta, 'actualCents')).filter((n): n is number => n !== null);
  // THE WORK'S OWN ESTIMATE FIRST.
  //
  // Summing the task contracts was the only source, and when one piece of
  // work is attempted five times that sums five estimates for one job: the
  // Stamp rename read "$85 estimated" against "$24.12 actual", a 72% saving
  // that never existed. Chris, 2026-09-22: *"You need one immutable
  // work-level estimate before execution if you want meaningful
  // estimate-vs-actual. Do not derive it retrospectively by adding
  // attempt-level estimates."*
  const workEstimate = num(request.meta, 'estimateCents');
  const summed = taskEstimates.length > 0 ? taskEstimates.reduce((a, b) => a + b, 0) : null;
  const estimateCents = workEstimate ?? summed;
  // A sum over more than one attempt is not an estimate of this work, so it
  // is reported and never divided into. A single contract is the work.
  const comparable = workEstimate !== null || taskEstimates.length === 1;
  const actualCents = taskActuals.length > 0
    ? taskActuals.reduce((a, b) => a + b, 0)
    : runs.length > 0 ? runCents : num(request.meta, 'actualCents');
  return {
    estimateCents,
    actualCents,
    varianceCents: !comparable || estimateCents === null || actualCents === null ? null : actualCents - estimateCents,
    variancePct: !comparable || estimateCents === null || actualCents === null || estimateCents === 0
      ? null
      : Math.round(((actualCents - estimateCents) / estimateCents) * 100),
    runCents,
    estimateSource: workEstimate !== null
      ? 'estimated for this work before it started'
      : summed === null
        ? 'Not estimated'
        : taskEstimates.length === 1
          ? 'the one task contract written for it'
          : `added up from ${taskEstimates.length} attempt contracts — not an estimate of this work, so it is not compared against`,
    actualSource: taskActuals.length > 0
      ? `summed over ${taskActuals.length} task${taskActuals.length === 1 ? '' : 's'}`
      : runs.length > 0 ? `summed over ${runs.length} run${runs.length === 1 ? '' : 's'}` : 'nothing has been charged',
  };
}

/**
 * The money section, from the line.
 * @param line - The computed money line.
 */
function moneySection(line: MoneyLine): ReportSection {
  const s = blank('money', 'Cost');
  // ONE LINE, then the accounting.
  //
  // Six labelled figures gave money the same visual weight as the product
  // change itself, on work costing between ten and a hundred dollars. Chris,
  // 2026-09-22: *"Cost matters, but on a $10–$100 factory task it shouldn't
  // occupy the same visual weight as the actual product change."* So: what it
  // has cost and what it was expected to cost, in a sentence; the workings
  // one tap down.
  const spent = line.actualCents === null ? null : money(line.actualCents);
  const estimated = line.estimateCents === null ? null : money(line.estimateCents);
  s.facts = [{
    label: spent === null ? 'Estimated' : 'Spent',
    value: spent === null
      ? estimated ?? 'Not estimated'
      : estimated === null ? `${spent} · not estimated` : `${spent} · estimated ${estimated}`,
    format: 'money',
  }];
  // A variance only exists against a real estimate. Without one the line says
  // "Not estimated" and nothing is computed against nothing (2026-09-28).
  s.detailLists.push({
    label: 'How that is worked out',
    items: [
      estimated === null ? 'Estimate: Not estimated.' : `Estimate: ${estimated} — ${line.estimateSource}.`,
      `Actual: ${spent ?? 'nothing has been charged'} — ${line.actualSource}.`,
      ...(line.varianceCents === null
        ? []
        : [`Variance: ${line.varianceCents >= 0 ? '+' : ''}${money(line.varianceCents)}${line.variancePct === null ? '' : ` (${line.variancePct >= 0 ? '+' : ''}${line.variancePct}%)`}.`]),
      `Charged across the runs: ${money(line.runCents)}.`,
    ],
  });
  return s;
}

/**
 * The pull requests the records say merged — a done merge for it, or a
 * release that carries it.
 * @param releases - The releases.
 * @param actionRuns - The request's action runs (a done `git.merge` names its pull request).
 */
export function mergedPullRequests(releases: ReportObject[], actionRuns: readonly ReportActionRun[] = []): Set<string> {
  // A MERGE IS WHAT MERGED IT, NOT A COMMIT ON THE TASK (#201, 2026-09-29:
  // "Merged: Yes" beside "Ready to merge"). A task's commitSha is its PR's head
  // — every finished attempt has one. Merged means a done git.merge for that
  // pull request (a person's press, the trust rule, or GitHub's webhook), or a
  // release that lists it.
  const merged = new Set<string>();
  for (const run of actionRuns) {
    if (run.actionId !== 'git.merge' || run.status !== 'done') {
      continue;
    }
    const url = (run.input.externalRef as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') {
      merged.add(url);
    }
  }
  for (const release of releases) {
    for (const pr of list(release.meta, 'prUrls')) {
      merged.add(pr);
    }
  }
  return merged;
}

/**
 * Every moment on the record, oldest first. Entries the record gives no time
 * for keep their order and sort last, saying "time not recorded" rather than
 * being given a plausible one.
 * @param input - The report's inputs.
 * @param mergedPrs - Pull requests the records say merged.
 */
function buildTimeline(input: FeatureReportInput, mergedPrs: Set<string>): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const meta = input.request.meta;
  const askedBy = (meta.askedBy && typeof meta.askedBy === 'object' ? meta.askedBy : null) as Record<string, unknown> | null;

  out.push({
    key: 'asked',
    at: asDate(meta.askedAt) ?? input.request.createdAt,
    kind: 'asked',
    title: `Asked by ${askerLabel(askedBy)}${str(meta, 'channel') ? ` via ${str(meta, 'channel')}` : ''}`,
    detail: str(meta, 'body') ?? input.request.title,
    cents: null,
    tone: 'info',
    href: `/dashboard/objects/${input.request.id}`,
  });

  if (asDate(meta.rankedAt)) {
    out.push({
      key: 'ranked',
      at: asDate(meta.rankedAt),
      kind: 'triaged',
      title: `Triaged and ranked${num(meta, 'priority') === null ? '' : ` at priority ${num(meta, 'priority')}`}`,
      detail: str(meta, 'priorityReason'),
      cents: null,
      tone: 'muted',
      href: null,
    });
  }
  if (asDate(meta.recommendedAt)) {
    out.push({
      key: 'recommended',
      at: asDate(meta.recommendedAt),
      kind: 'decision',
      title: `Recommended to a person: ${str(meta, 'recommendedOutcome') ?? 'no outcome named'}`,
      detail: null,
      cents: null,
      tone: 'warn',
      href: null,
    });
  }
  for (const plan of input.plans) {
    out.push({
      key: `plan-written-${plan.id}`,
      at: plan.createdAt,
      kind: 'plan',
      title: `Plan written: ${plan.title}`,
      detail: str(plan.meta, 'approach'),
      cents: null,
      tone: 'info',
      href: (input.link ?? genericRecordLinker)({ objectType: 'architecture_plan', id: plan.id }),
    });
    if (asDate(plan.meta.approvedAt)) {
      out.push({
        key: `plan-approved-${plan.id}`,
        at: asDate(plan.meta.approvedAt),
        kind: 'plan',
        title: str(plan.meta, 'approvedBy') === null
          ? 'Plan approved by nobody named on the record'
          : `Plan approved by ${personName(str(plan.meta, 'approvedBy'), input.people) ?? 'a person whose name is unavailable'}`,
        detail: null,
        cents: null,
        tone: 'ok',
        href: (input.link ?? genericRecordLinker)({ objectType: 'architecture_plan', id: plan.id }),
      });
    }
  }
  for (const task of input.tasks) {
    const plan = planRecordFromTask(task.meta);
    if (plan?.skipped === true) {
      out.push({
        key: `plan-skipped-${task.id}`,
        at: task.createdAt,
        kind: 'plan',
        title: `Task ${task.id}: ${planRecordLine(plan)}`,
        detail: null,
        cents: null,
        tone: 'warn',
        href: (input.link ?? genericRecordLinker)({ objectType: 'engineering_task', id: task.id }),
      });
    }
  }

  if (asDate(meta.decidedAt)) {
    out.push({
      key: 'request-decided',
      at: asDate(meta.decidedAt),
      kind: 'decision',
      title: `A person decided: ${str(meta, 'recommendationState') ?? 'decision not named'}`,
      detail: str(meta, 'decisionReason'),
      cents: null,
      tone: 'ok',
      href: null,
    });
  }

  for (const task of input.tasks) {
    out.push({
      key: `contract-${task.id}`,
      at: task.createdAt,
      kind: 'contract',
      title: `Contract written · task ${task.id}`,
      detail: str(task.meta, 'objective') ?? task.title,
      cents: num(task.meta, 'estimateCents'),
      tone: 'info',
      href: (input.link ?? genericRecordLinker)({ objectType: 'engineering_task', id: task.id }),
    });
  }

  for (const ask of input.asks) {
    if (ask.decidedAt) {
      out.push({
        key: `ask-${ask.id}`,
        at: ask.decidedAt,
        kind: 'decision',
        title: `${ask.decidedBy ?? 'A person'} decided "${ask.title}": ${ask.decision ?? 'no decision recorded'}`,
        detail: ask.decisionNote,
        cents: null,
        tone: 'ok',
        href: ask.contextUrl,
      });
    }
  }
  for (const run of input.actionRuns) {
    if (run.decidedAt) {
      out.push({
        key: `action-${run.id}`,
        at: run.decidedAt,
        kind: 'decision',
        title: run.approvedByAgent === true
          ? `${run.actionId} released by the trust ladder, with no person`
          : `${run.decidedBy ?? 'A person'} decided ${run.actionId}: ${run.status}`,
        detail: run.note,
        cents: null,
        tone: run.approvedByAgent === true ? 'muted' : 'ok',
        href: null,
      });
    }
  }

  for (const run of input.workerRuns) {
    const change = runChange(run);
    const live = liveOf(run);
    out.push({
      key: `run-${run.id}`,
      at: runAt(run),
      kind: 'run',
      title: `Run ${run.id} · ${run.agentSlug} · attempt ${run.attempt ?? '?'} · ${run.status}`,
      detail: run.summary ?? run.error,
      cents: run.cents,
      tone: statusTone(run.status),
      href: null,
      ...(live ? { live } : {}),
    });
    if (change.prUrl) {
      out.push({
        key: `run-${run.id}-pr`,
        at: run.completedAt ?? null,
        kind: 'change',
        title: `Pull request ${change.prUrl}`,
        detail: TERMINAL_BAD.has(run.status) && mergedPrs.has(change.prUrl)
          ? 'The run that opened it says it failed, and this pull request merged. Both are recorded.'
          : change.commitSha,
        cents: null,
        tone: TERMINAL_BAD.has(run.status) && mergedPrs.has(change.prUrl) ? 'bad' : 'ok',
        href: change.prUrl,
      });
    }
  }

  for (const artifact of input.artifacts) {
    const role = qaEvidenceRole(artifact);
    if (role) {
      out.push({
        key: `qa-${artifact.id}`,
        at: artifact.createdAt,
        kind: 'qa',
        title: `${role} · ${artifact.title}`,
        detail: str(artifact.spec, 'caption') ?? null,
        cents: null,
        tone: 'info',
        href: evidenceUrl(artifact),
      });
    }
  }

  for (const release of input.releases) {
    out.push({
      key: `release-${release.id}`,
      at: asDate(release.meta.releasedAt) ?? release.createdAt,
      kind: 'release',
      title: `Shipped ${str(release.meta, 'product') ?? ''} ${str(release.meta, 'version') ?? release.title}`.replace(/\s+/g, ' ').trim(),
      detail: str(release.meta, 'announcement') ?? str(release.meta, 'notes'),
      cents: null,
      tone: 'ok',
      href: (input.link ?? genericRecordLinker)({ objectType: 'release', id: release.id }),
    });
  }

  // THE FACTORY'S OWN ACCOUNT (backlog 038): why it started, planned,
  // recovered or stopped, one line each, so the reason is on the page where
  // the work is read and not only in an automation log.
  for (const [i, line] of readRecovery(meta).log.entries()) {
    out.push({
      key: `carry-${i}`,
      at: asDate(line.at),
      kind: line.runId ? 'run' : 'decision',
      title: line.text,
      detail: null,
      cents: null,
      tone: line.text.startsWith('Stopped') ? 'warn' : 'info',
      href: line.runId ? `/dashboard/p/runs/${line.runId}` : null,
    });
  }

  // Oldest first. An entry with no time sorts last rather than to the epoch,
  // and keeps its order among the other undated ones.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.at && b.e.at) {
        return a.e.at.getTime() - b.e.at.getTime() || a.i - b.i;
      }
      if (!a.e.at && !b.e.at) {
        return a.i - b.i;
      }
      return a.e.at ? -1 : 1;
    })
    .map(x => x.e);
}

/**
 * Everything the records disagree about, said plainly. Never resolved: the
 * report's job is to show a person the contradiction, not to pick which
 * table is right.
 * @param input - The report's inputs.
 * @param mergedPrs - Pull requests the records say merged.
 * @param line - The money line.
 */
/** Task stages that say an engineer already worked on it — so a missing run is a gap, not a queue. */
const WORKED_STAGES: ReadonlySet<string> = new Set(['running', 'awaiting_review', 'accepted', 'changes_requested', 'review_failed']);

/**
 * Everything the records disagree about, each said as what is known, whether
 * it blocks, and the one move — with the disagreement exactly as recorded
 * kept as its evidence. Never resolved: the report shows a person the
 * contradiction and does not pick which table is right.
 *
 * Every one of these is an INCONSISTENCY, drawn quietly. The red sentence
 * that opened the page ("Execution history is incomplete…", "approved after
 * the first worker run…") read as an outage on work that was fine — the
 * first "run" was the worker refusing to start without the plan, which is
 * the gate working (Chris, 2026-09-28). Only a confirmed obstacle — the
 * record's own blocker — is red, and that is the status line's job.
 * @param input - The report's inputs.
 * @param mergedPrs - Pull requests the records say merged.
 * @param line - The money line.
 */
function findNotices(input: FeatureReportInput, mergedPrs: Set<string>, line: MoneyLine): ReportNotice[] {
  const out: ReportNotice[] = [];
  const quiet = (key: string, known: string, blocks: string, action: ReportNotice['action'], evidence: string) =>
    out.push({ key, severity: 'inconsistency', known, blocks, action, evidence });
  const executed = input.workerRuns.filter(executedRun);
  for (const run of input.workerRuns) {
    const change = runChange(run);
    if (TERMINAL_BAD.has(run.status) && change.prUrl && mergedPrs.has(change.prUrl)) {
      quiet(
        `run-merged-${run.id}`,
        `Run ${run.id} is recorded as ${run.status}, but its pull request merged.`,
        'This does not block anything: the merged change is on the record. The run\'s own status is stale.',
        { label: 'Review delivery status', drawer: 'status' },
        `Run ${run.id} is recorded as ${run.status}, and its pull request ${change.prUrl} merged. Both facts stand; the worker's completion call can time out after the pull request is open.`,
      );
    }
  }
  const rolledUp = input.tasks.map(t => num(t.meta, 'actualCents')).filter((n): n is number => n !== null);
  if (rolledUp.length > 0 && input.workerRuns.length > 0) {
    const sum = rolledUp.reduce((a, b) => a + b, 0);
    if (sum !== line.runCents) {
      quiet(
        'cost-disagree',
        `Two cost records disagree: the tasks say ${money(sum)}, the runs charged ${money(line.runCents)}.`,
        'This does not block delivery. Which figure is current is not established.',
        { label: 'Review cost', drawer: 'cost' },
        `The tasks roll up ${money(sum)} spent and the runs charged ${money(line.runCents)}. One of the two is stale.`,
      );
    }
  }
  const planDecision = planDecisionForRequest(input.tasks);
  if (planDecision?.level === 'required' && input.plans.length === 0 && executed.length > 0) {
    const skipped = input.tasks.filter(t => planRecordFromTask(t.meta)?.skipped === true).length;
    quiet(
      'plan-missing',
      'This was built without the plan the plan rule required.',
      'It does not block the build. The approach was not reviewed before work began.',
      { label: 'Review plan', drawer: 'plan' },
      `The plan rule required a plan for this work and none is on the record${skipped > 0 ? `, and ${skipped} task${skipped === 1 ? '' : 's'} recorded the plan as skipped` : ''}. ${executed.length} run${executed.length === 1 ? '' : 's'} ran anyway.`,
    );
  }
  // Only a run that DID something can come before an approval. A refusal is
  // the worker declining to start without one.
  const firstRunAt = executed.map(r => r.claimedAt ?? runAt(r)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  for (const plan of input.plans) {
    const approvedAt = asDate(plan.meta.approvedAt);
    if (approvedAt && firstRunAt && approvedAt.getTime() > firstRunAt.getTime()) {
      quiet(
        `plan-late-${plan.id}`,
        'The plan was approved after building had already begun.',
        'It does not block: the plan is approved now. It did not gate the first attempt.',
        { label: 'Review approval history', drawer: 'plan' },
        `Plan ${plan.id} was approved at ${formatStamp(approvedAt)}, after the first run started at ${formatStamp(firstRunAt)}. A plan approved after the work is a record, not a gate.`,
      );
    }
  }
  for (const task of input.tasks) {
    if (task.status === 'accepted' && !str(task.meta, 'prUrl')) {
      quiet(
        `accepted-no-pr-${task.id}`,
        `Task ${task.id} is accepted, and no pull request is recorded for it.`,
        'Whether the change merged is not established.',
        { label: 'Review delivery status', drawer: 'status' },
        `Task ${task.id} is accepted and carries no pull request.`,
      );
    }
  }
  if (input.releases.length > 0 && input.tasks.every(t => t.status !== 'accepted')) {
    quiet(
      'release-unaccepted',
      'A release names this work, and no task on it was accepted.',
      'Whether the released change is this work is not established.',
      { label: 'Review delivery status', drawer: 'release' },
      'A release carries this work and no task is accepted.',
    );
  }
  // The join that quietly became a zero. The rollup and the rows disagree
  // about whether any work was written.
  const written = num(input.request.meta, 'taskCount') ?? 0;
  if (written > 0 && input.tasks.length === 0) {
    quiet(
      'tasks-unlinked',
      `This work records ${written} task${written === 1 ? '' : 's'} written for it, and none is linked here.`,
      'Build history on this page is incomplete until they are linked. Delivery status cannot be established.',
      { label: 'Review delivery status', drawer: 'status' },
      `This work records ${written} task${written === 1 ? '' : 's'} written for it, and not one is linked to it. Everything below that reads off tasks — the plan, the contract, the change, the money — is reading an empty set.`,
    );
  }
  // A task still queued has no run BECAUSE it is queued; that is not a gap.
  // Only a task that says an engineer worked on it and has no run is one.
  const worked = input.tasks.filter(t => WORKED_STAGES.has(taskStatus(t)));
  if (worked.length > 0 && input.workerRuns.length === 0) {
    quiet(
      'runs-unlinked',
      `The task${worked.length === 1 ? ' says it was' : 's say they were'} worked on, and no run is linked.`,
      'It does not block review or the merge. Attempts and per-run cost cannot be shown until the run is linked.',
      { label: 'Review delivery status', drawer: 'status' },
      `Execution history is incomplete: ${input.tasks.length} task${input.tasks.length === 1 ? ' was' : 's were'} written for this work and no worker run is linked to ${input.tasks.length === 1 ? 'it' : 'them'}. Attempts, models and per-run cost are unreadable until that join is repaired.`,
    );
  }
  return out;
}

/**
 * WHERE THIS WORK IS, AND WHAT IT WANTS FROM YOU.
 *
 * The one thing a person opening this page needs before anything else.
 * Everything under it — the plan, the contract, the runs, the money — is the
 * detail behind this sentence, and the page led with none of it: Work said
 * `Blocked`, and the detail page opened with a paragraph describing the
 * database while the actual blocker sat far below. Chris, 2026-09-22: *"That
 * should be the first thing I see. Everything else is secondary until I
 * resolve it."*
 *
 * Derived, never stored: a state read off the records cannot disagree with
 * them, and a stored one eventually does.
 */
export type ReportState = {
  key: 'blocked' | 'decide' | 'approve' | 'building' | 'planning' | 'recovering' | 'qa' | 'changes' | 'stuck' | 'merge' | 'released' | 'waiting';
  /** "Blocked", "Building" — the badge. */
  label: string;
  /** "waiting on you", "no action needed" — the half that says whose move it is. */
  detail: string;
  /** True when a person is the one holding it up. Drives the sticky action on a phone. */
  needsYou: boolean;
  /** The question being asked, verbatim, when one is open. */
  question: string | null;
  /** The one thing to do about it, and where. */
  action: { label: string; href: string } | null;
  /**
   * The decision itself, when one is open — enough to decide HERE: what is
   * asked, what is recommended and why, the risk, the cost — and the id to
   * decide it by. A "Review decision" button that leaves the page is not a
   * decision card (Chris, 2026-09-24).
   */
  decision: {
    kind: 'ask' | 'proposal';
    id: number;
    actionId: string | null;
    recommendation: string | null;
    risk: string | null;
    cost: string | null;
  } | null;
};

/**
 * Read the state off the records, in the order that decides it: a person
 * being asked something outranks everything, then a plan waiting for
 * approval, then work in flight, then work waiting to be looked at.
 * @param input - The report's inputs.
 * @param live - What is running for it now (the Now line), which says whether a build is queued or building and what the planning move opens.
 * @param mergedPrs - Pull requests the records say merged, so an approved change that merged reads Merged.
 */
function buildState(input: FeatureReportInput, live: LiveRun | null = null, mergedPrs: ReadonlySet<string> = new Set()): ReportState {
  // AN ACTUAL OBSTACLE FIRST, and only an actual obstacle reads as Blocked
  // (review, 2026-09-24). Waiting on a decision, on QA or on a merge are
  // waits with names; each says whose move it is in a plain sentence.
  // A blocker whose move was made is not current (#130: "approve plan 136"
  // read as Blocked after plan 136 was approved) — `services/factory/blocker.ts`.
  const blocker = blockerOf(input.request.meta);
  const stale = blocker ? blockerResolution(input.request.meta.blocker, blockerFactsOf(input)) : null;
  if (blocker && !stale) {
    return {
      key: 'blocked',
      label: 'Blocked',
      detail: blocker.owner ? `${blocker.owner} to ${blocker.next ?? 'clear it'}` : blocker.next ?? 'nobody is named to clear it',
      needsYou: true,
      question: blocker.what,
      action: { label: 'See what is blocking it', href: '#report-approvals' },
      decision: null,
    };
  }
  const meta = input.request.meta;
  const risk = str(meta, 'mainRisk');
  const verb = OUTCOME_VERBS[str(meta, 'recommendedOutcome') ?? ''] ?? null;
  const whyNote = str(meta, 'whyNote');
  const recommendation = verb ? `Vocion recommends we ${verb}${whyNote ? ` — ${whyNote}` : ''}` : whyNote;
  const estimate = num(meta, 'estimateCents');
  const openAsk = input.asks.find(a => a.decidedAt === null);
  if (openAsk) {
    return {
      key: 'decide',
      label: 'Decide',
      detail: 'waiting on you',
      needsYou: true,
      question: openAsk.title,
      action: { label: 'Review decision', href: '#report-approvals' },
      decision: {
        kind: 'ask',
        id: openAsk.id,
        actionId: null,
        recommendation: openAsk.body?.trim() || recommendation,
        risk,
        cost: estimate !== null && estimate > 0 ? `about ${money(estimate)}` : openAsk.decisionCost !== null ? `about ${openAsk.decisionCost} min to decide` : null,
      },
    };
  }
  // WAITING ON A PERSON is a pending run nobody has decided. `approvedByAgent`
  // is NULL until someone decides, so reading it as `=== false` missed every
  // card still waiting — journey 4's Build card #4945 read "Not being built"
  // over a pending dispatch (2026-09-28).
  const pendingAction = input.actionRuns.find(a => a.decidedAt === null && a.approvedByAgent !== true && a.status === 'pending');
  if (pendingAction) {
    return {
      key: 'approve',
      label: pendingAction.actionId === 'git.merge' ? 'Ready to merge' : 'Needs approval',
      detail: 'waiting on you',
      needsYou: true,
      question: pendingAction.actionId === 'git.merge' ? 'QA approved; the merge is the deploy.' : `Approve ${pendingAction.actionId}?`,
      action: { label: 'Review & approve', href: '#report-approvals' },
      decision: {
        kind: 'proposal',
        id: pendingAction.id,
        actionId: pendingAction.actionId,
        recommendation: pendingAction.note?.trim() || recommendation,
        risk,
        cost: estimate !== null && estimate > 0 ? `about ${money(estimate)}` : null,
      },
    };
  }
  if (input.releases.length > 0) {
    const result = str(input.request.meta, 'result');
    const told = input.request.meta.told !== null && typeof input.request.meta.told === 'object' ? (input.request.meta.told as Record<string, unknown>).status : null;
    const detail = result === 'helped' ? 'live, and it helped' : result === 'did_not_help' ? 'live, and it did not help' : told === 'sent' ? 'live; the asker has been told; result not checked yet' : 'live for people; result not checked yet';
    return { key: 'released', label: 'Released', detail, needsYou: false, question: null, action: { label: 'See the release', href: '#report-release' }, decision: null };
  }
  // THE FACTORY CARRYING IT (backlog 038): planning first, an automatic
  // attempt out after a failure, or stopped at the limit — each says what
  // happens next, in the factory's own sentence.
  const carrying = recoveryStage(input.request.meta);
  const running = input.workerRuns.filter(r => !TERMINAL_BAD.has(r.status) && r.status !== 'completed');
  if (running.length > 0) {
    if (carrying?.stage === 'recovering') {
      return { key: 'recovering', label: carrying.label, detail: carrying.line.replace(/^Recovering \(attempt \d+ of \d+\):\s*/, ''), needsYou: false, question: null, action: { label: 'View progress', href: '#report-runs' }, decision: null };
    }
    // A RUN NOBODY HAS CLAIMED IS NOT BUILDING (Chris, 2026-09-30, #265:
    // "Building now … started 3 min ago" over a run still queued for a
    // worker). The Now line says which, and so does the badge.
    if (live?.kind === 'queued') {
      return { key: 'building', label: 'Waiting for a worker', detail: 'queued; no worker has picked it up yet', needsYou: false, question: null, action: { label: 'View progress', href: '#report-runs' }, decision: null };
    }
    return { key: 'building', label: 'Building', detail: 'no action needed from you', needsYou: false, question: null, action: { label: 'View progress', href: '#report-runs' }, decision: null };
  }
  if (carrying?.stage === 'planning') {
    // THE MOVE IS THE RUN WRITING THE PLAN while it writes it, and "See the
    // plan" only once there is one (#265 offered "See the plan" over no plan
    // while run 6414 wrote it, unseen).
    const action = live?.kind === 'planning'
      ? { label: 'Watch the plan being written', href: live.runHref }
      : input.plans.length > 0 ? { label: 'See the plan', href: '#report-plan' } : null;
    return { key: 'planning', label: 'Planning', detail: carrying.line.replace(/^Planning\s*—\s*/, ''), needsYou: false, question: null, action, decision: null };
  }
  const accepted = input.tasks.filter(t => taskStatus(t) === 'accepted');
  if (accepted.length > 0) {
    // WHO MERGES IT IS THE TRUST RULE'S WORD, NOT A GUESS (backlog 044). A
    // merged pull request is merged, whatever the task still says; a class
    // whose rule runs within bounds merges on its own, and nobody is waited on.
    const attempt = currentAttempt(input);
    if (attempt.prUrl && mergedPrs.has(attempt.prUrl)) {
      return { key: 'merge', label: 'Merged', detail: 'merged; the release is recorded once it is live', needsYou: false, question: null, action: { label: 'See the change', href: '#report-change' }, decision: null };
    }
    if (input.mergeRule?.runsItself === true) {
      return { key: 'merge', label: 'Merging', detail: 'QA approved; it merges on its own on its trust rule', needsYou: false, question: null, action: { label: 'See the change', href: '#report-change' }, decision: null };
    }
    return { key: 'merge', label: 'Ready to merge', detail: 'QA approved; the merge is waiting on a person', needsYou: true, question: null, action: { label: 'Review the merge', href: '#report-qa' }, decision: null };
  }
  // QA SENT IT BACK (record_verdict: changes). The verdict is the reader's
  // next move, not "no action needed": its count, its sentence, Build again.
  const sentBack = [...input.tasks].filter(t => taskStatus(t) === 'changes_requested').sort((a, b) => b.id - a.id)[0];
  if (sentBack && !input.tasks.some(t => taskStatus(t) === 'awaiting_review')) {
    const v = (sentBack.meta.verdict ?? {}) as { proven?: number; total?: number; note?: string };
    // The same count the acceptance section and the release read, for this attempt.
    const proof = featureProof({ request: input.request, tasks: [sentBack] });
    const count = proof.attempt !== null && proof.total > 0
      ? `QA proved ${proof.proven} of ${proof.total}${risksLine(proof) ? ` (${risksLine(proof)})` : ''}`
      : typeof v.proven === 'number' && typeof v.total === 'number' ? `QA proved ${v.proven} of ${v.total}` : 'QA sent it back';
    return { key: 'changes', label: 'Changes asked', detail: v.note ? `${count}: ${v.note}` : count, needsYou: true, question: null, action: { label: 'Build again', href: '#feature-decide' }, decision: null };
  }
  // QA COULD NOT FINISH. A review that ended without a verdict, even after
  // the recording pass, is said as that — never "no action needed" (#131,
  // task 177 read that for six hours over five failed reviews).
  // ENGINEERING STOPPED. The newest attempt's run failed and no attempt is
  // waiting on anyone: say so, with the run's own reason, and offer Build
  // again. #126 attempt 194 failed ("Claude produced no changes") and the page
  // had no stage line and no Build button (2026-09-28).
  if (engineeringStopped(input)) {
    const newestRun = [...input.workerRuns].sort((a, b) => b.id - a.id)[0]!;
    if (carrying?.stage === 'stopped') {
      return { key: 'stuck', label: carrying.label, detail: carrying.line.replace(/^Stopped(?: after \d+ attempts?)?:\s*/, ''), needsYou: true, question: null, action: { label: 'Build again', href: '#feature-decide' }, decision: null };
    }
    if (carrying?.stage === 'recovering') {
      return { key: 'recovering', label: carrying.label, detail: 'the run failed; the next attempt starts on its own', needsYou: false, question: null, action: { label: 'View run', href: '#report-runs' }, decision: null };
    }
    // SAID FOR A PERSON (2026-09-28, #201 read "Engineering stopped:
    // contract refused: 1 problem: plan is required: … without a plan.."):
    // the failure in a sentence, and what happens next. The worker's own text
    // stays on the run page and in the Status drawer.
    const failure = classifyFailure({ status: newestRun.status, error: newestRun.error, failures: newestRun.failures ?? [], result: newestRun.result });
    const handled = readRecovery(input.request.meta).handledRunIds.includes(newestRun.id);
    const next = handled ? 'Build again starts a fresh attempt' : `next, ${nextAfter(failure)} — or Build again starts a fresh attempt now`;
    return { key: 'stuck', label: 'Engineering stopped', detail: `the last run failed: ${failure.sentence}; ${next}`, needsYou: handled, question: null, action: { label: 'Build again', href: '#feature-decide' }, decision: null };
  }
  const failedReview = [...input.tasks].filter(t => taskStatus(t) === 'review_failed').sort((a, b) => b.id - a.id)[0];
  if (failedReview && !input.tasks.some(t => taskStatus(t) === 'awaiting_review')) {
    return { key: 'stuck', label: 'QA could not finish', detail: 'QA ended without a verdict; Build again starts a fresh attempt', needsYou: true, question: null, action: { label: 'Build again', href: '#feature-decide' }, decision: null };
  }
  const awaitingReview = input.tasks.filter(t => taskStatus(t) === 'awaiting_review');
  // QA STARTS ONLY ON A GREEN CI (#269, 2026-09-30: "Stuck?" answered "QA is
  // checking it" while CI had failed and no review ran). The stage says what
  // CI said about this attempt's commit, and a review is said only while one runs.
  // Only when the pull requests' signals were read: absent, nothing is known.
  const waitingOn = input.pulls && awaitingReview.length > 0 && live?.kind !== 'reviewing' ? currentAttempt(input) : null;
  if (waitingOn?.prUrl && waitingOn.stage === 'awaiting_review') {
    const ciFailure = waitingOn.task?.meta.ciFailure;
    const ci = ciFact(waitingOn.signals, { commit: waitingOn.task ? str(waitingOn.task.meta, 'commitSha') : null, ciFailure: ciFailure && typeof ciFailure === 'object' ? ciFailure as Record<string, unknown> : null }, prLabel(waitingOn.prUrl));
    if (ci.state === 'failed') {
      return { key: 'qa', label: 'CI failed', detail: `${ci.line}; QA starts only on a green CI, so the engineer builds it again with what failed`, needsYou: false, question: null, action: { label: 'See the change', href: '#report-change' }, decision: null };
    }
    if (ci.state === 'not_reported') {
      return { key: 'qa', label: 'Waiting for CI', detail: `${ci.line}; QA starts when it is green`, needsYou: false, question: null, action: { label: 'See the change', href: '#report-change' }, decision: null };
    }
  }
  if (awaitingReview.length > 0) {
    const last = input.workerRuns.map(r => r.completedAt ?? r.createdAt).filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return { key: 'qa', label: 'Awaiting QA', detail: last ? `engineering finished ${formatStamp(last)}; no action needed from you` : 'engineering finished; no action needed from you', needsYou: false, question: null, action: { label: 'See the change', href: '#report-change' }, decision: null };
  }
  // "NOT STARTED" IS A CLAIM TOO.
  //
  // The request keeps its own rollup of how many tasks were written for it,
  // and that rollup can say five while not one task row links back — the same
  // broken join that made the strip print "0 attempts". Drawing that as "not
  // started", at the top of the page, in the place a person reads first, is
  // the most confident version of the lie. So when the record says work was
  // written and none of it is linked, the state says it cannot tell, and the
  // contradictions block underneath says why.
  const written = num(input.request.meta, 'taskCount') ?? 0;
  if (written > 0) {
    return {
      key: 'waiting',
      label: 'Unreadable',
      detail: 'the records disagree',
      needsYou: false,
      decision: null,
      question: `This work says ${written} task${written === 1 ? ' was' : 's were'} written for it and none of them is linked here.`,
      action: null,
    };
  }
  return { key: 'waiting', label: 'Not started', detail: 'nothing has run yet', needsYou: false, question: null, action: null, decision: null };
}

/**
 * WHAT THIS WORK IS FOR, in a sentence.
 *
 * The subtitle reads the ask's own body, and a body can be anything a person
 * or an agent put there — on the Stamp rename it was six numbered acceptance
 * criteria, which drew a nine-line wall of text under the title where a goal
 * belongs. A subtitle that has to be read is not a subtitle.
 *
 * So: the first sentence, capped. The whole body is still on the page, in the
 * ask, where a reader goes when the sentence is not enough.
 * @param request - The request record.
 */
function goalOf(request: ReportObject): string | null {
  // `outcome` first — the type's own "line every surface leads with", and the
  // one sentence an agent can write (`summary` is the row's column and
  // `objects.update_meta` refuses it) — then the summary the record was filed
  // with, then the ask's body.
  const raw = (str(request.meta, 'outcome') ?? str(request.meta, 'summary') ?? str(request.meta, 'body') ?? '').trim();
  if (raw === '') {
    return null;
  }
  const oneLine = raw.replace(/\s+/g, ' ');
  // A sentence ends at a full stop followed by a space and then a capital or
  // a digit — a capital for ordinary prose, a digit because a body that
  // continues "1. Every screen shows Stamp" is a list, and the list is not
  // the goal. Not the dot inside "stampsend.com", which is followed by a
  // lowercase letter.
  const cut = oneLine.search(/\.\s+[A-Z0-9]/);
  const first = cut === -1 ? oneLine : oneLine.slice(0, cut + 1);
  // A body that opens "Acceptance criteria — each one a person can check: 1.
  // Every screen…" has its first full stop INSIDE the list marker, so the
  // sentence rule above kept the "1." and the goal read
  // "…each one a person can check: 1." — a label with a stray numeral glued
  // to it. Drop a trailing enumeration marker, and if what is left is a
  // colon-terminated label rather than a sentence, say nothing: a label is
  // not a goal, and an empty subtitle is more honest than a broken one.
  // A LIST MARKER, NOT A DATE. This stripped any trailing digits-and-dot, so
  // a body opening "Correction, 2026-09-23. This was filed twice…" rendered
  // as "Correction, 2026-09-" under the title — a truncated date as the first
  // thing under the outcome. A marker is one or two digits with WHITESPACE in
  // front of it; the 23 in a date has a hyphen.
  const trimmed = first.replace(/(?<=\s)\d{1,2}\.$/, '').trim();
  if (trimmed === '' || trimmed.endsWith(':')) {
    return null;
  }
  if (trimmed.length <= 180) {
    return trimmed;
  }
  // AT A WORD, NOT A CHARACTER. A hard slice ends the only sentence under the
  // outcome mid-word — "…and keep a record that it we…" — which reads as a
  // rendering fault rather than as an abbreviation. Cut back to the last
  // space, unless the first 180 characters contain no space at all (one
  // enormous token), where a hard cut is the only cut available.
  const hard = trimmed.slice(0, 179).trimEnd();
  const lastSpace = hard.lastIndexOf(' ');
  const body = lastSpace > 120 ? hard.slice(0, lastSpace) : hard;
  return `${body.replace(/[,;:]$/, '')}…`;
}

/**
 * DONE WHEN — the contract, where a person looks when they ask how close it is.
 *
 * The criteria were on the page and several screens down, inside the per-task
 * contracts, repeated once per attempt. Chris, 2026-09-22: *"You have very
 * good acceptance criteria buried way down the page. Bring them up."* They are
 * the answer to "how close are we?", so they sit with the state.
 *
 * Read off the request rather than the tasks: the contract belongs to the
 * work, not to whichever attempt happened to carry it — which is also why five
 * attempts used to render five copies of it. Whether each line holds is read
 * off the attempt that shipped (else the newest judged), through the one count
 * every surface shares (`libs/workspace/featureProof.ts`).
 */
/**
 * A criterion's state as a person reads it. `passed` needs evidence: a `met`
 * with nothing to open is a claim, and it reads Unverified until something
 * backs it (Chris, 2026-09-28: "no checkmark unless verified by evidence").
 */
export type CriterionState = 'unverified' | 'passed' | 'failed';

export type ReportCriterion = {
  statement: string;
  /** `met` null means nobody checked, which is not false. */
  met: boolean | null;
  /** What proves it, as QA or a person wrote it. */
  evidence: string | null;
  evidenceUrl: string | null;
  state: CriterionState;
  note: string | null;
  /** Where the state came from: the counted attempt's QA verdict, or a mark on the request. */
  from: 'verdict' | 'request' | null;
};

export type ReportAcceptance = {
  /** The work's own acceptance lines. */
  items: ReportCriterion[];
  /** The lines the plan's risks added to the contract, as their own group. */
  risks: ReportCriterion[];
  met: number;
  /** Acceptance lines that passed WITH evidence — the "N of M verified" figure. */
  verified: number;
  total: number;
  risksHandled: number;
  risksTotal: number;
  /** "2 plan risks handled", or null when the contract carried none. */
  risksLine: string | null;
  /** The attempt whose judgement is read: the one that shipped, else the newest judged. */
  attempt: { taskId: number; why: 'shipped' | 'judged' } | null;
  /** When the contract stopped being a draft. Null while it still is. */
  frozenAt: Date | null;
  /** Where the criteria were read: the work's own contract, or the newest task's when the work carries none. */
  source: 'request' | 'task' | null;
  /** How a reviewer checks it, when the plan or the record says. */
  procedure: string | null;
};

/**
 * The acceptance figure in one phrase: "6 of 6 · 2 plan risks handled".
 * @param a - The acceptance.
 */
export function acceptanceCount(a: Pick<ReportAcceptance, 'verified' | 'total' | 'risksLine'>): string {
  return `${a.verified} of ${a.total}${a.risksLine ? ` · ${a.risksLine}` : ''}`;
}

/**
 * The contract as the page reads it: {@link featureProof}, the one count the
 * Releases row and page read too, so the two cannot disagree.
 * @param request - The request record.
 * @param tasks - Its tasks: the attempt that shipped (or the newest judged) is read.
 * @param plans - Its plans, for the review procedure.
 * @param releases - The releases naming this work, for which attempt shipped.
 */
function buildAcceptance(request: ReportObject, tasks: ReportObject[] = [], plans: ReportObject[] = [], releases: ReportObject[] = []): ReportAcceptance {
  const proof = featureProof({ request, tasks, shippedTaskIds: shippedTaskIdsOf(releases) });
  const toItem = (c: ProofCriterion): ReportCriterion => ({
    statement: c.statement,
    met: c.state === 'passed' ? true : c.state === 'failed' ? false : null,
    evidence: c.evidence,
    evidenceUrl: c.evidenceUrl,
    state: c.state,
    note: c.note,
    from: c.from,
  });
  const plan = [...plans].sort((a, b) => b.id - a.id).find(p => str(p.meta, 'verification') !== null);
  return {
    items: proof.acceptance.map(toItem),
    risks: proof.risks.map(toItem),
    met: proof.proven,
    verified: proof.proven,
    total: proof.total,
    risksHandled: proof.risksHandled,
    risksTotal: proof.risksTotal,
    risksLine: risksLine(proof),
    attempt: proof.attempt ? { taskId: proof.attempt.taskId, why: proof.attempt.why } : null,
    frozenAt: asDate(request.meta.acceptanceFrozenAt),
    source: proof.source,
    procedure: (plan ? str(plan.meta, 'verification') : null) ?? str(request.meta, 'howWeCheck'),
  };
}

/**
 * Is this URL something an `img` can draw?
 * @param url
 * @param contentType
 */
function drawable(url: string | null, contentType: string | null): boolean {
  if (contentType !== null && contentType.startsWith('image/')) {
    return true;
  }
  return url !== null && (url.startsWith('data:image/') || /\.(?:png|jpe?g|gif|webp|svg)(?:\?|$)/i.test(url));
}

/**
 * WHAT TO DRAW for one artifact, so the page shows the thing rather than a
 * tile naming its type.
 *
 * A grey square reading "a document" is not a visual. If the evidence is a
 * picture, the picture; if it is a document, the document; if it is a link
 * out, the link — which is the only one a page cannot inline.
 * @param a - The artifact.
 */
function drawOf(a: ReportArtifact): { imageUrl: string | null; body: string | null } {
  const specUrl = str(a.spec, 'url');
  const url = a.url ?? specUrl;
  if (drawable(url, str(a.spec, 'contentType'))) {
    return { imageUrl: url, body: null };
  }
  const md = str(a.spec, 'md');
  return { imageUrl: null, body: md };
}

/**
 * WHICH DECISION THIS PAGE IS FOR, right now.
 *
 * The page used to render the whole lifecycle at once — plan, build, change,
 * QA, release, cost, history — with four of those saying "nothing has
 * happened yet" on work nobody had started. Chris, 2026-09-22: *"The core
 * issue is that the page is trying to be the operating surface and the audit
 * trail at the same time… you don't need to show the entire lifecycle
 * simultaneously to prove that the lifecycle exists."*
 *
 * So the page has a phase, and the phase decides what leads:
 *
 *   - `proposed` — the proposal. What we are changing, what it will look
 *     like, the plan, what counts as done, and the one button.
 *   - `building` — progress and exceptions. Nobody needs the mockup again.
 *   - `review` — the result and the evidence for it.
 *   - `released` — what shipped, and whether it worked.
 *
 * Everything else stays reachable and stops being in the way.
 */
/** The six stages a person sees, the same vocabulary as the Work board (`workQueue.stageOf`). */
export type ReportPhase = 'asked' | 'decided' | 'planned' | 'building' | 'qa' | 'released';

/** One step of the lifecycle, as the strip draws it. */
export type LifecycleStep = { key: string; label: string; state: 'done' | 'now' | 'todo' };

/**
 * The phase, read off the same records the state header reads.
 * @param request - The request.
 * @param input - Everything gathered.
 */
function buildPhase(input: FeatureReportInput): ReportPhase {
  if (input.releases.length > 0) {
    return 'released';
  }
  if (input.tasks.some(t => taskStatus(t) === 'accepted' || taskStatus(t) === 'awaiting_review') || input.artifacts.some(a => a.recordRole?.startsWith('qa-') === true)) {
    return 'qa';
  }
  if (input.workerRuns.length > 0 || input.tasks.some(t => t.status === 'dispatched' || t.status === 'claimed' || t.status === 'running') || str(input.request.meta, 'state') === 'building') {
    return 'building';
  }
  if (input.tasks.length > 0 || input.plans.length > 0) {
    return 'planned';
  }
  const state = str(input.request.meta, 'state');
  if (state === 'in_scope' || state === 'out_of_scope' || state === 'deferred' || state === 'answered' || input.request.meta.decidedAt) {
    return 'decided';
  }
  return 'asked';
}

/**
 * The strip: six stages, the current one marked, in the order a person
 * reads them — asked, decided, planned, building, QA, released. One
 * vocabulary with the Work board (review, 2026-09-24: "resolve the four-stage
 * versus six-stage language").
 * @param phase - The phase.
 */
function buildLifecycle(phase: ReportPhase): LifecycleStep[] {
  const order: Array<{ key: ReportPhase; label: string }> = [
    { key: 'asked', label: 'Asked' },
    { key: 'decided', label: 'Decided' },
    { key: 'planned', label: 'Planned' },
    { key: 'building', label: 'Building' },
    { key: 'qa', label: 'QA' },
    { key: 'released', label: 'Released' },
  ];
  const at = order.findIndex(o => o.key === phase);
  return order.map((o, i) => ({
    key: o.key,
    label: o.label,
    state: i < at ? 'done' : i === at ? 'now' : 'todo',
  }));
}

/**
 * HOW IT WORKS TODAY — the link to go and see it, and a shot of it as it is.
 *
 * Split out of Preview because they answer different questions: one is what
 * we propose, the other is what a person would find if they went and looked
 * right now. Kept together with the link, because a shot with no way to check
 * it against the running product is decoration (principle 10).
 * @param request - The request.
 * @param artifacts - Every artifact gathered for this work.
 */
function todaySection(request: ReportObject, artifacts: ReportArtifact[]): ReportSection {
  const s = blank('today', 'How it works today');
  const visuals = (request.meta.visuals ?? {}) as Record<string, unknown>;
  const surfaceUrl = str(visuals, 'surfaceUrl');
  // The screen as it is: a before-shot filed on the request, and the
  // screenshot a mockup was drawn on (`beforeArtifactIds` beside
  // `mockupArtifactIds`) — one picture of today, however it arrived.
  const drawnOn = Array.isArray(visuals.mockupArtifactIds) && visuals.mockupArtifactIds.length > 0 && Array.isArray(visuals.beforeArtifactIds)
    ? new Set(visuals.beforeArtifactIds.map(String))
    : new Set<string>();
  const shots = artifacts.filter(a => a.recordRole === 'before-shot' || drawnOn.has(String(a.id)));
  s.facts = surfaceUrl === null
    ? []
    : [{ label: 'See it live', value: surfaceUrl, href: surfaceUrl }];
  s.evidence = shots.map(a => ({
    id: a.id,
    kind: a.kind,
    ...drawOf(a),
    role: 'today',
    title: a.title,
    caption: str(a.spec, 'caption') ?? str(a.spec, 'description') ?? null,
    url: `/dashboard/artifacts/${a.id}`,
    at: a.createdAt,
  }));
  if (s.evidence.length === 0 && surfaceUrl === null) {
    s.absence = 'Nothing says where this lives on the running product, so there is no way to go and see what it does today.';
  }
  return s;
}

/**
 * WHICH WORK THIS IS, in one line above the fold.
 *
 * A reader could get four screens in without learning which product the work
 * was for. The breadcrumb says "Squatch Factory · Feature · #121", which
 * names the factory and a row id — neither of which is the product. Chris
 * asked for this in the first critique of the page and it was never built:
 * "Send · Major change · $24 spent · started 2d ago"*.
 *
 * Only what is recorded. A line that pads itself with "not recorded" is worse
 * than a short one.
 * @param request - The request.
 * @param summary - The computed summary, for spend and age.
 * @param now - The clock.
 */
function buildContext(request: ReportObject, summary: FeatureReportSummary, now: Date): string[] {
  const out: string[] = [];
  const product = str(request.meta, 'product');
  if (product !== null) {
    out.push(product.charAt(0).toUpperCase() + product.slice(1));
  }
  const size = str(request.meta, 'sizeClass');
  if (size !== null) {
    out.push(`${size} change`);
  }
  if (summary.totalCents > 0) {
    out.push(`${money(summary.totalCents)} spent`);
  }
  if (summary.askedAt !== null) {
    out.push(`asked ${formatAge(now.getTime() - summary.askedAt.getTime())}`);
  }
  return out;
}

/** Surfaces a person can see, and therefore owes a picture of. */
const VISIBLE_SURFACES: ReadonlySet<string> = new Set(['ui', 'flow']);

/** States that mean a person should expect to use the thing, so the after-shot is owed. */
const DONE_LIKE: ReadonlySet<string> = new Set(['shipped', 'accepted', 'released', 'answered']);

/**
 * WHAT THIS LOOKS LIKE — proposed before it is built, captured after it ships.
 *
 * The request type has carried `visuals` since the evidence gate shipped, and
 * nothing on this page has ever drawn it: a mockup could be filed against a
 * request and never appear anywhere a person reads the work. So the field
 * described a promise the product did not keep.
 *
 * Before and after are the same noun — a core artifact — because a mockup, a
 * flow diagram and an after-shot are all things that version, preview and can
 * be cited. They are separated by ROLE, not by type.
 * @param request - The request record.
 * @param artifacts - Every artifact gathered for this work.
 */
function visualsSection(request: ReportObject, artifacts: ReportArtifact[]): ReportSection {
  const s = blank('visuals', 'Preview');
  const visuals = (request.meta.visuals ?? {}) as Record<string, unknown>;
  const surface = str(request.meta, 'surface');
  const noVisualReason = str(visuals, 'noVisualReason');
  const ids = (key: string): Set<string> => {
    const raw = visuals[key];
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  };
  // THE PROPOSED DESIGN is `mockupArtifactIds`: the real screen with the
  // change drawn in (`draw_mockup`). Where a record has it, `beforeArtifactIds`
  // is the screenshot that mockup was drawn on — the screen today — and is
  // shown under How it works today. A record written before the split kept
  // its mockups on `beforeArtifactIds`, so without mockups that list is still
  // read as the proposal.
  const mockups = ids('mockupArtifactIds');
  const before = mockups.size > 0 ? mockups : ids('beforeArtifactIds');
  const after = ids('afterArtifactIds');
  // An artifact filed against the REQUEST is about the outcome; one filed
  // against a task is about the change and belongs to QA.
  const onRequest = artifacts.filter(a => a.recordType === 'object' && a.recordId === String(request.id));
  const pick = (want: Set<string>, role: string): ReportEvidence[] => artifacts
    .filter(a => want.has(String(a.id)) || (want.size === 0 && role === 'proposed' && onRequest.includes(a) && a.recordRole === 'proposal-visual'))
    .map(a => ({
      id: a.id,
      kind: a.kind,
      ...drawOf(a),
      role,
      title: a.title,
      caption: str(a.spec, 'caption') ?? str(a.spec, 'description') ?? null,
      url: `/dashboard/artifacts/${a.id}`,
      at: a.createdAt,
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime());

  // Preview is the MOCK — what we propose it will look like. What it looks
  // like today, and where to go and see that for yourself, is its own section
  // after the story: they answer different questions and were crowding each
  // other in one list.
  const isCurrent = (e: ReportEvidence): boolean => artifacts.some(a => a.id === e.id && a.recordRole === 'before-shot');
  const all = [...pick(before, 'proposed'), ...pick(after, 'shipped')];
  // A PICTURE LEADS. A visual that can only be opened somewhere else — a link
  // to a document living outside the product — cannot be looked at here, so
  // it sorts last however it was ordered on the record. On a phone it was the
  // first thing under Preview: a grey box reading "opens somewhere else"
  // where the mockup should have been.
  const drawable = (e: ReportEvidence): number => (e.imageUrl !== null ? 0 : e.body !== null ? 1 : 2);
  s.evidence = all.filter(e => !isCurrent(e)).sort((a, b) => drawable(a) - drawable(b));

  if (s.evidence.length === 0) {
    if (noVisualReason !== null) {
      s.absence = `Nothing to show, on purpose: ${noVisualReason}`;
      return s;
    }
    // The gate, said as a reading rather than as a rule. A surface nobody can
    // see owes nothing; one a person looks at owes a picture in both
    // directions, and which one is missing depends on where the work is.
    const done = DONE_LIKE.has(str(request.meta, 'state') ?? '');
    s.absence = surface !== null && VISIBLE_SURFACES.has(surface)
      ? done
        ? 'Nothing shows what this looks like now. A change a person can see is not finished until somebody has looked at it — an after-shot from the running product, or a written reason there is nothing to show.'
        : 'Nothing shows what this will look like. A mockup or a flow diagram is what a decision is made against; without one, approving this is approving a sentence.'
      : 'No visual is owed: this work does not change anything a person looks at.';
    return s;
  }
  if (before.size > 0 && after.size === 0 && DONE_LIKE.has(str(request.meta, 'state') ?? '')) {
    s.flags.push('This was proposed with a visual and closed without one. What was agreed can be seen; what shipped cannot.');
  }
  return s;
}

/**
 * The summary strip: asked, shipped, elapsed, total cost, how many human
 * decisions and how many attempts. Six figures, each read off a record.
 * @param input - The report's inputs.
 * @param line - The money line.
 */
function buildSummary(input: FeatureReportInput, line: MoneyLine): FeatureReportSummary {
  const askedAt = asDate(input.request.meta.askedAt) ?? input.request.createdAt;
  const shippedAt = input.releases
    .map(r => asDate(r.meta.releasedAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const end = shippedAt ?? input.now;
  const humanDecisions
    = input.asks.filter(a => a.decidedAt !== null && a.decidedBy !== null).length
      + input.actionRuns.filter(a => a.approvedByAgent === false && a.decidedAt !== null).length;
  // A ZERO IS A CLAIM. Do not make it out of an empty join.
  //
  // This strip said "0 attempts" on a work item showing five of them, "0
  // human decisions" on one a person had approved, and did it beside a real
  // cost and a real elapsed time — so the false figures wore the authority of
  // the true ones. Chris, 2026-09-22: *"That destroys trust much faster than
  // missing information would."*
  //
  // The rule: count zero only where the absence is itself the finding.
  // Nothing ran and nothing was queued → 0 attempts, honestly. Work that
  // plainly ran, with no run linked to it → we do not know, and the
  // contradiction below says the join is incomplete.
  const ranSomething = input.tasks.length > 0 || input.plans.length > 0;
  const decisionRecords = input.asks.length + input.actionRuns.length;
  return {
    askedAt,
    shippedAt,
    elapsed: askedAt ? formatDuration(end.getTime() - askedAt.getTime()) : null,
    elapsedOpen: shippedAt === null,
    totalCents: line.actualCents ?? line.runCents,
    humanDecisions: decisionRecords === 0 && ranSomething ? null : humanDecisions,
    attempts: input.workerRuns.length === 0 && ranSomething ? null : input.workerRuns.length,
  };
}

// ---------------------------------------------------------------------------
// The overview — what the page leads with (Chris, 2026-09-28)
//
// The reader is a product owner. The page says where the work is in a
// sentence, then the plan, the implementation, the acceptance and the release
// each as a few lines, and opens the full record of any of them in the
// preview pane. Everything below is derived from the same records the
// sections read; nothing is stored, and nothing is inferred across a stage.
// ---------------------------------------------------------------------------

/**
 * The plan's status in plain words, with contradictions resolved: a plan
 * whose column still says `candidate` and whose metadata carries an approval
 * IS approved — the approval is the later, more specific fact.
 * @param plan - The plan record.
 */
export function planStatusOf(plan: ReportObject): PlanStatus {
  // THE PLAN'S OWN STATUS WINS over the row's (backlog 038): a plan the
  // factory asked for is filed done for you, which marks the ROW approved (the
  // candidate was accepted as a record) while the plan itself is in review.
  const own = String(str(plan.meta, 'status') ?? '').toLowerCase();
  const raw = ['draft', 'in_review', 'approved', 'rejected', 'superseded'].includes(own) ? [own] : [plan.status, own].map(s => String(s ?? '').toLowerCase());
  if (plan.meta.supersededBy || raw.includes('superseded')) {
    return 'Superseded';
  }
  if (raw.includes('rejected')) {
    return 'Rejected';
  }
  if (asDate(plan.meta.approvedAt) || str(plan.meta, 'approvedBy') || raw.includes('approved')) {
    return 'Approved';
  }
  if (raw.includes('draft')) {
    return 'Draft';
  }
  return 'Awaiting approval';
}

/**
 * The first sentence of a passage, for a one-line summary.
 * @param text - The passage.
 */
function firstSentence(text: string | null): string | null {
  if (text === null) {
    return null;
  }
  const one = text.replace(/\s+/g, ' ').trim();
  const cut = one.search(/[.!?]\s+[A-Z0-9]/);
  const s = cut === -1 ? one : one.slice(0, cut + 1);
  return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s;
}

/**
 * The plan, as the page shows it.
 * @param input - The records.
 * @param planId - The plan a build would carry.
 */
function buildPlanSummary(input: FeatureReportInput, planId: number | null): ReportPlanSummary {
  const decision = planDecisionForRequest(input.tasks);
  const fromPlan = input.plans.map(p => str(p.meta, 'ruleLevel')).find(l => l !== null) ?? null;
  const requirement = decision !== null
    ? planLevelSentence(decision)
    : fromPlan === 'required' ? 'Yes — the plan rule asked for one' : fromPlan === 'offered' ? 'Optional' : fromPlan === 'none' ? 'No' : null;
  // The reasons themselves, so nothing says "listed below" and lists nothing:
  // the rule's triggers off the tasks, else what the plan recorded when written.
  const reasons = decision !== null && decision.triggers.length > 0
    ? [...new Set(decision.triggers.map(t => t.why))]
    : [...new Set(input.plans.flatMap(p => list(p.meta, 'ruleTriggers')))];
  const newest = [...input.plans].sort((a, b) => b.id - a.id);
  const current = newest.find(p => p.id === planId) ?? newest[0] ?? null;
  if (current === null) {
    return {
      planId: null,
      status: null,
      scope: null,
      approver: null,
      approvedAt: null,
      risk: null,
      steps: 0,
      requirement,
      reasons,
      approach: null,
      components: [],
      risks: [],
      href: null,
      absence: decision?.level === 'required'
        ? 'A plan was required and none is on the record.'
        : input.tasks.length > 0 ? 'No plan was written; the plan rule did not require one.' : 'No plan yet.',
    };
  }
  const status = planStatusOf(current);
  const recorded = str(current.meta, 'approvedBy');
  return {
    planId: current.id,
    status,
    scope: str(current.meta, 'scope') ?? str(current.meta, 'summary') ?? firstSentence(str(current.meta, 'approach')) ?? str(current.meta, 'title') ?? current.title,
    approver: status === 'Approved' ? (personName(recorded, input.people) ?? 'Approver unavailable') : null,
    approvedAt: asDate(current.meta.approvedAt),
    risk: list(current.meta, 'risks')[0] ?? null,
    steps: list(current.meta, 'components').length,
    requirement,
    reasons,
    approach: str(current.meta, 'approach'),
    components: list(current.meta, 'components'),
    risks: list(current.meta, 'risks'),
    href: (input.link ?? genericRecordLinker)({ objectType: 'architecture_plan', id: current.id }),
    absence: null,
  };
}

/**
 * One run as an attempt row.
 * @param run - The run.
 * @param now
 * @param n
 */
function attemptOf(run: ReportWorkerRun, now: Date, n = 1): ReportAttempt {
  const executed = executedRun(run);
  const outcome = !executed
    ? run.claimedAt === null ? 'Ended before it started — not executed' : 'Refused — not executed'
    : run.status === 'completed'
      ? 'Completed'
      : runIsLive(run)
        ? (run.status === 'paused' ? 'Paused' : run.claimedAt ? 'Running' : 'Queued')
        : run.status === 'cancelled' ? 'Cancelled' : 'Failed';
  const why = String(run.error ?? '').replace(/^verification failed: /, '').split('\n')[0]!.trim();
  const change = runChange(run);
  return {
    runId: run.id,
    outcome,
    tone: !executed ? 'muted' : statusTone(run.status),
    at: runAt(run),
    cents: run.cents,
    executed,
    ago: formatAge(now.getTime() - runAt(run).getTime()),
    why: why ? (why.length > 160 ? `${why.slice(0, 157).trimEnd()}…` : why) : null,
    prUrl: change.prUrl,
    checks: change.checks,
    n,
    live: executed ? runIsLive(run) : run.claimedAt === null && runIsLive(run),
  };
}

/**
 * The state, with the run carrying it as its row. A state whose one move was
 * "View progress" into the implementation gives that move to the row, which
 * opens the run itself; every other state keeps its own action.
 * @param status - The state as `buildStatus` said it.
 * @param impl - The implementation, for the live run.
 */
function withActiveRun(status: ReportStatus, impl: ReportImplementation): ReportStatus {
  const live = impl.attempts.find(a => a.live) ?? null;
  if (!live) {
    return { ...status, activeRun: null };
  }
  const viewProgress = status.action?.kind === 'drawer' && status.action.drawer === 'implementation';
  return { ...status, activeRun: { attempt: live, of: impl.attempts.length }, ...(viewProgress ? { action: null } : {}) };
}

/**
 * Build and the change, as one section.
 * @param input - The records (runs sorted oldest first).
 * @param mergedPrs - What the records say merged.
 * @param acceptance - The contract, for the ladder.
 * @param release - The release reading, for the ladder.
 * @param line - The money line.
 */
function buildImplementation(input: FeatureReportInput, mergedPrs: Set<string>, acceptance: ReportAcceptance, release: ReportReleaseSummary, line: MoneyLine): ReportImplementation {
  const runs = input.workerRuns;
  // The LATEST RELEVANT attempt leads: the newest run that did something,
  // else the newest run. A refusal after a real attempt does not bury it.
  const newestFirst = [...runs].reverse();
  const lead = newestFirst.find(r => runIsLive(r)) ?? newestFirst.find(executedRun) ?? newestFirst[0] ?? null;
  const taskPr = [...input.tasks].sort((a, b) => b.id - a.id).map(t => str(t.meta, 'prUrl')).find(p => p !== null) ?? null;
  const runPr = newestFirst.map(r => runChange(r).prUrl).find(p => p !== null) ?? null;
  const prUrl = taskPr ?? runPr;
  const merged = prUrl !== null && mergedPrs.has(prUrl);
  const leadChange = lead ? runChange(lead) : null;
  const taskChecks = input.tasks.flatMap(t => (Array.isArray(t.meta.checks) ? t.meta.checks as Array<Record<string, unknown>> : []).map(c => (typeof c?.passed === 'boolean' ? c.passed : null)));
  const checks = [...(leadChange?.checks.map(c => c.passed) ?? []), ...taskChecks];
  const spent = line.actualCents ?? (line.runCents > 0 ? line.runCents : null);
  const ladder: LadderStep[] = [
    {
      key: 'run',
      label: 'Run completed',
      ...(lead === null
        ? { value: 'No run yet', state: 'unknown' as const }
        : lead.status === 'completed'
          ? { value: 'Yes', state: 'yes' as const }
          : runIsLive(lead) ? { value: 'Running', state: 'unknown' as const } : { value: 'No', state: 'no' as const }),
    },
    {
      key: 'checks',
      label: 'Checks passed',
      ...(checks.length === 0 || checks.every(c => c === null)
        ? { value: 'Not reported', state: 'unknown' as const }
        : checks.includes(false) ? { value: 'Failed', state: 'no' as const } : { value: 'Passed', state: 'yes' as const }),
    },
    {
      key: 'merged',
      label: 'Merged',
      ...(prUrl === null
        ? { value: 'No pull request', state: 'unknown' as const }
        : merged ? { value: 'Yes', state: 'yes' as const } : { value: 'Not recorded as merged', state: 'unknown' as const }),
    },
    {
      key: 'acceptance',
      label: 'Acceptance verified',
      ...(acceptance.total === 0
        ? { value: 'No criteria', state: 'unknown' as const }
        : [...acceptance.items, ...acceptance.risks].some(i => i.state === 'failed')
            ? { value: acceptanceCount(acceptance), state: 'no' as const }
            : { value: acceptanceCount(acceptance), state: acceptance.verified === acceptance.total && acceptance.risksHandled === acceptance.risksTotal ? 'yes' as const : 'unknown' as const }),
    },
    {
      key: 'released',
      label: 'Released',
      value: release.label === 'Live' ? 'Live' : release.label === 'Not released' ? 'No' : 'Not verified',
      state: release.state === 'live' ? 'yes' : release.state === 'not_released' ? 'no' : 'unknown',
    },
  ];
  const estimate = line.estimateCents === null ? null : money(line.estimateCents);
  const variance = line.varianceCents === null
    ? null
    : `${line.varianceCents >= 0 ? '+' : '−'}${money(Math.abs(line.varianceCents))}${line.variancePct === null ? '' : ` (${line.variancePct >= 0 ? '+' : ''}${line.variancePct}%)`}`;
  const costLine = [
    spent === null ? 'Nothing spent yet' : `${money(spent)} spent`,
    estimate === null ? 'Not estimated' : variance === null ? `estimated ${estimate}` : `estimated ${estimate}, ${variance}`,
  ].join(' · ');
  return {
    latest: lead ? attemptOf(lead, input.now, runs.indexOf(lead) + 1) : null,
    earlier: Math.max(0, runs.length - (lead ? 1 : 0)),
    attempts: newestFirst.map((r, i) => attemptOf(r, input.now, runs.length - i)),
    prUrl,
    merged,
    ladder,
    spentCents: spent,
    costLine,
    absence: runs.length === 0
      ? input.tasks.length > 0 ? 'Queued for the engineer — no run has started yet.' : 'Nothing has been built yet.'
      : null,
  };
}

/**
 * Live, release not verified, or not released — never "not released" when
 * the truth is that nothing records a release (2026-09-28).
 * @param input - The records.
 * @param mergedPrs - What the records say merged.
 */
function buildReleaseSummary(input: FeatureReportInput, mergedPrs: Set<string>): ReportReleaseSummary {
  const surfaceUrl = str((input.request.meta.visuals ?? {}) as Record<string, unknown>, 'surfaceUrl');
  const shipped = input.releases
    .map(r => ({ r, at: asDate(r.meta.releasedAt) }))
    .filter((x): x is { r: ReportObject; at: Date } => x.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (shipped) {
    const name = [str(shipped.r.meta, 'product'), str(shipped.r.meta, 'version')].filter(Boolean).join(' ') || shipped.r.title;
    return {
      state: 'live',
      label: 'Live',
      sentence: `Live since ${formatStamp(shipped.at)}, in ${name}.`,
      at: shipped.at,
      href: surfaceUrl ?? (input.link ?? genericRecordLinker)({ objectType: 'release', id: shipped.r.id }),
    };
  }
  if (input.releases.length > 0) {
    return { state: 'unverified', label: 'Release not verified', sentence: 'A release record names this work and carries no shipped time.', at: null, href: (input.link ?? genericRecordLinker)({ objectType: 'release', id: input.releases[0]!.id }) };
  }
  const mergedSomething = input.tasks.some(t => str(t.meta, 'commitSha') !== null || taskStatus(t) === 'accepted') || [...mergedPrs].length > 0;
  if (mergedSomething || str(input.request.meta, 'state') === 'shipped') {
    return { state: 'unverified', label: 'Release not verified', sentence: 'Nothing records this change reaching people.', at: null, href: surfaceUrl };
  }
  return { state: 'not_released', label: 'Not released', sentence: 'Nothing has merged yet, so nothing can be live.', at: null, href: null };
}

/**
 * The verdict's count and note as the tail of a sentence: "; it proved 0 of
 * 8. One screenshot cannot show five states."
 * @param detail - The state's detail ("QA proved 0 of 8: …" or "QA sent it back").
 */
/**
 * A clause as the start of a sentence.
 * @param text - The clause.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function changesDetail(detail: string): string {
  const m = /^QA proved (\d+) of (\d+)(?::(.*))?$/.exec(detail);
  if (!m) {
    return '.';
  }
  const note = m[3]?.trim();
  return `; it proved ${m[1]} of ${m[2]}.${note ? ` ${note.replace(/([^.!?])$/, '$1.')}` : ''}`;
}

/**
 * WHERE THIS IS, IN A SENTENCE, AND THE ONE MOVE.
 *
 * The state (`buildState`) decides the case; this says it for a product owner:
 * what is known, what is not established, and an action that follows the
 * state — Build it before anything has started, View progress while it runs,
 * Review requested changes when QA sent it back, Review the merge when it is
 * ready, Open feature when it is live, Review delivery status when the
 * records disagree. Nothing here offers Build once a build is live.
 * @param input - The records.
 * @param state - The derived state.
 * @param ctx - The other derived parts.
 * @param ctx.canBuild - Whether Build is the next move.
 * @param ctx.canDismiss - Whether nothing has started yet.
 * @param ctx.plan - The plan summary.
 * @param ctx.impl - The implementation summary.
 * @param ctx.release - The release reading.
 * @param ctx.acceptance - The contract.
 * @param ctx.surfaceUrl - Where the running product shows it.
 * @param ctx.live - What is running for it now (the Now line).
 */
function buildStatus(input: FeatureReportInput, state: ReportState, ctx: { canBuild: boolean; canDismiss: boolean; plan: ReportPlanSummary; impl: ReportImplementation; release: ReportReleaseSummary; acceptance: ReportAcceptance; surfaceUrl: string | null; live?: LiveRun | null }): ReportStatus {
  const { canBuild, canDismiss, plan, impl, release, acceptance } = ctx;
  const live = ctx.live ?? null;
  const ago = (d: Date) => formatAge(input.now.getTime() - d.getTime());
  const verifiedLine = acceptance.total === 0 ? 'No acceptance criteria are written yet.' : `${acceptance.verified} of ${acceptance.total} acceptance criteria verified${acceptance.risksLine ? `; ${acceptance.risksLine}` : ''}.`;
  const buildLabel = input.workerRuns.some(executedRun) || input.tasks.length > 0 ? 'Build again' : plan.status === 'Awaiting approval' ? 'Approve build' : 'Build it';
  const inbox = state.decision ? inboxHref(state.decision.kind === 'ask' ? 'ask' : 'proposal', state.decision.id) : null;
  switch (state.key) {
    case 'blocked':
      return { tone: 'bad', headline: 'Blocked', sentence: `${state.question ?? 'Something is blocking this work'}. ${state.detail.charAt(0).toUpperCase()}${state.detail.slice(1)}.`, action: { kind: 'drawer', label: 'See what is blocking it', drawer: 'status' }, secondary: null, next: 'It moves again once the blocker is cleared.' };
    case 'decide':
      return { tone: 'warn', headline: 'Needs your decision', sentence: `A decision is waiting on you: ${state.question ?? 'an open question'}.`, action: inbox ? { kind: 'link', label: 'Review decision', href: inbox } : null, secondary: null, next: 'It moves on as soon as it is decided.' };
    case 'approve': {
      const merge = state.decision?.actionId === 'git.merge';
      const dispatch = state.decision?.actionId === 'factory.dispatch_task';
      return {
        tone: 'warn',
        headline: merge ? 'Ready to merge' : dispatch ? 'Build proposed' : 'Needs approval',
        sentence: merge
          ? `QA approved the change and it is waiting for you to merge. It is not live until it merges. ${verifiedLine}`
          : dispatch ? `A build card is waiting for your approval (action #${state.decision!.id}). Building it approves that card; nothing has run yet.` : `${state.question ?? 'An action'} is waiting for your approval.`,
        // The build card is approved HERE, not one page away: the press
        // approves the pending dispatch itself, with Undo (journey 4).
        action: dispatch
          ? { kind: 'build', label: 'Build it', runId: state.decision!.id }
          : inbox ? { kind: 'link', label: merge ? 'Review the merge' : 'Review & approve', href: inbox } : null,
        secondary: dispatch && inbox ? { kind: 'link', label: 'Open the card', href: inbox } : null,
        next: merge ? 'Merging it deploys it.' : dispatch ? 'Once it is approved, a worker picks it up and the engineer builds it.' : 'Once it is approved, the next step starts on its own.',
      };
    }
    case 'released':
      return release.state === 'live'
        ? {
            tone: 'ok',
            headline: 'Live',
            sentence: `${release.sentence} ${state.detail.includes('helped') ? `It ${state.detail.replace(/^live, and it /, '')}.` : 'Whether it helped has not been checked yet.'}`,
            action: ctx.surfaceUrl ? { kind: 'link', label: 'Open feature', href: ctx.surfaceUrl } : { kind: 'drawer', label: 'Open feature', drawer: 'release' },
            secondary: null,
            next: state.detail.includes('helped') ? null : 'Next, whether it helped is checked.',
          }
        : { tone: 'warn', headline: 'Release not verified', sentence: `${release.sentence} Whether it is live is not established.`, action: { kind: 'drawer', label: 'Review delivery status', drawer: 'release' }, secondary: null, next: null };
    case 'planning': {
      // The run writing the plan is the move while it writes; the plan is,
      // once one exists; before either, there is nothing to open.
      const action: ReportAction | null = live?.kind === 'planning'
        ? { kind: 'link', label: 'Watch the plan being written', href: live.runHref }
        : input.plans.length > 0 ? { kind: 'drawer', label: 'See the plan', drawer: 'plan' } : null;
      return { tone: 'info', headline: 'Planning', sentence: `A plan comes first because ${bare(state.detail)}. The build starts on its own once the plan is approved.`, action, secondary: null, next: 'The build starts when the plan is approved.' };
    }
    case 'recovering': {
      const started = impl.latest ? ` The latest run started ${ago(impl.latest.at)}.` : '';
      return { tone: 'info', headline: state.label, sentence: `${capitalise(bare(state.detail))}.${started} Nothing needs you; after three automatic attempts the factory stops and asks.`, action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: 'If this attempt passes, QA checks it; after three failed attempts the factory stops and asks.' };
    }
    case 'building': {
      // Queued is not building: no worker has taken it, so nothing "started".
      if (live?.kind === 'queued') {
        return { tone: 'info', headline: 'Waiting for a worker', sentence: `Queued for a worker ${ago(new Date(live.startedAt))}; no worker has picked it up yet. Nothing needs you.`, action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: 'A worker picks it up, then the engineer builds it and QA checks it.' };
      }
      const started = impl.latest ? `The latest run started ${ago(impl.latest.at)}.` : '';
      return { tone: 'info', headline: 'Building', sentence: `Building now. ${started} Nothing needs you; checks, the merge and acceptance are not established until it finishes.`.replace(/\s+/g, ' ').trim(), action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: 'QA checks it, then it merges and deploys.' };
    }
    case 'qa':
      if (state.label === 'CI failed' || state.label === 'Waiting for CI') {
        return { tone: state.label === 'CI failed' ? 'warn' : 'info', headline: state.label, sentence: `Engineering finished. ${capitalise(state.detail)}. Nothing needs you. ${verifiedLine}`, action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: state.label === 'CI failed' ? 'The next attempt builds with what CI found; QA checks it once CI is green.' : 'QA checks it once CI is green.' };
      }
      return { tone: 'info', headline: 'In QA', sentence: `Engineering finished and QA is checking the change. Nothing needs you. ${verifiedLine}`, action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: 'Once QA passes it, it merges and deploys.' };
    case 'merge':
      if (state.label === 'Merged') {
        return { tone: 'ok', headline: 'Merged', sentence: `QA approved it and it merged. Whether it is live is not established until a release records it. ${verifiedLine}`, action: impl.prUrl ? { kind: 'link', label: 'See the change', href: impl.prUrl } : { kind: 'drawer', label: 'See the change', drawer: 'implementation' }, secondary: null, next: 'The release is recorded once it is live.' };
      }
      if (!state.needsYou) {
        return { tone: 'info', headline: 'Merging', sentence: `QA approved it; it merges on its own on its trust rule. Nothing needs you. ${verifiedLine}`, action: impl.prUrl ? { kind: 'link', label: 'See the change', href: impl.prUrl } : { kind: 'drawer', label: 'See the change', drawer: 'implementation' }, secondary: null, next: 'It merges on its own, and the merge deploys it.' };
      }
      return { tone: 'warn', headline: 'Ready to merge', sentence: `QA accepted the change; it is waiting for a person to merge it. It is not live until it merges. ${verifiedLine}`, action: impl.prUrl ? { kind: 'link', label: 'Review the merge', href: impl.prUrl } : { kind: 'drawer', label: 'Review the merge', drawer: 'implementation' }, secondary: null, next: 'Merging it deploys it.' };
    case 'changes':
      return { tone: 'warn', headline: 'Changes requested', sentence: `QA found problems and sent it back${changesDetail(state.detail)} Nothing from this attempt has merged.`, action: { kind: 'drawer', label: 'Review requested changes', drawer: 'acceptance' }, secondary: canBuild ? { kind: 'build', label: 'Build again' } : null, next: 'Build again starts the next attempt with what QA found.' };
    case 'stuck':
      return { tone: 'warn', headline: state.label, sentence: state.label.startsWith('Stopped after') ? `${capitalise(bare(state.detail))}. A person decides what happens next; nothing from these attempts has merged.` : `${capitalise(bare(state.detail))}. Nothing from this attempt has merged.`, action: canBuild ? { kind: 'build', label: 'Build again' } : { kind: 'drawer', label: 'View run', drawer: 'implementation' }, secondary: canBuild ? { kind: 'drawer', label: 'View run', drawer: 'implementation' } : null, next: canBuild ? 'Nothing moves until someone builds it again.' : null };
    default:
      break;
  }
  // WAITING: not started, queued, or the records disagree.
  if (state.label === 'Unreadable') {
    return { tone: 'warn', headline: 'Records disagree', sentence: `${state.question ?? 'The records disagree.'} Whether it was built is not established.`, action: { kind: 'drawer', label: 'Review delivery status', drawer: 'status' }, secondary: null, next: null };
  }
  if (input.tasks.length > 0 && !canBuild) {
    return { tone: 'info', headline: 'Queued', sentence: 'Queued for the engineer; no run has started yet. Nothing needs you.', action: { kind: 'drawer', label: 'View progress', drawer: 'implementation' }, secondary: null, next: 'A worker picks it up, then the engineer builds it.' };
  }
  const reqState = str(input.request.meta, 'state');
  if (!canBuild) {
    const why = reqState === 'out_of_scope' ? 'It was dismissed' : reqState === 'deferred' ? 'It was deferred' : reqState === 'answered' ? 'It was answered without a build' : reqState === 'shipped' ? 'The record says shipped' : 'It is not open for a build';
    return { tone: 'muted', headline: 'Not being built', sentence: `${why}. ${str(input.request.meta, 'decisionReason') ?? ''}`.trim(), action: null, secondary: null, next: null };
  }
  const planLine = plan.status === 'Awaiting approval'
    ? ' Building it approves the plan.'
    : plan.status === 'Approved' ? ' The plan is approved.' : plan.status === null && plan.absence ? ` ${plan.absence}` : '';
  return {
    tone: 'muted',
    headline: 'Proposed',
    sentence: `Proposed and not built yet.${planLine}`,
    action: { kind: 'build', label: buildLabel },
    secondary: canDismiss ? { kind: 'dismiss', label: 'Dismiss' } : null,
    next: 'Nothing starts until someone builds it.',
  };
}

/** The current attempt: the newest task, its stage and the pull request it carries. */
type CurrentAttempt = { task: ReportObject | null; stage: string | null; prUrl: string | null; signals: PullSignals };

/**
 * The attempt the facts are about — the newest task — and what GitHub
 * recorded about its pull request.
 * @param input - The records.
 */
function currentAttempt(input: FeatureReportInput): CurrentAttempt {
  const task = [...input.tasks].sort((a, b) => b.id - a.id)[0] ?? null;
  if (!task) {
    return { task: null, stage: null, prUrl: null, signals: NO_PULL_SIGNALS };
  }
  const own = input.workerRuns.filter(r => Number((r.input?.record as { id?: unknown } | undefined)?.id) === task.id);
  const written = str(task.meta, 'prUrl') ?? [...own].reverse().map(r => runChange(r).prUrl).find(p => p !== null) ?? null;
  const prUrl = written ? normalisePullUrl(written) : null;
  return { task, stage: taskStatus(task), prUrl, signals: (prUrl && input.pulls?.get(prUrl)) || NO_PULL_SIGNALS };
}

/**
 * THE FACTS, EACH ON ITS OWN FIELD (backlog 044). A run that completed is the
 * engineer's attempt, not the feature: QA's verdict, the merge, CI and the
 * release are each read from the record that holds them and said as that.
 * @param input - The records.
 * @param ctx - What the report already derived.
 * @param ctx.mergedPrs - Pull requests the records say merged.
 * @param ctx.state - The report's state.
 * @param ctx.release - The release reading.
 * @param ctx.status - The report's status, for the request's line.
 */
function workFactsOf(input: FeatureReportInput, ctx: { mergedPrs: Set<string>; state: ReportState; release: ReportReleaseSummary; status: ReportStatus }): WorkFacts {
  const attempt = currentAttempt(input);
  const verdict = verdictFact(attempt.task ? { status: attempt.stage, meta: attempt.task.meta } : null);
  const pullRequest = pullFact(attempt.prUrl, attempt.signals, attempt.prUrl !== null && ctx.mergedPrs.has(attempt.prUrl));
  const ciFailure = attempt.task?.meta.ciFailure;
  const ci = ciFact(attempt.signals, { commit: attempt.task ? str(attempt.task.meta, 'commitSha') : null, ciFailure: ciFailure && typeof ciFailure === 'object' ? ciFailure as Record<string, unknown> : null }, pullRequest.label);
  const mergeRule = mergeRuleFact(input.mergeRule?.runsItself ?? null, input.mergeRule?.riskClass ?? null);
  const shipped = ctx.release.state === 'live';
  const recordState = str(input.request.meta, 'state');
  const stage = requestStageOf(ctx.state.key, {
    merged: pullRequest.merge === 'merged',
    shipped,
    closed: recordState !== null && recordState !== 'shipped' && ['deferred', 'answered', 'out_of_scope'].includes(recordState),
    decidingMerge: ctx.state.decision?.actionId === MERGE_ACTION_ID,
  });
  return {
    request: { id: input.request.id, stage, recordState, line: `${REQUEST_STAGE_LINE[stage]}. ${ctx.status.sentence}`.replace(/\s+/g, ' ').trim() },
    taskId: attempt.task?.id ?? null,
    verdict,
    pullRequest,
    ci,
    mergeRule,
    shipped,
    next: nextForAttempt({ verdict, pullRequest, ci, mergeRule, shipped, taskStage: attempt.stage }),
  };
}

/**
 * THE NOW LINE, from the records: the engineering runs this report already
 * read, and the agent runs working on the record. What an agent run is doing
 * is read from the stage — planning, or the change waiting on QA — never from
 * which automation started it (`libs/factory/liveStatus.ts`).
 * @param input - The records (runs sorted oldest first).
 * @param impl - The implementation, for each run's attempt number and the PR.
 */
function liveRunOf(input: FeatureReportInput, impl: ReportImplementation): LiveRun | null {
  const reviewing = input.tasks.some(t => taskStatus(t) === 'awaiting_review');
  return pickLive({
    workerRuns: input.workerRuns.map(r => ({ id: r.id, status: r.status, createdAt: r.createdAt, claimedAt: r.claimedAt, progress: r.progress, n: impl.attempts.find(a => a.runId === r.id)?.n ?? 1 })),
    missionRuns: input.missionRuns ?? [],
    context: {
      planning: recoveryStage(input.request.meta)?.stage === 'planning',
      reviewing: reviewing ? { pr: prLabel(impl.prUrl) } : null,
    },
  });
}

/** Timeline kinds a product owner reads; contracts and triage stay in the full log. */
const MEANINGFUL: ReadonlySet<TimelineEntry['kind']> = new Set(['asked', 'plan', 'decision', 'run', 'change', 'qa', 'release']);

/**
 * Assemble one request's whole story: the ten sections in reading order,
 * the timeline oldest first, the money line and whatever the records
 * disagree about.
 * @param input - Every record already gathered for this request.
 */
export function assembleFeatureReport(input: FeatureReportInput): FeatureReport {
  const runs = [...input.workerRuns].sort((a, b) => runAt(a).getTime() - runAt(b).getTime());
  const normalised: FeatureReportInput = { ...input, workerRuns: runs };
  const mergedPrs = mergedPullRequests(input.releases, input.actionRuns);
  // GitHub's own word counts too: a pull request `pr.merged` names merged.
  for (const [url, signals] of input.pulls ?? []) {
    if (signals.merged) {
      mergedPrs.add(url);
    }
  }
  const line = moneyLine(input.request, input.tasks, runs);
  // BUILD IS NEVER OFFERED OVER A LIVE BUILD (2026-09-28). A run still going,
  // or a dispatch still waiting to execute, means the work has started.
  const liveWork = runs.some(runIsLive)
    || input.actionRuns.some(a => a.actionId === 'factory.dispatch_task' && ['pending', 'approved', 'executing'].includes(a.status));
  const canBuild = !['shipped', 'answered', 'deferred', 'out_of_scope'].includes(String(input.request.meta.state ?? ''))
    && !liveWork
    // A task QA sent back (changes_requested) does not hold the build: the
    // next attempt is exactly what it asked for.
    // The task's stage is its status column first (taskStatus): a failed run
    // wrote "rejected" there and left the metadata copy at "dispatched",
    // which hid Build on #126 for good (2026-09-28).
    && (engineeringStopped(input) || !input.tasks.some(t => ['dispatched', 'running', 'awaiting_review', 'accepted'].includes(taskStatus(t))));
  // Dismiss is a way out of a PROPOSAL. Once any work started, the second
  // action is never "Dismiss" — throwing away an attempt is not what it says.
  const canDismiss = canBuild && input.tasks.length === 0 && runs.length === 0;
  const planId = [...input.plans].filter(p => !['rejected', 'superseded'].includes(String(p.meta.status ?? '')) && !p.meta.supersededBy).sort((a, b) => b.id - a.id)[0]?.id ?? null;
  const acceptance = buildAcceptance(input.request, input.tasks, input.plans, input.releases);
  const release = buildReleaseSummary(normalised, mergedPrs);
  const implementation = buildImplementation(normalised, mergedPrs, acceptance, release, line);
  const planSummary = buildPlanSummary(normalised, planId);
  const live = liveRunOf(normalised, implementation);
  const state = buildState(normalised, live, mergedPrs);
  const surfaceUrl = str((input.request.meta.visuals ?? {}) as Record<string, unknown>, 'surfaceUrl');
  const timeline = buildTimeline(normalised, mergedPrs);
  const notices = findNotices(normalised, mergedPrs, line);
  const status = withActiveRun(buildStatus(normalised, state, { canBuild, canDismiss, plan: planSummary, impl: implementation, release, acceptance, surfaceUrl, live }), implementation);
  const facts = workFactsOf(normalised, { mergedPrs, state, release, status });
  return {
    facts,
    requestId: input.request.id,
    canBuild,
    canDismiss,
    planId,
    status,
    live,
    you: youOf(state.needsYou, state.needsYou ? status.action?.label ?? null : null, state.question ?? state.detail),
    notices,
    planSummary,
    implementation,
    release,
    activityPreview: timeline
      .filter(e => MEANINGFUL.has(e.kind) && e.at !== null)
      .reverse()
      .slice(0, 4)
      // A run reads as an attempt, not as "Run 501 · task-engineer · …".
      .map(e => ({ ...e, title: e.kind === 'run' ? e.title.replace(/^Run \d+ · .+ · attempt (\S+) · (\w+)$/, 'Engineering attempt $1 $2') : e.title, ago: formatAge(input.now.getTime() - e.at!.getTime()) })),
    expectedBenefit: str(input.request.meta, 'expectedResult'),
    surfaceUrl,
    // THE PAGE LEADS WITH THE OUTCOME. The request title is the asker's
    // words and is evidence (`naming-the-work`), so it is never rewritten —
    // which meant every surface led with a situation. The outcome line says
    // what a person can do afterwards; the ask is kept underneath, verbatim.
    // The short name leads; the outcome sentence is the subtitle under it
    // (`goalOf`). A page titled with a sentence read like a ticket (Chris,
    // 2026-09-25: "Short title: Share a document").
    title: input.request.title,
    asked: input.request.title,
    story: str(input.request.meta, 'story'),
    state,
    phase: buildPhase(normalised),
    lifecycle: buildLifecycle(buildPhase(normalised)),
    // The ask's own body, trimmed to a sentence or two — not the whole prompt,
    // which belongs behind "the original request" in the ask section.
    goal: goalOf(input.request),
    acceptance,
    summary: buildSummary(normalised, line),
    context: buildContext(input.request, buildSummary(normalised, line), input.now),
    money: line,
    sections: [
      askSection(input.request),
      triageSection(input.request),
      visualsSection(input.request, input.artifacts),
      todaySection(input.request, input.artifacts),
      planSection(input.plans, input.tasks, runs.length > 0, input.people),
      contractSection(input.tasks),
      approvalsSection(input.asks, input.actionRuns, runs.length > 0),
      runsSection(runs, mergedPrs),
      changeSection(input.tasks, runs),
      qaSection(input.artifacts, input.tasks.length),
      releaseSection(input.releases),
      resultSection(normalised.request, normalised.releases.length > 0),
      moneySection(line),
    ],
    timeline,
    contradictions: notices.map(n => n.evidence),
    hero: visualsSection(input.request, input.artifacts).evidence.find(e => e.imageUrl !== null) ?? null,
    follow: followOf(input),
  };
}

/** The most topics the feature page follows for one report. */
const FEATURE_FOLLOW_CAP = 100;
/**
 * The most a status line follows: the records and the newest runs. A chat
 * can hold many microcards, and they share the tab's one stream.
 */
const STATUS_FOLLOW_CAP = 24;

/**
 * The live topics a report is made of — the records first (a task's runs
 * publish on the task's own topic too), then the runs, agent runs, asks,
 * cards and artifacts it draws, newest first, capped. Anything new under the
 * record moves the record itself (a rollup, a status), so a thing born after
 * this read is still heard.
 * @param input - The report's inputs.
 * @param cap - The most to follow.
 */
export function followOf(input: FeatureReportInput, cap = FEATURE_FOLLOW_CAP): string[] {
  const newest = <T extends { id: number }>(xs: readonly T[]) => [...xs].sort((a, b) => b.id - a.id);
  const topics = [
    liveTopic.record(input.request.id),
    ...[...input.tasks, ...input.plans, ...input.releases].map(r => liveTopic.record(r.id)),
    ...newest(input.workerRuns).map(r => liveTopic.run(r.id)),
    ...newest(input.missionRuns ?? []).map(m => liveTopic.mission(m.id)),
    ...newest(input.asks).map(a => liveTopic.ask(a.id)),
    ...newest(input.actionRuns).map(a => liveTopic.card(a.id)),
    ...newest(input.artifacts).map(a => liveTopic.artifact(a.id)),
  ];
  return [...new Set(topics)].slice(0, cap);
}

/**
 * A move as a surface OFF the record's page can follow it: a link as itself,
 * a drawer as the page with that drawer open in its pane, Build as the page's
 * decide block (a button on a page is not something a chat line can press).
 * @param action - The move.
 * @param href - The record's page.
 * @param requestId - The record, for the drawer's ref.
 */
function moveOf(action: ReportAction, href: string, requestId: number): StatusMove {
  if (action.kind === 'link') {
    return { label: action.label, href: action.href };
  }
  if (action.kind === 'drawer') {
    return { label: action.label, href: `${href}?preview=${encodeURIComponent(`feature_section:${requestId}.${action.drawer}`)}` };
  }
  return { label: action.label, href: `${href}#feature-decide` };
}

/**
 * THE THREE LINES, PORTABLE — the report's You, Now and Next as the API
 * returns them, the chat line polls them and the preview pane draws them.
 * @param report - The assembled report.
 * @param record - The record's type and its page.
 * @param record.objectType - Its type slug, as the record says.
 * @param record.href - Where it opens (`recordHref`).
 * @param now - When this was read.
 */
export function featureStatusOf(report: FeatureReport, record: { objectType: string; href: string }, now: Date): RecordStatus {
  const action = report.status.action;
  return {
    record: { id: report.requestId, objectType: record.objectType, title: report.title, href: record.href },
    stage: { key: report.state.key, label: report.status.headline, tone: report.status.tone },
    you: { ...report.you, move: report.you.needsYou && action ? moveOf(action, record.href, report.requestId) : null },
    live: report.live,
    next: report.status.next ?? null,
    facts: report.facts,
    readAt: now.toISOString(),
    ...(report.follow ? { follow: report.follow.slice(0, STATUS_FOLLOW_CAP) } : {}),
  };
}
