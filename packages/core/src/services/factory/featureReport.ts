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
  heartbeatAt?: Date | null;
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

export type FeatureReport = {
  requestId: number;
  title: string;
  summary: FeatureReportSummary;
  money: MoneyLine;
  /** Where the work is and what it wants from a person — the top of the page. */
  state: ReportState;
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

/** The recommended outcome, as a verb a person reads on the decision card. */
const OUTCOME_VERBS: Record<string, string> = { build: 'build it', answer: 'answer it', decline: 'decline it', merge: 'merge it into another request', defer: 'defer it' };

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
    { label: 'Plans on record', value: plans.length === 0 ? 'none' : String(plans.length) },
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
        { label: 'Approved by', value: str(meta, 'approvedBy') ?? (plan.status === 'approved' ? 'not recorded' : 'nobody yet') },
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
    s.absence = 'Nothing has been built yet — no worker run is recorded against this work.';
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
        ? `Latest attempt · run ${run.id}`
        : `Earlier attempt ${newestFirst.length - index} of ${newestFirst.length} · run ${run.id}, superseded`,
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
      s.flags.push('Did not help: this is a new request, not a closed one.');
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
        ? 'nobody estimated this'
        : taskEstimates.length === 1
          ? 'the one task contract written for it'
          : `added up from ${taskEstimates.length} attempt contracts — not an estimate of this work, so it is not compared against`,
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
      ? estimated ?? 'nobody estimated this'
      : estimated === null ? spent : `${spent} · estimated ${estimated}`,
    format: 'money',
  }];
  s.detailLists.push({
    label: 'How that is worked out',
    items: [
      `Estimate: ${estimated ?? 'nobody estimated this'} — ${line.estimateSource}.`,
      `Actual: ${spent ?? 'nothing has been charged'} — ${line.actualSource}.`,
      line.varianceCents === null
        ? 'Variance: not computable without both figures.'
        : `Variance: ${line.varianceCents >= 0 ? '+' : ''}${money(line.varianceCents)}${line.variancePct === null ? '' : ` (${line.variancePct >= 0 ? '+' : ''}${line.variancePct}%)`}.`,
      `Charged across the worker runs: ${money(line.runCents)}.`,
    ],
  });
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
  // The rollup and the rows disagree about whether any work was written.
  const written = num(input.request.meta, 'taskCount') ?? 0;
  if (written > 0 && input.tasks.length === 0) {
    out.push(`This work records ${written} task${written === 1 ? '' : 's'} written for it, and not one is linked to it. Everything below that reads off tasks — the plan, the contract, the change, the money — is reading an empty set.`);
  }
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
  key: 'blocked' | 'decide' | 'approve' | 'building' | 'qa' | 'merge' | 'released' | 'waiting';
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
 * @param line - The money line, for nothing yet but kept for symmetry.
 */
function buildState(input: FeatureReportInput): ReportState {
  // AN ACTUAL OBSTACLE FIRST, and only an actual obstacle reads as Blocked
  // (review, 2026-09-24). Waiting on a decision, on QA or on a merge are
  // waits with names; each says whose move it is in a plain sentence.
  const blocker = blockerOf(input.request.meta);
  if (blocker) {
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
  const pendingAction = input.actionRuns.find(a => a.decidedAt === null && a.approvedByAgent === false);
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
  const running = input.workerRuns.filter(r => !TERMINAL_BAD.has(r.status) && r.status !== 'completed');
  if (running.length > 0) {
    return { key: 'building', label: 'Building', detail: 'no action needed from you', needsYou: false, question: null, action: { label: 'View progress', href: '#report-runs' }, decision: null };
  }
  const accepted = input.tasks.filter(t => t.status === 'accepted');
  if (accepted.length > 0) {
    return { key: 'merge', label: 'Ready to merge', detail: 'QA approved; the merge is waiting on a person', needsYou: true, question: null, action: { label: 'Review the merge', href: '#report-qa' }, decision: null };
  }
  const awaitingReview = input.tasks.filter(t => t.status === 'awaiting_review');
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
 * attempts used to render five copies of it.
 */
export type ReportAcceptance = {
  /** Each criterion and whether it holds. `met` null means nobody checked, which is not false. */
  items: Array<{ statement: string; met: boolean | null; evidenceUrl: string | null }>;
  met: number;
  total: number;
  /** When the contract stopped being a draft. Null while it still is. */
  frozenAt: Date | null;
};

/**
 * The contract as the page reads it.
 * @param request - The request record.
 */
function buildAcceptance(request: ReportObject): ReportAcceptance {
  const raw = Array.isArray(request.meta.acceptance) ? request.meta.acceptance : [];
  const items = raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map(c => ({
      statement: str(c, 'statement') ?? 'an unnamed criterion',
      met: typeof c.met === 'boolean' ? c.met : null,
      evidenceUrl: str(c, 'evidenceUrl'),
    }));
  return {
    items,
    met: items.filter(i => i.met === true).length,
    total: items.length,
    frozenAt: asDate(request.meta.acceptanceFrozenAt),
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
  if (input.tasks.some(t => t.status === 'accepted' || t.status === 'awaiting_review') || input.artifacts.some(a => a.recordRole?.startsWith('qa-') === true)) {
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
  const shots = artifacts.filter(a => a.recordRole === 'before-shot');
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
  const before = ids('beforeArtifactIds');
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
    state: buildState(normalised),
    phase: buildPhase(normalised),
    lifecycle: buildLifecycle(buildPhase(normalised)),
    // The ask's own body, trimmed to a sentence or two — not the whole prompt,
    // which belongs behind "the original request" in the ask section.
    goal: goalOf(input.request),
    acceptance: buildAcceptance(input.request),
    summary: buildSummary(normalised, line),
    context: buildContext(input.request, buildSummary(normalised, line), input.now),
    money: line,
    sections: [
      askSection(input.request),
      triageSection(input.request),
      visualsSection(input.request, input.artifacts),
      todaySection(input.request, input.artifacts),
      planSection(input.plans, input.tasks, runs.length > 0),
      contractSection(input.tasks),
      approvalsSection(input.asks, input.actionRuns, runs.length > 0),
      runsSection(runs, mergedPrs),
      changeSection(input.tasks, runs),
      qaSection(input.artifacts, input.tasks.length),
      releaseSection(input.releases),
      resultSection(normalised.request, normalised.releases.length > 0),
      moneySection(line),
    ],
    timeline: buildTimeline(normalised, mergedPrs),
    contradictions: findContradictions(normalised, mergedPrs, line),
    hero: visualsSection(input.request, input.artifacts).evidence.find(e => e.imageUrl !== null) ?? null,
  };
}
