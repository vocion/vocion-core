/**
 * Agent tools for surveying past runs + their feedback.
 *
 * `list_recent_runs` is how an agent answers "what have you built?" and "what
 * shipped?". On 2026-09-20 the workspace lead said "no worker runs" while the
 * Factory log showed fifteen: this tool listed workflow runs and action
 * proposals only, and the lead's other move — the `engineering_task` records
 * — was empty because those runs had been queued against no task. The runs
 * themselves were always there, in `worker_run` (docs/entities/worker-run.md),
 * and that is what the tool now reads: every worker run in the org, whether
 * or not a task record exists, with the count, the last N, and the recent
 * `release` records beside them when the workspace has that noun. The
 * workflow and action runs stay, because the self-improver reads their
 * ratings and notes through the same tool. Read-only — nothing here mutates.
 */

import type { RuntimeContext } from '../types';
import type { WorkerRun } from '@/services/WorkerRunService';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { runFacts } from '@/libs/factory/runFacts';
import { ciFact, mergeRuleFact, nextForAttempt, NO_PULL_SIGNALS, normalisePullUrl, pullFact, verdictFact } from '@/libs/factory/workFacts';
import { actionRunSchema, businessObjectSchema, workerRunSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import { getObjectTypeBySlug, listBusinessObjects } from '@/services/BusinessObjectService';
import { taskStatus } from '@/services/factory/featureReport';
import { loadPullSignals, mergeRiskClassOf, mergeRulesFor } from '@/services/factory/pullSignals';
import { runRecord } from '@/services/WorkerRunService';
import { liveStatusOf } from './readObject';

/** The machinery's own noise — left out unless asked for, as the work item leaves it out. */
const BOOKKEEPING_KINDS = ['compact', 'snapshot'];

const DEFAULT_LIMIT = 20;

/**
 * The first string under any of `keys` on `source`, or null.
 * @param source - `result`, `progress` or `input` as the worker wrote it.
 * @param keys - Keys to try, in order.
 */
function firstString(source: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const v = source?.[key];
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.trim();
    }
  }
  return null;
}

/**
 * What the worker reported about the change, read from the keys the factory
 * worker writes (squatch-core `factory/worker/worker.mjs`, verified
 * 2026-09-20). A completed run's `result` carries `pr_url`, `branch`,
 * `commit_sha`, `files_changed`, `checks`, `task_id`, `risk_class`. A failed
 * run has no result: its kept work is on the last heartbeat's `progress` —
 * `keptBranch`, `prUrl`, `continue` — so the person can pick the branch up.
 * @param result - `worker_run.result`.
 * @param progress - `worker_run.progress`.
 */
function changeReported(result: Record<string, unknown> | null, progress: Record<string, unknown>): Record<string, unknown> {
  const checks = Array.isArray(result?.checks)
    ? (result!.checks as unknown[]).map((c) => {
        if (!c || typeof c !== 'object') {
          return { name: String(c), status: null };
        }
        const check = c as Record<string, unknown>;
        return {
          name: firstString(check, ['name', 'check']),
          status: typeof check.passed === 'boolean' ? (check.passed ? 'passed' : 'failed') : (firstString(check, ['status']) ?? null),
        };
      })
    : null;
  const filesChanged = Array.isArray(result?.files_changed) ? (result!.files_changed as unknown[]).length : null;
  const kept = firstString(progress, ['keptBranch']) || firstString(progress, ['prUrl'])
    ? { keptBranch: firstString(progress, ['keptBranch']), prUrl: firstString(progress, ['prUrl']), continue: firstString(progress, ['continue']) }
    : null;
  return {
    prUrl: firstString(result, ['pr_url']) ?? kept?.prUrl ?? null,
    branch: firstString(result, ['branch']) ?? kept?.keptBranch ?? null,
    commit: firstString(result, ['commit_sha']),
    filesChanged,
    checks,
    taskId: typeof result?.task_id === 'number' ? result.task_id : firstString(result, ['task_id']),
    riskClass: firstString(result, ['risk_class']),
    keptWork: kept,
  };
}

/**
 * What the run was asked to do, in one line: the task contract's objective
 * when the worker was handed one, otherwise the message the run was queued
 * with. Free-form by design (`worker_run.input` is worker-defined), so this
 * reads the shapes the factory and the harness actually write.
 * @param input - `worker_run.input`.
 */
function objectiveOf(input: Record<string, unknown>): string | null {
  const task = input.task;
  const fromTask = task && typeof task === 'object' ? firstString(task as Record<string, unknown>, ['objective', 'title']) : null;
  const text = fromTask ?? firstString(input, ['objective', 'message', 'prompt']);
  return text ? text.replace(/\s+/g, ' ').slice(0, 300) : null;
}

/**
 * The value of `key` on `source`, when it is a string; a compact string when
 * it is an array. Used for the release digest.
 * @param source
 * @param key
 */
function compact(source: Record<string, unknown>, key: string): string | number | null {
  const v = source[key];
  if (typeof v === 'number') {
    return v;
  }
  if (typeof v === 'string') {
    return v.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  }
  if (Array.isArray(v)) {
    return v.map(x => String(x)).join(', ').slice(0, 300) || null;
  }
  return null;
}

/**
 * Recent `release` records, when the workspace has that object type; null
 * when it does not, so the model can say the workspace does not track
 * releases rather than that nothing shipped.
 * @param orgId - Tenant.
 * @param limit - How many.
 */
async function recentReleases(orgId: string, limit: number): Promise<{ count: number; recent: Array<Record<string, unknown>> } | null> {
  const type = await getObjectTypeBySlug(orgId, 'release');
  if (!type) {
    return null;
  }
  const rows = await listBusinessObjects(orgId, 'release');
  const byReleasedAt = [...rows].sort((a, b) => {
    const ta = Date.parse(String((a.metadata ?? {}).releasedAt ?? '')) || a.createdAt.getTime();
    const tb = Date.parse(String((b.metadata ?? {}).releasedAt ?? '')) || b.createdAt.getTime();
    return tb - ta;
  });
  return {
    count: rows.length,
    recent: byReleasedAt.slice(0, limit).map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const taskIds = Array.isArray(meta.taskIds) ? meta.taskIds.length : 0;
      const requestIds = Array.isArray(meta.requestIds) ? meta.requestIds.length : 0;
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        product: compact(meta, 'product'),
        version: compact(meta, 'version'),
        releasedAt: compact(meta, 'releasedAt'),
        sizeClass: compact(meta, 'sizeClass'),
        prUrls: compact(meta, 'prUrls'),
        tasksCarried: taskIds,
        requestsClosed: requestIds,
        notes: compact(meta, 'notes') ?? compact(meta, 'releaseNotes') ?? compact(meta, 'announcement'),
      };
    }),
  };
}

/** How many distinct pieces of work a listing reads the full status of — each is the feature report's own read. */
const STATUS_READS = 6;

type Meta = Record<string, unknown>;

/**
 * What a run completed, in a clause: the run's own evidence, never its status
 * word alone ("completed" is the engineer's attempt, not the feature).
 * @param run - The run.
 */
function completedLine(run: WorkerRun): string {
  const f = runFacts({ ...run, progress: (run.progress ?? {}) as Meta, result: (run.result ?? null) as Meta | null, input: (run.input ?? {}) as Meta });
  switch (f.execution) {
    case 'completed':
      return `the run finished: ${f.headline}`;
    case 'running':
      return 'still running';
    case 'queued':
      return 'queued; no worker has taken it';
    case 'cancelled':
      return `stopped: ${f.headline}`;
    default:
      return `the run failed${f.failureClass ? ` (${f.failureClass})` : ''}: ${f.headline}`;
  }
}

/**
 * THE DELIVERY FACTS PER RUN (backlog 044). Conversation 392 read "#248
 * completed" as shipped when QA had sent it back and the pull request was
 * unmerged. Each run now carries, on separate typed fields, what it completed,
 * QA's verdict on its attempt, whether its pull request merged, CI on its
 * commit, the request's stage and what is next — read from the task, GitHub's
 * events, the merge action and the feature report, in a few batched reads.
 * @param orgId - Tenant.
 * @param runs - The listed runs, newest first.
 * @returns Run id → its facts, and request id → the request's status.
 */
async function deliveryFacts(orgId: string, runs: readonly WorkerRun[]): Promise<{ byRun: Map<number, Meta>; requests: Record<string, unknown> }> {
  const recordIds = [...new Set(runs.map(r => runRecord(r)?.id).filter((id): id is number => typeof id === 'number'))];
  const tasks = recordIds.length === 0
    ? []
    : await db
        .select({ id: businessObjectSchema.id, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata })
        .from(businessObjectSchema)
        .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, recordIds)));
  const taskById = new Map(tasks.map(t => [t.id, { id: t.id, status: t.status ?? null, meta: (t.metadata ?? {}) as Meta }]));
  const prOf = (run: WorkerRun): string | null => {
    const task = taskById.get(runRecord(run)?.id ?? -1);
    const url = (typeof task?.meta.prUrl === 'string' ? task.meta.prUrl : null)
      ?? (typeof (run.result as Meta | null)?.pr_url === 'string' ? (run.result as Meta).pr_url as string : null)
      ?? (typeof (run.progress as Meta | null)?.prUrl === 'string' ? (run.progress as Meta).prUrl as string : null);
    return url ? normalisePullUrl(url) : null;
  };
  // The request each task serves, newest first, for its status.
  const requestIds: number[] = [];
  for (const run of runs) {
    const rid = Number(taskById.get(runRecord(run)?.id ?? -1)?.meta.requestId);
    if (Number.isSafeInteger(rid) && rid > 0 && !requestIds.includes(rid)) {
      requestIds.push(rid);
    }
  }
  const approved = tasks.filter(t => ((t.metadata ?? {}) as Meta).verdict && (((t.metadata ?? {}) as Meta).verdict as Meta).value === 'approve');
  const classes = new Map(await Promise.all(approved.map(async t => [t.id, await mergeRiskClassOf(orgId, (t.metadata ?? {}) as Meta).catch(() => 'logic')] as const)));
  const [pulls, rules, statuses] = await Promise.all([
    loadPullSignals(orgId, runs.map(prOf)).catch(() => new Map()),
    mergeRulesFor(orgId, classes.values()).catch(() => new Map<string, boolean | null>()),
    Promise.all(requestIds.slice(0, STATUS_READS).map(async id => [id, await liveStatusOf(orgId, id)] as const)),
  ]);
  const requests: Record<string, unknown> = {};
  const currentTask = new Map<number, number | null>();
  const stageOf = new Map<number, string>();
  for (const [id, status] of statuses) {
    if (!status) {
      continue;
    }
    requests[String(id)] = status;
    const facts = (status.facts ?? null) as { attempt?: { taskId?: number } | null; request?: { stage?: string } } | null;
    currentTask.set(id, facts?.attempt?.taskId ?? null);
    if (facts?.request?.stage) {
      stageOf.set(id, facts.request.stage);
    }
  }
  const byRun = new Map<number, Meta>();
  for (const run of runs) {
    const task = taskById.get(runRecord(run)?.id ?? -1) ?? null;
    const url = prOf(run);
    const signals = (url && pulls.get(url)) || NO_PULL_SIGNALS;
    const stage = task ? taskStatus({ id: task.id, title: '', status: task.status, createdAt: null, meta: task.meta }) : null;
    const verdict = verdictFact(task ? { status: stage, meta: task.meta } : null);
    const pullRequest = pullFact(url, signals);
    const ciFailure = task?.meta.ciFailure;
    const commit = typeof task?.meta.commitSha === 'string' ? task.meta.commitSha : typeof (run.result as Meta | null)?.commit_sha === 'string' ? (run.result as Meta).commit_sha as string : null;
    const ci = ciFact(signals, { commit, ciFailure: ciFailure && typeof ciFailure === 'object' ? ciFailure as Meta : null }, pullRequest.label);
    const riskClass = task ? classes.get(task.id) ?? null : null;
    const mergeRule = mergeRuleFact(riskClass ? rules.get(riskClass) ?? null : null, riskClass);
    const requestId = Number(task?.meta.requestId);
    const hasRequest = Number.isSafeInteger(requestId) && requestId > 0;
    const current = hasRequest ? currentTask.get(requestId) : undefined;
    const superseded = task !== null && current !== undefined && current !== null && current !== task.id;
    const live = run.status === 'queued' || run.status === 'running' || run.status === 'paused';
    byRun.set(run.id, {
      completed: completedLine(run),
      ...(task ? { task: { id: task.id, stage } } : {}),
      verdict: { value: verdict.value, proven: verdict.proven, total: verdict.total, line: verdict.line },
      pullRequest: { merge: pullRequest.merge, line: pullRequest.line },
      ci: { state: ci.state, failedChecks: ci.failedChecks, line: ci.line },
      ...(verdict.value === 'approve' ? { mergeRule: { runsItself: mergeRule.runsItself, riskClass: mergeRule.riskClass, line: mergeRule.line } } : {}),
      ...(hasRequest ? { request: { id: requestId, stage: stageOf.get(requestId) ?? 'not read (see read_object)' } } : {}),
      ...(superseded ? { superseded: true } : {}),
      next: live ? 'Still going: its verdict, merge and CI follow once it finishes' : nextForAttempt({ verdict, pullRequest, ci, mergeRule, shipped: hasRequest && stageOf.get(requestId) === 'shipped', taskStage: stage, superseded }),
    });
  }
  return { byRun, requests };
}

export function listRecentRunsTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const limit = args.limit ?? DEFAULT_LIMIT;
      const where = [eq(workerRunSchema.orgId, ctx.orgId)];
      if (args.kinds && args.kinds.length > 0) {
        where.push(inArray(workerRunSchema.kind, args.kinds));
      } else if (!args.includeBookkeeping) {
        where.push(notInArray(workerRunSchema.kind, BOOKKEEPING_KINDS));
      }
      if (args.status) {
        where.push(eq(workerRunSchema.status, args.status));
      }
      if (args.agentSlug) {
        where.push(eq(workerRunSchema.agentSlug, args.agentSlug));
      }
      const workerWhere = and(...where);

      const [workerRows, statusRows, workflowRows, actionRows, releases] = await Promise.all([
        db.select().from(workerRunSchema).where(workerWhere).orderBy(desc(workerRunSchema.createdAt)).limit(limit),
        db
          .select({ status: workerRunSchema.status, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${workerRunSchema.cents}), 0)::int` })
          .from(workerRunSchema)
          .where(workerWhere)
          .groupBy(workerRunSchema.status),
        db
          .select({
            id: workflowRunSchema.id,
            status: workflowRunSchema.status,
            rating: workflowRunSchema.rating,
            feedbackNote: workflowRunSchema.feedbackNote,
            createdAt: workflowRunSchema.createdAt,
            workflowSlug: workflowSchema.slug,
          })
          .from(workflowRunSchema)
          .leftJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
          .where(eq(workflowRunSchema.orgId, ctx.orgId))
          .orderBy(desc(workflowRunSchema.createdAt))
          .limit(limit),
        db
          .select({
            id: actionRunSchema.id,
            actionId: actionRunSchema.actionId,
            status: actionRunSchema.status,
            createdAt: actionRunSchema.createdAt,
          })
          .from(actionRunSchema)
          .where(eq(actionRunSchema.orgId, ctx.orgId))
          .orderBy(desc(actionRunSchema.createdAt))
          .limit(limit),
        args.withFeedbackOnly ? Promise.resolve(null) : recentReleases(ctx.orgId, Math.min(limit, 10)),
      ]);

      const byStatus: Record<string, number> = {};
      let workerRunCount = 0;
      let centsSpent = 0;
      for (const row of statusRows) {
        byStatus[row.status] = row.n;
        workerRunCount += row.n;
        centsSpent += row.cents;
      }

      // "completed" never stands alone (backlog 044): each run carries what it
      // completed, QA's verdict, the merge, CI, the request's stage and what is next.
      const delivery = await deliveryFacts(ctx.orgId, workerRows).catch((err) => {
        console.warn('list_recent_runs: delivery facts could not be read', { orgId: ctx.orgId, message: (err as Error).message });
        return null;
      });
      const workerRuns = workerRows.map((run) => {
        const result = (run.result ?? null) as Record<string, unknown> | null;
        const input = (run.input ?? {}) as Record<string, unknown>;
        return {
          id: run.id,
          kind: run.kind,
          status: run.status,
          ...(delivery?.byRun.get(run.id) ?? {}),
          agent: run.agentSlug,
          objective: objectiveOf(input),
          record: runRecord(run),
          summary: run.summary,
          error: run.error,
          ...changeReported(result, (run.progress ?? {}) as Record<string, unknown>),
          counts: run.counts,
          tokens: run.tokens,
          cents: run.cents,
          model: run.model,
          startedAt: (run.claimedAt ?? run.createdAt).toISOString(),
          endedAt: run.completedAt?.toISOString() ?? null,
          ...(run.status === 'running' || run.status === 'paused' ? { heartbeatAt: run.heartbeatAt?.toISOString() ?? null } : {}),
        };
      });

      const workflow = args.withFeedbackOnly
        ? workflowRows.filter(r => r.rating || (r.feedbackNote && r.feedbackNote.trim().length > 0))
        : workflowRows;

      // Counts first: the trace's step line reads the leading numbers
      // ("workerRunCount 15 · releaseCount 2"), so they are what a person
      // sees without opening the call.
      return JSON.stringify({
        workerRunCount,
        releaseCount: releases?.count ?? null,
        byStatus,
        centsSpent,
        showing: workerRuns.length,
        note: workerRunCount === 0
          ? 'No worker runs in this workspace yet.'
          : `${workerRunCount} worker run${workerRunCount === 1 ? '' : 's'} on record; the ${workerRuns.length} most recent follow, newest first. A run is listed whether or not a task record exists for it. A run's status is the engineer's attempt only: "completed" means the run ended, not that QA passed it, that it merged or that it shipped. Each run says those on their own fields — verdict, pullRequest.merge, ci, request.stage, next — and requests carries each request's own status.`,
        workerRuns,
        ...(delivery && Object.keys(delivery.requests).length > 0 ? { requests: delivery.requests } : {}),
        releases: releases === null
          ? (args.withFeedbackOnly ? undefined : 'This workspace has no `release` object type, so nothing here says what reached people.')
          : releases,
        workflowRuns: workflow.map(r => ({ kind: 'workflow', ...r })),
        actionRuns: args.withFeedbackOnly ? [] : actionRows.map(r => ({ kind: 'action', ...r })),
      }, null, 2);
    },
    {
      name: 'list_recent_runs',
      description: [
        'What the workspace\'s agents have run and built, and where each piece of work stands. Returns the org\'s worker runs (external workers, the software factory\'s engineer, lead ticks, red-team grades) — every run on record, whether or not a task record exists for it — with the total count, spend, a count per status, and the most recent N newest first: id, kind, status, agent, what it was asked to do, the record it ran for, what it said it did, cost, and what the worker reported about the change — PR URL, branch, commit, files changed, each check with its status, task id, risk class — plus, on a failed run, the kept branch and PR from its last heartbeat and how to continue; when it started and ended. Each run also carries its delivery facts on separate fields: what it completed, QA\'s verdict on that attempt (value, proven of total), whether its pull request merged, CI on its commit, whether its merge runs itself, the request\'s stage (building, changes_asked, awaiting_qa, merged, shipped …) and what is next; `requests` carries each request\'s live status. A run\'s status "completed" is never a merge or a release — say status from these fields.',
        'When the workspace has a `release` object type, the recent releases ride along (product, version, when it reached people, the PRs and tasks it carried). Use this to answer "what have you built", "what shipped", "what is running", "what did the factory do this week" — before concluding that nothing happened.',
        'Also lists recent workflow runs and action proposals; set `withFeedbackOnly` to see only workflow runs carrying a rating or note (the self-improver\'s use). `kinds`, `status` and `agentSlug` narrow the worker runs; bookkeeping runs (compact, snapshot) are left out unless `includeBookkeeping` is set.',
      ].join(' '),
      schema: z.object({
        limit: z.number().int().positive().max(100).optional().describe(`How many recent runs to return (default ${DEFAULT_LIMIT}).`),
        kinds: z.array(z.string()).optional().describe('Only these worker run kinds: worker, lead, board, red-team, compact, snapshot.'),
        status: z.string().optional().describe('Only worker runs in this status: queued, running, paused, awaiting_review, completed, failed, cancelled, lost.'),
        agentSlug: z.string().optional().describe('Only worker runs by this agent.'),
        includeBookkeeping: z.boolean().optional().describe('Include compact and snapshot runs, which are left out by default.'),
        withFeedbackOnly: z.boolean().optional().describe('Only workflow runs carrying a rating or note; skips worker runs\' releases and action proposals.'),
      }),
    },
  );
}

export function listRunFeedbackTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const [row] = await db
        .select()
        .from(workflowRunSchema)
        .where(and(eq(workflowRunSchema.orgId, ctx.orgId), eq(workflowRunSchema.id, args.runId)));
      if (!row) {
        return JSON.stringify({ error: 'not_found' });
      }
      return JSON.stringify({
        runId: row.id,
        status: row.status,
        rating: row.rating,
        feedbackNote: row.feedbackNote,
        feedbackBy: row.feedbackBy,
        feedbackAt: row.feedbackAt,
        stepResults: row.stepResults,
        workspaceSha: row.workspaceSha,
      }, null, 2);
    },
    {
      name: 'list_run_feedback',
      description: 'Return the feedback signal (rating + note + step results) for a single workflow run id. Use after list_recent_runs to study a specific case.',
      schema: z.object({ runId: z.number().int().positive() }),
    },
  );
}
