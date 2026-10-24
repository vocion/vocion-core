/**
 * THE ENGINE SCOREBOARD (ADR 0005). One row per engineering run, in one shape
 * whichever engine did it, so engines are compared on the same terms: what it
 * cost, how long it took, how big the change was, whether the guard had to
 * stop it, and where the work ended up (a pull request, QA's verdict, a
 * person's acceptance, the merge, a revert).
 *
 * A factory row is read from its worker_run and the engineering task the run
 * built: `syncEngineRuns` upserts them, and is called when a run ends and
 * before the scoreboard is read, so an outcome that arrives later (QA, the
 * merge, a revert) is on the board without any other code having to know the
 * board exists. Idempotent: a row is the same however often it is synced.
 *
 * An eval row is imported from the runner's eval harness
 * (packages/runner/eval results/<label>/runs.jsonl) by `importEvalRuns`, in
 * the same shape, `source: 'eval'`.
 *
 * Nothing here decides anything. The router (`engineRouter.ts`) may read the
 * board one day; a promotion stays a person's call.
 */

import type { WorkerRun } from '@/services/WorkerRunService';
import { and, desc, eq, getTableColumns, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { businessObjectSchema, engineRunSchema, workerRunSchema } from '@/models/Schema';
import { complexityOf } from './engineRouter';

type Meta = Record<string, unknown>;
type NewEngineRun = typeof engineRunSchema.$inferInsert;
export type EngineRunRow = typeof engineRunSchema.$inferSelect;

/** Where a run's work ended up: the board's one word. */
export type EngineRunOutcome = 'running' | 'failed' | 'cancelled' | 'no_pr' | 'pr_opened' | 'qa_failed' | 'qa_passed' | 'accepted' | 'rejected' | 'merged' | 'reverted' | 'superseded';

const obj = (v: unknown): Meta => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * `owner/name` from a clone URL or an `owner/name`.
 * @param repo - The contract's repo.
 */
export function repoName(repo: unknown): string | null {
  const s = text(repo);
  if (!s) {
    return null;
  }
  const m = /^https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/.exec(s);
  return m ? m[1]! : s;
}

/** What the engineering task says about the work, for the run that built it. */
export type TaskFacts = {
  /** The task's status: accepted, rejected, review_failed, changes_requested, … */
  status: string | null;
  /** QA's verdict value: approve | changes | reject. */
  verdict: string | null;
  prUrl: string | null;
  /** merged | open | closed, as the reconciler stamped it. */
  prState: string | null;
};

/**
 * Where a run's work ended up.
 * @param r - The run and its task.
 * @param r.status - The worker_run's status.
 * @param r.prUrl - The run's own pull request.
 * @param r.latest - Whether this is the task's latest run (only it carries the task's outcome).
 * @param r.task - The task's facts.
 * @param r.merged - The run's pull request merged.
 * @param r.reverted - A revert of the run's pull request was opened.
 */
export function outcomeOf(r: { status: string; prUrl: string | null; latest: boolean; task: TaskFacts | null; merged: boolean; reverted: boolean }): EngineRunOutcome {
  if (['queued', 'running', 'paused', 'awaiting_review'].includes(r.status)) {
    return 'running';
  }
  if (r.status === 'cancelled') {
    return 'cancelled';
  }
  if (r.reverted) {
    return 'reverted';
  }
  if (r.merged) {
    return 'merged';
  }
  if (!r.latest) {
    return r.prUrl ? 'superseded' : r.status === 'completed' ? 'no_pr' : 'failed';
  }
  const t = r.task;
  if (t?.status === 'accepted') {
    return 'accepted';
  }
  if (t?.status === 'rejected' || t?.status === 'abandoned') {
    return 'rejected';
  }
  if (t?.verdict === 'approve') {
    return 'qa_passed';
  }
  if (t?.verdict === 'changes' || t?.verdict === 'reject' || t?.status === 'review_failed' || t?.status === 'changes_requested') {
    return 'qa_failed';
  }
  if (r.status === 'failed' || r.status === 'lost') {
    return 'failed';
  }
  return r.prUrl ? 'pr_opened' : 'no_pr';
}

/**
 * A factory run's row, from the worker_run and its task. Pure.
 * @param run - The worker_run.
 * @param ctx - What the run's task says, and where the run sits among its task's runs.
 * @param ctx.task - The task's facts, or null when the record is gone.
 * @param ctx.attempt - 1 for the task's first run.
 * @param ctx.runsOfTask - How many runs the task has had.
 * @param ctx.reverted - Whether a revert of the run's pull request was opened.
 */
export function engineRunFromWorkerRun(run: Pick<WorkerRun, 'id' | 'orgId' | 'agentSlug' | 'status' | 'model' | 'input' | 'result' | 'counts' | 'cents' | 'claimedAt' | 'createdAt' | 'completedAt'>, ctx: { task: TaskFacts | null; attempt: number; runsOfTask: number; reverted: boolean }): NewEngineRun {
  const input = obj(run.input);
  const contract = obj(input.task);
  const route = obj(input.route);
  const result = obj(run.result);
  const usage = obj(result.token_usage);
  const counts = obj(run.counts);
  const diff = obj(result.diff_stat);
  const engine = text(result.engine) ?? text(route.engine) ?? text(obj(contract.engine).id) ?? 'claude-cli';
  const prUrl = text(result.pr_url) ?? text(result.prUrl);
  const latest = ctx.attempt === ctx.runsOfTask;
  const merged = Boolean(prUrl && ctx.task?.prState === 'merged' && ctx.task.prUrl === prUrl);
  const checks = Array.isArray(result.checks) ? result.checks.map(obj) : null;
  const filesChanged = Array.isArray(result.files_changed) ? result.files_changed.length : null;
  const files = num(diff.files) ?? filesChanged;
  const lines = num(diff.insertions) === null ? null : (num(diff.insertions) ?? 0) + (num(diff.deletions) ?? 0);
  const startedAt = run.claimedAt ?? run.createdAt;
  const endedAt = run.completedAt;
  const durationS = num(result.elapsed_s) ?? (startedAt && endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null);
  const taskId = num(obj(input.record).id);
  const requestId = num(input.requestId) ?? (/^\d+$/.test(String(contract.request_id ?? '')) ? Number(contract.request_id) : null);
  const outcome = outcomeOf({ status: run.status, prUrl, latest, task: ctx.task, merged, reverted: ctx.reverted });
  return {
    orgId: run.orgId,
    source: 'factory',
    workerRunId: run.id,
    engine,
    model: text(usage.model) ?? run.model ?? text(obj(contract.engine).model) ?? text(obj(contract.model_policy).model),
    seat: run.agentSlug,
    routePolicy: text(route.policy),
    routeReason: text(route.reason),
    routeSelector: text(route.selector) ?? (text(route.policy) ? 'static' : null),
    routeDetail: Object.keys(obj(route.jev)).length > 0 ? obj(route.jev) : null,
    taskId,
    requestId,
    repo: repoName(contract.repo),
    baseBranch: text(contract.base_branch) ?? 'main',
    riskClass: text(contract.risk_class),
    status: run.status,
    startedAt,
    endedAt,
    durationS,
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cents: run.cents ?? 0,
    prUrl,
    checksPassed: checks ? checks.filter(c => c.status === 'passed').length : null,
    checksTotal: checks ? checks.length : null,
    qaVerdict: latest ? ctx.task?.verdict ?? null : null,
    accepted: latest && ctx.task ? (ctx.task.status === 'accepted' || merged ? true : ctx.task.status === 'rejected' || ctx.task.status === 'abandoned' ? false : null) : null,
    merged,
    reverted: ctx.reverted,
    outcome,
    attempt: ctx.attempt,
    retries: ctx.runsOfTask - ctx.attempt,
    guardViolations: num(counts.guardDenials) ?? num(counts.permissionDenials) ?? 0,
    filesTouched: files,
    linesAdded: num(diff.insertions),
    linesRemoved: num(diff.deletions),
    complexity: files === null ? null : complexityOf(files, lines),
  };
}

/** How far back a sync reads runs. */
const SYNC_DAYS = 90;
/** The most runs one sync reads. */
const SYNC_LIMIT = 1000;
/** Rows per insert. */
const SYNC_BATCH = 200;

/** On a re-sync, every column but the row's identity takes the new value. */
const EXCLUDED = Object.fromEntries(
  Object.entries(getTableColumns(engineRunSchema))
    .filter(([key]) => !['id', 'orgId', 'source', 'workerRunId', 'evalKey', 'createdAt'].includes(key))
    .map(([key, col]) => [key, sql.raw(`excluded."${col.name}"`)]),
);

/**
 * Write the board's rows for an org's factory runs: every engineering run
 * (one whose input carries a task contract) in the window, or only a task's.
 * Idempotent; written in batches.
 * @param orgId - The workspace.
 * @param opts - What to sync.
 * @param opts.taskId - Only this task's runs.
 * @param opts.now - The clock.
 * @returns How many rows were written.
 */
export async function syncEngineRuns(orgId: string, opts: { taskId?: number; now?: Date } = {}): Promise<number> {
  const since = new Date((opts.now ?? new Date()).getTime() - SYNC_DAYS * 86_400_000);
  const runs = await db.select().from(workerRunSchema).where(and(
    eq(workerRunSchema.orgId, orgId),
    gte(workerRunSchema.createdAt, since),
    sql`jsonb_typeof(${workerRunSchema.input} -> 'task') = 'object'`,
    ...(opts.taskId ? [sql`(${workerRunSchema.input} -> 'record' ->> 'id') = ${String(opts.taskId)}`] : []),
  )).orderBy(desc(workerRunSchema.id)).limit(SYNC_LIMIT);
  if (runs.length === 0) {
    return 0;
  }
  // Each task's runs in order: the attempt number and the retries after it.
  const byTask = new Map<number, number[]>();
  for (const r of runs) {
    const t = num(obj(obj(r.input).record).id);
    if (t !== null) {
      byTask.set(t, [...(byTask.get(t) ?? []), r.id]);
    }
  }
  for (const ids of byTask.values()) {
    ids.sort((a, b) => a - b);
  }
  const taskIds = [...byTask.keys()];
  const tasks = new Map<number, TaskFacts>();
  if (taskIds.length > 0) {
    const rows = await db.select({ id: businessObjectSchema.id, status: businessObjectSchema.status, meta: businessObjectSchema.metadata })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, taskIds)));
    for (const t of rows) {
      const m = obj(t.meta);
      tasks.set(t.id, { status: text(m.status) ?? text(t.status), verdict: text(obj(m.verdict).value), prUrl: text(m.prUrl), prState: text(m.prState) });
    }
  }
  // A revert of a run's pull request: any record whose pipeline change reverts it.
  const prUrls = runs.map(r => text(obj(r.result).pr_url)).filter((u): u is string => u !== null);
  const reverted = new Set<string>();
  if (prUrls.length > 0) {
    const reverts = await db.select({ url: sql<string | null>`${businessObjectSchema.metadata} -> 'pipelineChange' ->> 'reverts'` })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(sql`${businessObjectSchema.metadata} -> 'pipelineChange' ->> 'reverts'`, prUrls)));
    for (const r of reverts) {
      if (r.url) {
        reverted.add(r.url);
      }
    }
  }
  const now = opts.now ?? new Date();
  // Oldest first, so a new run's row is written after the ones before it.
  const rows = [...runs].sort((a, b) => a.id - b.id).map((r) => {
    const t = num(obj(obj(r.input).record).id);
    const ids = t === null ? [r.id] : byTask.get(t)!;
    return {
      ...engineRunFromWorkerRun(r, {
        task: t === null ? null : tasks.get(t) ?? null,
        attempt: ids.indexOf(r.id) + 1,
        runsOfTask: ids.length,
        reverted: reverted.has(text(obj(r.result).pr_url) ?? ''),
      }),
      updatedAt: now,
    };
  });
  let written = 0;
  for (let i = 0; i < rows.length; i += SYNC_BATCH) {
    const batch = rows.slice(i, i + SYNC_BATCH);
    await db.insert(engineRunSchema).values(batch).onConflictDoUpdate({ target: engineRunSchema.workerRunId, set: EXCLUDED });
    written += batch.length;
  }
  return written;
}

/**
 * Bring a run's row (and its task's other runs, whose retries it changes) up
 * to date as it ends. Never throws: the board is never why a run's end fails.
 * @param run - The worker_run as written.
 */
export async function recordEngineRun(run: Pick<WorkerRun, 'orgId' | 'input'>): Promise<void> {
  const input = obj(run.input);
  if (!input.task || typeof input.task !== 'object') {
    return;
  }
  const taskId = num(obj(input.record).id);
  try {
    await syncEngineRuns(run.orgId, taskId === null ? {} : { taskId });
  } catch (error) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('engine scoreboard: a run could not be recorded', { orgId: run.orgId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** One engine's line on the board. */
export type EngineScore = {
  engine: string;
  source: string;
  runs: number;
  /** Runs still going, which the rates leave out. */
  running: number;
  prs: number;
  qaPassed: number;
  qaFailed: number;
  accepted: number;
  merged: number;
  reverted: number;
  failed: number;
  /** Of the finished runs, the share that opened a pull request. */
  prRate: number | null;
  /** Of the runs QA judged, the share it passed (passed, accepted, merged count as passed). */
  qaPassRate: number | null;
  /** Of the runs with a settled outcome, the share accepted or merged, and not reverted. */
  acceptRate: number | null;
  medianDurationS: number | null;
  totalCents: number;
  /** Total spend over merged-or-accepted runs: what a landed change costs. */
  centsPerLanded: number | null;
  guardViolations: number;
  retries: number;
  models: string[];
  byComplexity: Record<string, number>;
  /**
   * Who chose this engine's runs (ADR 0006): `jev`, `static`, and of the
   * static ones, how many were a Jev fallback (asked, or keyed, but not used).
   */
  selectors: { jev: number; static: number; fallback: number };
};

const rate = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

/**
 * The board: one line per engine and source, from its rows. Pure.
 * @param rows - The rows.
 */
export function scoreboardOf(rows: ReadonlyArray<Pick<EngineRunRow, 'engine' | 'source' | 'model' | 'outcome' | 'prUrl' | 'durationS' | 'cents' | 'guardViolations' | 'retries' | 'complexity' | 'attempt'> & Partial<Pick<EngineRunRow, 'routeSelector' | 'routeDetail'>>>): EngineScore[] {
  const groups = new Map<string, typeof rows[number][]>();
  for (const r of rows) {
    const k = `${r.engine}\u0000${r.source}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: EngineScore[] = [];
  for (const list of groups.values()) {
    const done = list.filter(r => r.outcome !== 'running');
    const count = (...o: EngineRunOutcome[]) => done.filter(r => (o as string[]).includes(r.outcome)).length;
    const landed = count('accepted', 'merged');
    const qaPassed = count('qa_passed', 'accepted', 'merged');
    const qaFailed = count('qa_failed', 'rejected');
    const settled = count('accepted', 'merged', 'rejected', 'reverted', 'qa_failed', 'failed', 'no_pr');
    const durations = done.map(r => r.durationS).filter((d): d is number => d !== null).sort((a, b) => a - b);
    const totalCents = list.reduce((s, r) => s + (r.cents ?? 0), 0);
    const byComplexity: Record<string, number> = {};
    for (const r of list) {
      byComplexity[r.complexity ?? 'unknown'] = (byComplexity[r.complexity ?? 'unknown'] ?? 0) + 1;
    }
    out.push({
      engine: list[0]!.engine,
      source: list[0]!.source,
      runs: list.length,
      running: list.length - done.length,
      prs: done.filter(r => r.prUrl).length,
      qaPassed,
      qaFailed,
      accepted: count('accepted'),
      merged: count('merged'),
      reverted: count('reverted'),
      failed: count('failed'),
      prRate: rate(done.filter(r => r.prUrl).length, done.length),
      qaPassRate: rate(qaPassed, qaPassed + qaFailed),
      acceptRate: rate(landed, settled),
      medianDurationS: durations.length ? durations[Math.floor((durations.length - 1) / 2)]! : null,
      totalCents,
      centsPerLanded: landed > 0 ? Math.round(totalCents / landed) : null,
      guardViolations: list.reduce((s, r) => s + (r.guardViolations ?? 0), 0),
      retries: list.filter(r => r.attempt > 1).length,
      models: [...new Set(list.map(r => r.model).filter((m): m is string => Boolean(m)))].sort(),
      byComplexity,
      selectors: {
        jev: list.filter(r => r.routeSelector === 'jev').length,
        static: list.filter(r => r.routeSelector !== 'jev').length,
        fallback: list.filter(r => r.routeSelector !== 'jev' && typeof r.routeDetail?.fallback === 'string').length,
      },
    });
  }
  return out.sort((a, b) => a.source.localeCompare(b.source) || b.runs - a.runs);
}

/**
 * The org's board, brought up to date first.
 * @param orgId - The workspace.
 * @param opts - The window and the source.
 * @param opts.days - How many days back (default 30).
 * @param opts.source - `factory` | `eval`; both when omitted.
 * @param opts.now - The clock.
 */
export async function loadEngineScoreboard(orgId: string, opts: { days?: number; source?: string; now?: Date } = {}): Promise<{ since: string; engines: EngineScore[] }> {
  await syncEngineRuns(orgId, { now: opts.now });
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 30) * 86_400_000);
  const rows = await db.select().from(engineRunSchema).where(and(
    eq(engineRunSchema.orgId, orgId),
    gte(engineRunSchema.createdAt, since),
    ...(opts.source ? [eq(engineRunSchema.source, opts.source)] : []),
  ));
  return { since: since.toISOString(), engines: scoreboardOf(rows) };
}

/**
 * The org's rows, newest first.
 * @param orgId - The workspace.
 * @param opts - Filters and paging.
 * @param opts.engine - One engine's.
 * @param opts.source - One source's.
 * @param opts.since - Only rows written since then.
 * @param opts.limit - Page size.
 * @param opts.offset - Page start.
 */
export async function listEngineRuns(orgId: string, opts: { engine?: string; source?: string; since?: Date; limit?: number; offset?: number } = {}): Promise<EngineRunRow[]> {
  return db.select().from(engineRunSchema).where(and(
    eq(engineRunSchema.orgId, orgId),
    ...(opts.since ? [gte(engineRunSchema.createdAt, opts.since)] : []),
    ...(opts.engine ? [eq(engineRunSchema.engine, opts.engine)] : []),
    ...(opts.source ? [eq(engineRunSchema.source, opts.source)] : []),
  )).orderBy(desc(engineRunSchema.id)).limit(Math.min(opts.limit ?? 50, 200)).offset(opts.offset ?? 0);
}

/** One line of an eval run's runs.jsonl (packages/runner/eval), as far as the board reads it. */
export type EvalRunLine = {
  case: string;
  tier?: string;
  complexity?: number;
  risk_class?: string;
  run?: number;
  attempts?: Array<{ startedAt?: string; prUrl?: string; model?: string; elapsedS?: number; tokenUsage?: Meta; checks?: Array<{ status?: string }> }>;
  score?: { accepted?: boolean; attemptsUsed?: number; timeToPrS?: number; costUsd?: number; infra?: boolean; guardViolation?: boolean };
};

/**
 * An eval run's row, in the board's shape. Pure. The eval's grader is the QA
 * verdict; an accepted case is `accepted`, a graded failure `qa_failed`, an
 * infrastructure failure `failed`.
 * @param orgId - The workspace the board belongs to.
 * @param label - The eval run's name (its results folder).
 * @param engine - The engine the eval ran.
 * @param line - The run.
 */
export function engineRunFromEvalRun(orgId: string, label: string, engine: string, line: EvalRunLine): NewEngineRun {
  const attempts = line.attempts ?? [];
  const first = attempts[0] ?? {};
  const last = attempts[attempts.length - 1] ?? {};
  const s = line.score ?? {};
  const usage = obj(last.tokenUsage);
  const startedAt = first.startedAt ? new Date(first.startedAt) : null;
  const durationS = attempts.reduce((n, a) => n + (a.elapsedS ?? 0), 0) || null;
  const checks = Array.isArray(last.checks) ? last.checks : null;
  const outcome: EngineRunOutcome = s.infra ? 'failed' : s.accepted ? 'accepted' : 'qa_failed';
  return {
    orgId,
    source: 'eval',
    evalKey: `${label}:${line.case}:${line.run ?? 1}`,
    engine,
    model: text(usage.model) ?? text(last.model),
    seat: 'eval',
    routePolicy: 'eval',
    routeReason: label,
    repo: null,
    riskClass: text(line.risk_class),
    status: s.infra ? 'failed' : 'completed',
    startedAt,
    endedAt: startedAt && durationS ? new Date(startedAt.getTime() + durationS * 1000) : null,
    durationS,
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cents: Math.round((s.costUsd ?? 0) * 100),
    prUrl: text(last.prUrl),
    checksPassed: checks ? checks.filter(c => c.status === 'passed').length : null,
    checksTotal: checks ? checks.length : null,
    qaVerdict: s.infra ? null : s.accepted ? 'approve' : 'changes',
    accepted: s.infra ? null : Boolean(s.accepted),
    outcome,
    attempt: 1,
    retries: Math.max(0, (s.attemptsUsed ?? attempts.length) - 1),
    guardViolations: s.guardViolation ? 1 : 0,
    complexity: typeof line.complexity === 'number' ? (line.complexity <= 2 ? 'small' : line.complexity >= 4 ? 'large' : 'medium') : null,
  };
}

/**
 * Import an eval run's results into the board; a re-import replaces its rows.
 * @param orgId - The workspace the board belongs to.
 * @param label - The eval run's name.
 * @param engine - The engine it ran.
 * @param lines - Its runs.jsonl, parsed.
 * @returns How many rows were written.
 */
export async function importEvalRuns(orgId: string, label: string, engine: string, lines: readonly EvalRunLine[]): Promise<number> {
  let n = 0;
  for (const line of lines) {
    const row = engineRunFromEvalRun(orgId, label, engine, line);
    const { evalKey: _k, ...set } = row;
    await db.insert(engineRunSchema).values(row).onConflictDoUpdate({ target: engineRunSchema.evalKey, set: { ...set, updatedAt: new Date() } });
    n += 1;
  }
  return n;
}
