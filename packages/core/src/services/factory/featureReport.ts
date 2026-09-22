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

import type { PlanDecision, PlanRecord } from './planRule';
import { planRecordFromTask, planRequirementForTask } from './planRule';

/** A business object as the report reads it — request, task or release. */
export type ReportObject = {
  id: number;
  title: string;
  status: string | null;
  createdAt: Date | null;
  meta: Record<string, unknown>;
};

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
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: Record<string, unknown>;
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
  checks: ReportCheck[];
  /** Flags shown on the entry itself, e.g. the failed-run-merged-PR contradiction. */
  flags: string[];
};

/** A QA artifact as the gallery reads it. */
export type ReportEvidence = {
  id: number;
  role: string;
  title: string;
  caption: string | null;
  url: string | null;
  at: Date;
};

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export const REPORT_SECTION_KEYS = ['ask', 'triage', 'plan', 'contract', 'approvals', 'runs', 'change', 'qa', 'release', 'money'] as const;
export type ReportSectionKey = typeof REPORT_SECTION_KEYS[number];

export type ReportSection = {
  key: ReportSectionKey;
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
};

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

export type FeatureReport = {
  requestId: number;
  title: string;
  summary: FeatureReportSummary;
  money: MoneyLine;
  /** Where the work is and what it wants from a person — the top of the page. */
  state: ReportState;
  /** What this work is FOR, in the requester's own words. Null when nobody wrote one. */
  goal: string | null;
  sections: ReportSection[];
  /** Oldest first — a person reads top to bottom and the newest entry is last. */
  timeline: TimelineEntry[];
  /** Disagreements between records, stated rather than resolved. */
  contradictions: string[];
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
function blank(key: ReportSectionKey, title: string): ReportSection {
  return { key, title, absence: null, facts: [], lists: [], entries: [], checks: [], evidence: [], flags: [] };
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
    s.flags.push('The request carries no body — only its title, which is ours, not theirs.');
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
    s.absence = 'No one triaged this request; it is still in `new`.';
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
    s.flags.push('The twenty-percent test was never run on this request — no recommendation is on the record.');
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
  if (decision.level === 'required') {
    return `required, on ${decision.triggers.length} trigger${decision.triggers.length === 1 ? '' : 's'}`;
  }
  if (decision.level === 'offered') {
    return 'offered and skippable, with a recorded reason';
  }
  return 'not required';
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
function planSection(plans: ReportObject[], tasks: ReportObject[], hasRuns: boolean): ReportSection {
  const s = blank('plan', 'The plan');
  const decision = planDecisionForRequest(tasks);
  const recorded = tasks.map(task => ({ task, plan: planRecordFromTask(task.meta) }));
  const skips = recorded.filter(r => r.plan?.skipped === true);
  const carried = recorded.filter(r => r.plan !== null && r.plan.skipped !== true);

  s.facts = [
    { label: 'Was a plan required?', value: decision === null ? null : planLevelSentence(decision) },
    { label: 'Plans on record', value: plans.length === 0 ? 'none' : String(plans.length) },
  ];
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
      facts: [
        { label: 'The approach, and why this one', value: str(meta, 'approach'), format: 'quote' },
        { label: 'Written by', value: str(meta, 'writtenBy') },
        { label: 'Approved by', value: str(meta, 'approvedBy') ?? (plan.status === 'approved' ? 'not recorded' : 'nobody yet') },
        { label: 'Approved', value: asDate(meta.approvedAt) ? formatStamp(asDate(meta.approvedAt)) : null },
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
    for (const [key, label] of [['components', 'What changes, by component'], ['interfaces', 'Interfaces added or altered'], ['risks', 'What could go wrong, and what it would cost'], ['alternatives', 'Considered and rejected, and why']] as const) {
      const items = list(plan.meta, key);
      s.lists.push({ label: `${label} · plan ${plan.id}`, items: items.length > 0 ? items : [`This plan does not say. A plan that answers nothing here is a document, not a design.`] });
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
    s.absence = 'No task contract was written for this request; nothing was dispatched.';
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
  const s = blank('runs', 'The runs');
  if (runs.length === 0) {
    s.absence = 'No worker run is recorded against this work.';
    return s;
  }
  s.entries = runs.map((run) => {
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
      title: `Run ${run.id} · ${run.kind}`,
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
  const s = blank('qa', 'QA evidence');
  s.evidence = artifacts
    .map(a => ({ a, role: qaEvidenceRole(a) }))
    .filter((x): x is { a: ReportArtifact; role: QaEvidenceRole } => x.role !== null)
    .map(({ a, role }) => ({
      id: a.id,
      role,
      title: a.title,
      caption: str(a.spec, 'caption') ?? str(a.spec, 'description') ?? str(a.spec, 'summary'),
      url: evidenceUrl(a),
      at: a.createdAt,
    }))
    .sort((x, y) => x.at.getTime() - y.at.getTime());
  if (s.evidence.length === 0) {
    s.absence = taskCount === 0
      ? 'No QA evidence was captured for this task — there is no task to attach it to.'
      : 'No QA evidence was captured for this task.';
    s.flags.push('Evidence attaches as an artifact on the engineering task with `recordRole: qa-screenshot | qa-video | qa-report`. Nothing posts it yet.');
  }
  return s;
}

/**
 * The release — what the notes said, what the announcement said, when it
 * reached people and where.
 * @param releases - Releases carrying any of this work's tasks.
 */
function releaseSection(releases: ReportObject[]): ReportSection {
  const s = blank('release', 'The release');
  if (releases.length === 0) {
    s.absence = 'No release carries this task.';
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
  const estimateCents = taskEstimates.length > 0
    ? taskEstimates.reduce((a, b) => a + b, 0)
    : num(request.meta, 'estimateCents');
  const actualCents = taskActuals.length > 0
    ? taskActuals.reduce((a, b) => a + b, 0)
    : runs.length > 0 ? runCents : num(request.meta, 'actualCents');
  return {
    estimateCents,
    actualCents,
    varianceCents: estimateCents === null || actualCents === null ? null : actualCents - estimateCents,
    variancePct: estimateCents === null || actualCents === null || estimateCents === 0
      ? null
      : Math.round(((actualCents - estimateCents) / estimateCents) * 100),
    runCents,
    estimateSource: taskEstimates.length > 0
      ? `summed over ${taskEstimates.length} task contract${taskEstimates.length === 1 ? '' : 's'}`
      : num(request.meta, 'estimateCents') === null ? 'nobody estimated this' : 'the request rollup',
    actualSource: taskActuals.length > 0
      ? `summed over ${taskActuals.length} task${taskActuals.length === 1 ? '' : 's'}`
      : runs.length > 0 ? `summed over ${runs.length} worker run${runs.length === 1 ? '' : 's'}` : 'nothing has been charged',
  };
}

/**
 * The money section, from the line.
 * @param line - The computed money line.
 */
function moneySection(line: MoneyLine): ReportSection {
  const s = blank('money', 'Estimate against actual');
  s.facts = [
    { label: 'Estimated', value: line.estimateCents === null ? 'nobody estimated this' : money(line.estimateCents), format: 'money' },
    { label: 'Estimate from', value: line.estimateSource },
    { label: 'Actual', value: line.actualCents === null ? 'nothing has been charged' : money(line.actualCents), format: 'money' },
    { label: 'Actual from', value: line.actualSource },
    {
      label: 'Variance',
      value: line.varianceCents === null
        ? 'not computable without both figures'
        : `${line.varianceCents >= 0 ? '+' : ''}${money(line.varianceCents)}${line.variancePct === null ? '' : ` (${line.variancePct >= 0 ? '+' : ''}${line.variancePct}%)`}`,
      format: 'money',
    },
    { label: 'Charged across the runs', value: money(line.runCents), format: 'money' },
  ];
  return s;
}

/**
 * The pull requests the records say merged — a task with both a pull request
 * and a merge commit, or a pull request a release carries. Used only to flag
 * a run that disagrees; nothing in the report is inferred from it.
 * @param tasks - The tasks.
 * @param releases - The releases.
 */
function mergedPullRequests(tasks: ReportObject[], releases: ReportObject[]): Set<string> {
  const merged = new Set<string>();
  for (const task of tasks) {
    const pr = str(task.meta, 'prUrl');
    if (pr && str(task.meta, 'commitSha')) {
      merged.add(pr);
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
      href: `/dashboard/objects/${plan.id}`,
    });
    if (asDate(plan.meta.approvedAt)) {
      out.push({
        key: `plan-approved-${plan.id}`,
        at: asDate(plan.meta.approvedAt),
        kind: 'plan',
        title: `Plan approved by ${str(plan.meta, 'approvedBy') ?? 'nobody named on the record'}`,
        detail: null,
        cents: null,
        tone: 'ok',
        href: `/dashboard/objects/${plan.id}`,
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
        href: `/dashboard/objects/${task.id}`,
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
      href: `/dashboard/objects/${task.id}`,
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
    out.push({
      key: `run-${run.id}`,
      at: runAt(run),
      kind: 'run',
      title: `Run ${run.id} · ${run.agentSlug} · attempt ${run.attempt ?? '?'} · ${run.status}`,
      detail: run.summary ?? run.error,
      cents: run.cents,
      tone: statusTone(run.status),
      href: null,
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
      href: `/dashboard/objects/${release.id}`,
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
function findContradictions(input: FeatureReportInput, mergedPrs: Set<string>, line: MoneyLine): string[] {
  const out: string[] = [];
  for (const run of input.workerRuns) {
    const change = runChange(run);
    if (TERMINAL_BAD.has(run.status) && change.prUrl && mergedPrs.has(change.prUrl)) {
      out.push(`Run ${run.id} is recorded as ${run.status}, and its pull request ${change.prUrl} merged. Both facts stand; the worker's completion call can time out after the pull request is open.`);
    }
  }
  const rolledUp = input.tasks.map(t => num(t.meta, 'actualCents')).filter((n): n is number => n !== null);
  if (rolledUp.length > 0 && input.workerRuns.length > 0) {
    const sum = rolledUp.reduce((a, b) => a + b, 0);
    if (sum !== line.runCents) {
      out.push(`The tasks roll up ${money(sum)} spent and the worker runs charged ${money(line.runCents)}. One of the two is stale.`);
    }
  }
  const planDecision = planDecisionForRequest(input.tasks);
  if (planDecision?.level === 'required' && input.plans.length === 0 && input.workerRuns.length > 0) {
    const skipped = input.tasks.filter(t => planRecordFromTask(t.meta)?.skipped === true).length;
    out.push(`The plan rule required a plan for this work and none is on the record${skipped > 0 ? `, and ${skipped} task${skipped === 1 ? '' : 's'} recorded the plan as skipped` : ''}. ${input.workerRuns.length} worker run${input.workerRuns.length === 1 ? '' : 's'} ran anyway.`);
  }
  const firstRunAt = input.workerRuns.map(r => runAt(r)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  for (const plan of input.plans) {
    const approvedAt = asDate(plan.meta.approvedAt);
    if (approvedAt && firstRunAt && approvedAt.getTime() > firstRunAt.getTime()) {
      out.push(`Plan ${plan.id} was approved at ${formatStamp(approvedAt)}, after the first worker run started at ${formatStamp(firstRunAt)}. A plan approved after the work is a record, not a gate.`);
    }
  }
  for (const task of input.tasks) {
    if (task.status === 'accepted' && !str(task.meta, 'prUrl')) {
      out.push(`Task ${task.id} is accepted and carries no pull request.`);
    }
  }
  if (input.releases.length > 0 && input.tasks.every(t => t.status !== 'accepted')) {
    out.push('A release carries this work and no task is accepted.');
  }
  // The join that quietly became a zero. Tasks were written, and not one
  // worker run is linked to them — so every run-derived figure on this page
  // is reading an empty set, and says so rather than reading nothing as none.
  if (input.tasks.length > 0 && input.workerRuns.length === 0) {
    out.push(`Execution history is incomplete: ${input.tasks.length} task${input.tasks.length === 1 ? ' was' : 's were'} written for this work and no worker run is linked to ${input.tasks.length === 1 ? 'it' : 'them'}. Attempts, models and per-run cost are unreadable until that join is repaired.`);
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
  key: 'blocked' | 'approve' | 'building' | 'review' | 'releasable' | 'released' | 'waiting';
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
};

/**
 * Read the state off the records, in the order that decides it: a person
 * being asked something outranks everything, then a plan waiting for
 * approval, then work in flight, then work waiting to be looked at.
 * @param input - The report's inputs.
 * @param line - The money line, for nothing yet but kept for symmetry.
 */
function buildState(input: FeatureReportInput): ReportState {
  const openAsk = input.asks.find(a => a.decidedAt === null);
  if (openAsk) {
    return {
      key: 'blocked',
      label: 'Blocked',
      detail: 'waiting on you',
      needsYou: true,
      question: openAsk.title,
      action: { label: 'Review decision', href: '#report-approvals' },
    };
  }
  const pendingAction = input.actionRuns.find(a => a.decidedAt === null && a.approvedByAgent === false);
  if (pendingAction) {
    return {
      key: 'approve',
      label: 'Needs approval',
      detail: 'waiting on you',
      needsYou: true,
      question: `Approve ${pendingAction.actionId}?`,
      action: { label: 'Review & approve', href: '#report-approvals' },
    };
  }
  if (input.releases.length > 0) {
    return { key: 'released', label: 'Released', detail: 'live for people', needsYou: false, question: null, action: { label: 'See the release', href: '#report-release' } };
  }
  const running = input.workerRuns.filter(r => !TERMINAL_BAD.has(r.status) && r.status !== 'completed');
  if (running.length > 0) {
    return { key: 'building', label: 'Building', detail: 'no action needed', needsYou: false, question: null, action: { label: 'View progress', href: '#report-runs' } };
  }
  const accepted = input.tasks.filter(t => t.status === 'accepted');
  if (accepted.length > 0) {
    const hasEvidence = input.artifacts.length > 0;
    return hasEvidence
      ? { key: 'releasable', label: 'Ready to release', detail: 'waiting on you', needsYou: true, question: null, action: { label: 'Review release', href: '#report-release' } }
      : { key: 'review', label: 'Ready for review', detail: 'waiting on you', needsYou: true, question: null, action: { label: 'Review changes', href: '#report-qa' } };
  }
  return { key: 'waiting', label: 'Not started', detail: 'nothing has run yet', needsYou: false, question: null, action: null };
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

/**
 * Assemble one request's whole story: the ten sections in reading order,
 * the timeline oldest first, the money line and whatever the records
 * disagree about.
 * @param input - Every record already gathered for this request.
 */
export function assembleFeatureReport(input: FeatureReportInput): FeatureReport {
  const runs = [...input.workerRuns].sort((a, b) => runAt(a).getTime() - runAt(b).getTime());
  const normalised: FeatureReportInput = { ...input, workerRuns: runs };
  const mergedPrs = mergedPullRequests(input.tasks, input.releases);
  const line = moneyLine(input.request, input.tasks, runs);
  return {
    requestId: input.request.id,
    title: input.request.title,
    state: buildState(normalised),
    // The ask's own body, trimmed to a sentence or two — not the whole prompt,
    // which belongs behind "the original request" in the ask section.
    goal: str(input.request.meta, 'body') ?? str(input.request.meta, 'summary') ?? null,
    summary: buildSummary(normalised, line),
    money: line,
    sections: [
      askSection(input.request),
      triageSection(input.request),
      planSection(input.plans, input.tasks, runs.length > 0),
      contractSection(input.tasks),
      approvalsSection(input.asks, input.actionRuns, runs.length > 0),
      runsSection(runs, mergedPrs),
      changeSection(input.tasks, runs),
      qaSection(input.artifacts, input.tasks.length),
      releaseSection(input.releases),
      moneySection(line),
    ],
    timeline: buildTimeline(normalised, mergedPrs),
    contradictions: findContradictions(normalised, mergedPrs, line),
  };
}
