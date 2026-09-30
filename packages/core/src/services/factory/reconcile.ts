/**
 * WEBHOOKS FIRST, A RECONCILER BEHIND THEM (backlog 049; Chris, 2026-09-30:
 * "I love those web hooks. Leverage that with fallback sweep"). GitHub tells
 * Vocion what happened the moment it happens, and every handler is idempotent
 * on the event's dedupe key. But GitHub does not redeliver a delivery that
 * failed, and a worker that never picks a run up sends nothing at all. So
 * every five minutes this compares what should have happened with what did,
 * and re-raises what is missing through the same handlers — one path; it
 * reconciles, it does not do the work.
 *
 *   - OPEN FACTORY PULL REQUESTS: each one is read back from GitHub (checks,
 *     merged, closed) and the event it earned is emitted with the webhook's
 *     own dedupe key, so an event that arrived is a no-op and one that did not
 *     runs its automation now (`libs/github/events.ts` builds both).
 *   - A RED BASE THAT TURNED GREEN: every pull request a `pipelineFix` request
 *     lists as blocked is brought up to date with the fixed base, so its
 *     checks run again (`ciFailed.fileMainFix` filed it).
 *   - REVIEWS NEVER STARTED: `watchAwaitingReview`.
 *   - RUNS QUEUED PAST PICKUP: an engineering run no worker claimed is an
 *     infrastructure failure only the pipeline's owner can fix; one ask, with
 *     the evidence, closed by itself once a worker claims the run.
 *   - PIPELINE CHANGES: each pull request the pipeline's owner opened is read
 *     back; green merges it on its trust rule, red goes back to its owner
 *     (`pipelineChange.reconcileChanges`). A fix asked of the owner that
 *     nothing answered is a stop, with its reason (`watchUnanswered`).
 *
 * The heavier sweep (`carry.sweepStuckRequests`) stays hourly.
 */

import type { GithubEvent } from '@/libs/github/events';

type Meta = Record<string, unknown>;
type Result = { requestId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** How long an engineering run may sit queued with no worker before the pipeline's owner is asked. */
export const PICKUP_MS = 10 * 60_000;
/** The most pull requests read back from GitHub in one pass. */
export const RECONCILE_PULLS = 25;
/** Tasks untouched for longer than this are not read back. */
const LOOKBACK_MS = 14 * 86_400_000;
/** A task whose pull request is in one of these is still the pipeline's. */
const WATCHED_TASK_STATES = ['dispatched', 'running', 'awaiting_review', 'review_failed', 'changes_requested', 'accepted'];

/** Where a reconcile pass acts on the world, injected in tests. */
export type ReconcileDeps = {
  readPull: (orgId: string, url: string) => Promise<{ repo: string; pr: import('@/libs/github/events').GithubPullRequest; checkRuns: import('@/libs/github/events').GithubCheckRun[] }>;
  branchChecks: (orgId: string, repo: string, branch: string) => Promise<{ sha: string | null; complete: boolean; failing: string[] }>;
  updatePullBranch: (orgId: string, url: string, expectedHead?: string | null) => Promise<void>;
  emit: (orgId: string, event: GithubEvent) => Promise<{ deduped: boolean }>;
  /** GitHub's runs on a merge commit (`delivery.ts`); absent, the workspace's own token. */
  deliveries?: import('./delivery').DeliveryDeps;
};

async function defaultDeps(): Promise<ReconcileDeps> {
  const gh = await import('./githubChecks');
  const { emitEvent } = await import('@/services/EventService');
  return {
    readPull: gh.readPull,
    branchChecks: gh.branchChecks,
    updatePullBranch: gh.updatePullBranch,
    emit: async (orgId, event) => {
      const res = await emitEvent({ orgId, type: event.type, payload: event.payload, dedupeKey: event.dedupeKey, invokedBy: 'system:factory-reconcile' });
      return { deduped: res.deduped };
    },
  };
}

/**
 * Metadata written without moving `updatedAt`: reading GitHub back is not a change to the work.
 * @param orgId
 * @param id
 * @param set
 */
async function stamp(orgId: string, id: number, set: Meta): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db.update(businessObjectSchema)
    // `updatedAt` is set to itself: the column's own on-update would move it,
    // and the quiet windows that watch for stuck work read it.
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: sql`${businessObjectSchema.updatedAt}` })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

async function note(orgId: string, requestId: number | null, line: string): Promise<void> {
  if (requestId) {
    const { noteOnRequest } = await import('./carry');
    await noteOnRequest(orgId, requestId, line).catch(() => undefined);
  }
}

/**
 * The events a pull request's state on GitHub has earned: merged or closed
 * when it ended, and its checks when they finished on the head it has now.
 * The builders are the webhook's and the poller's, so the keys are theirs.
 * @param repo - `owner/name`.
 * @param pr - The pull request as GitHub has it.
 * @param checkRuns - The check runs on its head.
 */
export async function earnedEvents(repo: string, pr: import('@/libs/github/events').GithubPullRequest, checkRuns: import('@/libs/github/events').GithubCheckRun[]): Promise<GithubEvent[]> {
  const { checksCompletedEvent, pullRequestLifecycleEvents, PR_CLOSED, PR_MERGED } = await import('@/libs/github/events');
  if (pr.state !== 'open') {
    return pullRequestLifecycleEvents(repo, pr, null).filter(e => e.type === PR_MERGED || e.type === PR_CLOSED);
  }
  const checks = checksCompletedEvent(repo, pr, checkRuns);
  return checks ? [checks] : [];
}

/**
 * Every open factory pull request, read back from GitHub; the events whose
 * webhook never arrived are raised now.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function reconcileOpenPulls(orgId: string, now: Date, deps: ReconcileDeps): Promise<Result[]> {
  const { and, desc, eq, gt, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const tasks = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      inArray(businessObjectSchema.status, WATCHED_TASK_STATES),
      gt(businessObjectSchema.updatedAt, new Date(now.getTime() - LOOKBACK_MS)),
      sql`${businessObjectSchema.metadata} ->> 'prUrl' is not null`,
      sql`coalesce(${businessObjectSchema.metadata} ->> 'prState', 'open') = 'open'`,
    ))
    .orderBy(desc(businessObjectSchema.updatedAt))
    .limit(RECONCILE_PULLS);
  const out: Result[] = [];
  for (const task of tasks) {
    const meta = (task.meta ?? {}) as Meta;
    const url = str(meta.prUrl)!;
    const requestId = Number(meta.requestId) || null;
    let read: Awaited<ReturnType<ReconcileDeps['readPull']>>;
    try {
      read = await deps.readPull(orgId, url);
    } catch (err) {
      // Unreadable is not a finding about the work: the next pass tries again.
      console.warn('factory reconcile: a pull request could not be read back', { orgId, url, message: (err as Error).message });
      continue;
    }
    const state = read.pr.merged_at ? 'merged' : read.pr.state === 'open' ? 'open' : 'closed';
    for (const event of await earnedEvents(read.repo, read.pr, read.checkRuns)) {
      const res = await deps.emit(orgId, event).catch((err: Error) => {
        console.warn('factory reconcile: an event could not be raised', { orgId, url, type: event.type, message: err.message });
        return { deduped: true };
      });
      if (!res.deduped) {
        const line = `GitHub's ${event.type.replace(/^pr\./, '').replace(/_/g, ' ')} for ${url} never reached Vocion; the reconciler read it back and raised it.`;
        await note(orgId, requestId, line);
        out.push({ requestId, did: `re-raised ${event.type}`, line });
      }
    }
    if (state !== (str(meta.prState) ?? 'open') || (state === 'open' && read.pr.head.sha !== str(meta.headSha))) {
      await stamp(orgId, task.id, { prState: state, ...(state === 'open' ? { headSha: read.pr.head.sha } : {}) });
    }
  }
  return out;
}

/**
 * A red base that is green again: every pull request its fix lists as
 * blocked is brought up to date with it, so its checks run against the fix.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function recheckFixedBranches(orgId: string, now: Date, deps: ReconcileDeps): Promise<Result[]> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const fixes = ((await listBusinessObjects(orgId, 'request').catch(() => [])) as Array<{ id: number; metadata: unknown }>)
    .map(r => ({ id: r.id, meta: (r.metadata ?? {}) as Meta }))
    .filter(r => r.meta.pipelineFix && typeof r.meta.pipelineFix === 'object' && !(r.meta.pipelineFix as Meta).recheckedAt);
  const out: Result[] = [];
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  for (const fixReq of fixes) {
    const fix = fixReq.meta.pipelineFix as Meta;
    const repo = str(fix.repo);
    const branch = str(fix.branch);
    if (!repo || !branch) {
      continue;
    }
    const checks = await deps.branchChecks(orgId, repo, branch).catch(() => null);
    if (!checks || !checks.complete || checks.failing.length > 0 || (checks.sha && checks.sha === str(fix.sha))) {
      continue;
    }
    const blocks = Array.isArray(fix.blocks) ? (fix.blocks as Array<{ url?: string; taskId?: number; requestId?: number | null }>) : [];
    const rechecked: string[] = [];
    for (const b of blocks) {
      const task = b.taskId ? await readRecord(orgId, b.taskId) : null;
      const url = str(b.url);
      if (!task || !url || !['awaiting_review', 'review_failed'].includes(String(task.status ?? ''))) {
        continue;
      }
      try {
        await deps.updatePullBranch(orgId, url, str(task.meta.headSha) ?? str(task.meta.commitSha));
        await stamp(orgId, task.id, { mainBlocked: null, mainRechecked: { at: now.toISOString(), baseSha: checks.sha, fixRequestId: fixReq.id } });
        rechecked.push(url);
        await note(orgId, b.requestId ?? null, `${branch} is green again (fix #${fixReq.id}); ${url} was brought up to date with it, and its checks run again.`);
      } catch (err) {
        // Bringing it up to date failed (a conflict with the fixed base): the engineer's.
        const { buildAgain } = await import('@/services/agents/tools/recordVerdict');
        const why = `${branch} is green again (fix #${fixReq.id}), but ${url} could not be brought up to date with it: ${(err as Error).message}`;
        await stamp(orgId, task.id, { mainBlocked: null });
        const built = await buildAgain(orgId, { id: task.id, meta: task.meta }, { to: 'engineer', why, note: `${why}. Rebase the change onto ${branch} and keep what is already proven.`, reason: `${why}; back with the engineer.`, by: 'CI' });
        await note(orgId, b.requestId ?? null, `${why}; it is back with the engineer.${built ? ` ${built}` : ''}`);
      }
    }
    await stamp(orgId, fixReq.id, { pipelineFix: { ...fix, recheckedAt: now.toISOString(), greenSha: checks.sha } });
    const line = `${branch} of ${repo} is green again at ${checks.sha?.slice(0, 7) ?? '?'}; ${rechecked.length} of ${blocks.length} blocked pull request${blocks.length === 1 ? '' : 's'} checked again against it.`;
    await note(orgId, fixReq.id, line);
    out.push({ requestId: fixReq.id, did: 'base green: rechecked', line });
  }
  return out;
}

/**
 * Engineering runs queued past pickup: one ask to the pipeline's owner per
 * run, and the ask closed by itself once a worker claims it.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param owner - The seat that owns the pipeline (the automation's `do.input.owner`).
 */
export async function watchQueuedRuns(orgId: string, now: Date, owner: string | null): Promise<Result[]> {
  const { and, desc, eq, gt, isNotNull, isNull, like, lt } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema, workerRunSchema } = await import('@/models/Schema');
  const { getAskBySourceRef, supersedeAsk, upsertAsk } = await import('@/services/AskService');
  const out: Result[] = [];
  // Asks whose run a worker has since claimed are closed first.
  const open = await db.select({ id: askSchema.id, sourceRef: askSchema.sourceRef }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, 'pipeline-pickup:%')));
  for (const ask of open) {
    const runId = Number(String(ask.sourceRef).split(':')[1]);
    const [run] = Number.isInteger(runId) ? await db.select({ status: workerRunSchema.status, claimedAt: workerRunSchema.claimedAt }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, runId))).limit(1) : [];
    if (!run || run.claimedAt || run.status !== 'queued') {
      await supersedeAsk(orgId, ask.id, run?.claimedAt ? `A worker claimed run #${runId} at ${run.claimedAt.toISOString()}.` : `Run #${runId} is ${run?.status ?? 'gone'}; nothing waits on a worker.`).catch(() => undefined);
    }
  }
  const stuck = await db.select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, createdAt: workerRunSchema.createdAt, input: workerRunSchema.input })
    .from(workerRunSchema)
    .where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.status, 'queued'), isNull(workerRunSchema.claimedAt), lt(workerRunSchema.createdAt, new Date(now.getTime() - PICKUP_MS)), gt(workerRunSchema.createdAt, new Date(now.getTime() - 86_400_000))))
    .orderBy(desc(workerRunSchema.createdAt))
    .limit(10);
  if (stuck.length === 0) {
    return out;
  }
  const [lastClaim] = await db.select({ at: workerRunSchema.claimedAt, version: workerRunSchema.workerVersion }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), isNotNull(workerRunSchema.claimedAt))).orderBy(desc(workerRunSchema.claimedAt)).limit(1);
  const lastSeen = lastClaim?.at ? `The last run a worker claimed was at ${lastClaim.at.toISOString()}${lastClaim.version ? ` (worker ${lastClaim.version})` : ''}.` : 'No worker has claimed a run in this workspace yet.';
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  for (const run of stuck) {
    const sourceRef = `pipeline-pickup:${run.id}`;
    if (await getAskBySourceRef(orgId, sourceRef)) {
      continue;
    }
    const taskId = Number(((run.input ?? {}) as { record?: { id?: unknown } }).record?.id) || null;
    const task = taskId ? await readRecord(orgId, taskId) : null;
    const requestId = task ? Number(task.meta.requestId) || null : null;
    const minutes = Math.round((now.getTime() - (run.createdAt?.getTime() ?? now.getTime())) / 60_000);
    const { ask } = await upsertAsk({
      orgId,
      createdBy: `agent:${owner ?? 'system'}`,
      ask: {
        kind: 'approval',
        title: `No worker has picked up run #${run.id} in ${minutes} min`,
        body: [
          `Run #${run.id} (${run.agentSlug}) was queued ${minutes} minutes ago and no worker has claimed it. ${lastSeen}`,
          'Start or fix the worker fleet; the run is picked up as soon as a worker claims it, and this ask closes by itself.',
        ].join('\n\n'),
        sourceRef,
        agentSlug: owner,
        risk: 'medium',
        options: [
          { id: 'approve', label: 'The workers are running', description: 'Nothing else to do: the run is claimed on the next poll.', recommended: true },
          { id: 'reject', label: 'Leave it queued', description: 'It stays queued until a worker claims it.' },
        ],
        objectRefs: [...(taskId ? [{ type: 'engineering_task', id: String(taskId) }] : []), ...(requestId ? [{ type: 'request', id: String(requestId) }] : [])],
        decisionCost: 5,
        contextUrl: `/dashboard/p/runs/${run.id}`,
      },
    });
    const line = `No worker has picked up run #${run.id} in ${minutes} min; ask #${ask.id} is with the pipeline's owner. ${lastSeen}`;
    await note(orgId, requestId, line);
    out.push({ requestId, did: 'queued past pickup: asked', line });
  }
  return out;
}

/**
 * One reconcile pass: the cheap read-back every five minutes.
 * @param orgId - The workspace.
 * @param input - The automation's `do.input` (`owner`: the seat that owns the pipeline).
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function reconcilePipeline(orgId: string, input: Meta = {}, now: Date = new Date(), deps?: ReconcileDeps): Promise<{ acted: Result[] }> {
  const d = deps ?? await defaultDeps();
  const owner = str(input.owner);
  const acted: Result[] = [];
  const step = async (name: string, fn: () => Promise<Result[]>) => {
    acted.push(...await fn().catch((err: Error) => {
      console.warn(`factory reconcile: ${name} failed`, { orgId, message: err.message });
      return [];
    }));
  };
  await step('the pull-request read-back', () => reconcileOpenPulls(orgId, now, d));
  await step('the fixed-branch recheck', () => recheckFixedBranches(orgId, now, d));
  await step('the awaiting-review watch', async () => (await import('./ciFailed')).watchAwaitingReview(orgId, now, owner ? { owner } : {}));
  await step('the pickup watch', () => watchQueuedRuns(orgId, now, owner));
  // AFTER THE MERGE (#269, 2026-09-30): a merge whose webhook never became a
  // delivery is written from its recorded event, and the runs the merge
  // started are read again until they finish (`delivery.ts`).
  await step('the merge read-back', async () => (await (await import('./delivery')).refreshDeliveries(orgId, now, d.deliveries)).map(r => ({ requestId: r.requestId, did: r.did, line: null })));
  await step('the pipeline changes', async () => (await import('./pipelineChange')).reconcileChanges(orgId, now, owner));
  await step('the unanswered pipeline fixes', async () => (await import('./pipelineChange')).watchUnanswered(orgId, now, owner));
  return { acted };
}
