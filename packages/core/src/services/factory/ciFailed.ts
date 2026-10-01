/**
 * A FACTORY PULL REQUEST WHOSE CI FAILED IS ANSWERED (Chris, 2026-09-30, on
 * #269: "Why is it stuck? Why did chat lie and not try to progress it"). The
 * worker's own checks passed 6 of 6, GitHub's CI failed on an integration
 * test, and QA only starts on a green CI: the task sat "awaiting review" for
 * seven hours with nothing running, and the page and the PM both said QA was
 * checking it.
 *
 * WHY IT IS RED DECIDES WHERE IT GOES (backlog 049). `ciFailed` answers the
 * `pr.checks_completed` event whose conclusion is not success. It reads what
 * GitHub says failed (`githubChecks.readCheckLogs`), whether the branch the
 * pull request targets is red too, and asks `ciDiagnose` — a typed model
 * read, never a match over the log — which of four it is, then routes:
 *
 *   change_broke_it → the attempt is built again, carrying the failing checks
 *                     and what the log says (the per-stage limit applies).
 *   flaky           → the failed jobs are re-run once (`repo.rerun_failed_checks`,
 *                     done for you), counted on the task; failing again on the
 *                     same head is treated as the change's.
 *   main_broken     → one fix request on the default branch, listing every
 *                     pull request it blocks; the reconciler checks each one
 *                     again when the branch is green (`reconcile.ts`). Where
 *                     the fix lives is the diagnosis's typed `fixIn`: in the
 *                     product's code the factory builds it with the engineer;
 *                     in the pipeline its owner fixes it itself
 *                     (`pipelineChange.raisePipelineFix`).
 *   infra           → the failed jobs are re-run once, done for you; failing
 *                     again, the pipeline's owner fixes the pipeline itself,
 *                     and a person is asked once only when that runs out.
 *
 * Every route writes one line on the request's own account, where the
 * feature page reads it, and the diagnosis on the task. The handler is
 * idempotent: a diagnosis is keyed on the event's dedupe key, so the webhook,
 * the poll and the reconciler raising the same event act once.
 *
 * `watchAwaitingReview` (the 5-minute reconcile) finds a task waiting on QA
 * with no review behind it: CI failed → `ciFailed`; CI passed and no review
 * ran → the event is raised again so the review starts. Nothing waits unwatched.
 */

import type { CiCause, CiDiagnosis, CiEvidence, CiFixPlace } from './ciDiagnose';
import type { CheckLogs } from './githubChecks';

type Meta = Record<string, unknown>;
type Result = { requestId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const sameSha = (a: string | null, b: string | null): boolean => !!a && !!b && (a.startsWith(b.slice(0, 7)) || b.startsWith(a.slice(0, 7)));

/** How many times the sweep starts a failed review again, per task. */
export const REVIEW_RESTARTS = 2;

/** How long a task may wait on QA with no review running before the watch looks. */
export const AWAITING_REVIEW_QUIET_MS = 15 * 60_000;

/** How many times a head's failed jobs are re-run as flaky before the failure is the change's. */
export const FLAKY_RERUNS = 1;

/** What `ciFailed` reads and asks, injected in tests. */
export type CiFailedDeps = {
  readLogs: (orgId: string, url: string, headSha: string | null) => Promise<CheckLogs>;
  baseChecks: (orgId: string, repo: string, branch: string) => Promise<{ sha: string | null; complete: boolean; failing: string[] }>;
  diagnose: (e: CiEvidence) => Promise<CiDiagnosis | null>;
  liveHead: (orgId: string, url: string) => Promise<string | null>;
};

async function defaultDeps(): Promise<CiFailedDeps> {
  const gh = await import('./githubChecks');
  const { diagnoseCi } = await import('./ciDiagnose');
  const { readPullHead } = await import('@/services/agents/tools/githubPullRead');
  return {
    readLogs: (orgId, url, headSha) => gh.readCheckLogs(orgId, url, { headSha }),
    baseChecks: (orgId, repo, branch) => gh.branchChecks(orgId, repo, branch),
    diagnose: e => diagnoseCi(e),
    liveHead: async (orgId, url) => (await readPullHead(orgId, url))?.sha ?? null,
  };
}

/**
 * The failing checks as one short text for the next attempt's note.
 * @param logs - What GitHub said failed.
 */
export function failureDetail(logs: CheckLogs | null): string {
  if (!logs) {
    return '';
  }
  return logs.failing.map((f) => {
    const notes = f.annotations.length > 0 ? f.annotations.slice(0, 4).join('; ') : f.summary ?? f.conclusion;
    const tail = f.logTail ? `\n  last lines of ${f.step ? `"${f.step}"` : 'the log'}:\n  ${f.logTail.split('\n').slice(-15).join('\n  ')}` : '';
    return `${f.name}: ${notes}${tail}`;
  }).join('\n').slice(0, 3500);
}

async function writeTask(orgId: string, id: number, set: Meta, status?: string): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db.update(businessObjectSchema)
    .set({ ...(status ? { status } : {}), metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ ...set, ...(status ? { status } : {}) })}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

async function note(orgId: string, requestId: number | null, line: string): Promise<void> {
  if (requestId) {
    const { noteOnRequest } = await import('./carry');
    await noteOnRequest(orgId, requestId, line).catch(() => undefined);
  }
}

/**
 * CI failed on a factory pull request: read why, and answer it.
 * @param orgId - The workspace.
 * @param payload - The `pr.checks_completed` event payload, merged over the automation's `do.input` (`owner`: the seat that owns the pipeline).
 * @param deps - Injected in tests.
 */
export async function ciFailed(orgId: string, payload: Meta, deps?: CiFailedDeps): Promise<Result> {
  const url = str(payload.url);
  if (!url || str(payload.conclusion) === 'success') {
    return { requestId: null, did: 'not a failed check', line: null };
  }
  const { buildAgain, findTaskByPr } = await import('@/services/agents/tools/recordVerdict');
  const task = await findTaskByPr(orgId, url);
  const requestId = task ? Number(task.meta.requestId) || null : null;
  if (!task || !['awaiting_review', 'review_failed'].includes(String(task.status ?? ''))) {
    return { requestId, did: 'no task waiting on this pull request', line: null };
  }
  const d = deps ?? await defaultDeps();
  const headSha = str(payload.headSha);
  const taskSha = str(task.meta.headSha) ?? str(task.meta.commitSha);
  if (headSha && taskSha && !sameSha(headSha, taskSha)) {
    // The branch may have moved on purpose (the reconciler brought it up to
    // date with a fixed base): the checks count when they are for its head now.
    const live = await d.liveHead(orgId, url).catch(() => null);
    if (!sameSha(live, headSha)) {
      return { requestId, did: 'the checks are for another commit', line: null };
    }
    await writeTask(orgId, task.id, { headSha: live });
  }
  const eventKey = str(payload.dedupeKey) ?? `${url}@${headSha ?? taskSha ?? '?'}`;
  const prior = (task.meta.ciDiagnosis ?? null) as { key?: string } | null;
  if (prior?.key === eventKey) {
    return { requestId, did: 'already answered', line: null };
  }
  const names = Array.isArray(payload.failedChecks) ? (payload.failedChecks as unknown[]).map(String).join(', ') : str(payload.failedChecks) ?? 'the required checks';

  // What GitHub says, and the branch it targets.
  let logs: CheckLogs | null = null;
  let unread: string | null = null;
  try {
    logs = await d.readLogs(orgId, url, headSha ?? taskSha);
  } catch (err) {
    unread = (err as Error).message;
  }
  const baseBranch = logs?.baseBranch ?? str(payload.baseBranch);
  const base = logs && baseBranch ? await d.baseChecks(orgId, logs.repo, baseBranch).then(b => ({ branch: baseBranch, ...b })).catch(() => null) : null;
  const diagnosis = logs ? await d.diagnose({ orgId, prUrl: url, title: str(payload.title) ?? String(task.title ?? ''), logs, base, workerChecks: str(task.meta.checksSummary) }) : null;
  const detail = failureDetail(logs);
  const failing = diagnosis?.failing ?? (logs?.failing.map(f => f.name).join(', ') || names);

  // A head already re-run as flaky that fails again is the change's.
  const rerun = (task.meta.ciRerun ?? null) as { headSha?: string; count?: number } | null;
  const rerunsHere = rerun && sameSha(str(rerun.headSha), headSha ?? taskSha) ? Number(rerun.count ?? 0) : 0;
  let cause: CiCause = diagnosis?.cause ?? 'change_broke_it';
  if (cause === 'flaky' && rerunsHere >= FLAKY_RERUNS) {
    cause = 'change_broke_it';
  }
  // The fix for a red base cannot be blocked by that base: its red CI is its own.
  if (cause === 'main_broken' && requestId && await isPipelineFix(orgId, requestId)) {
    cause = 'change_broke_it';
  }
  const at = new Date().toISOString();
  await writeTask(orgId, task.id, { ciDiagnosis: { key: eventKey, cause, read: diagnosis?.cause ?? null, why: diagnosis?.why ?? (unread ? `GitHub could not be read: ${unread}` : 'the cause could not be read'), failing, headSha: headSha ?? taskSha, at } });
  const owner = str(payload.owner);

  if (cause === 'flaky') {
    const res = await rerunFailed(orgId, { url, headSha: headSha ?? taskSha, taskId: task.id, why: diagnosis!.why, owner });
    if (res.ok) {
      await writeTask(orgId, task.id, { ciRerun: { headSha: headSha ?? taskSha, count: rerunsHere + 1, at, actionRunId: res.runId } });
      const how = res.pending ? `A re-run of the failed jobs is on a card for a person (action #${res.runId})` : `The failed jobs were re-run once (action #${res.runId})`;
      const line = `CI failed on what reads as a flaky check (${failing}): ${diagnosis!.why} ${how}; failing again sends it back to the engineer.`;
      await note(orgId, requestId, line);
      return { requestId, did: 'ci flaky: re-ran', line };
    }
    // A re-run GitHub refused is not a reason to wait: the change's route, with why.
    return sendBack(orgId, { task, requestId, buildAgain, names, failing, detail, why: `${diagnosis!.why} A re-run could not start (${res.error}), so`, at });
  }

  if (cause === 'main_broken' && logs && baseBranch) {
    const fixIn = diagnosis?.fixIn === 'pipeline' ? 'pipeline' : 'code';
    const fix = await fileMainFix(orgId, { repo: logs.repo, branch: baseBranch, baseSha: base?.sha ?? null, failing: base?.failing.length ? base.failing : logs.failing.map(f => f.name), why: diagnosis!.why, blocked: { url, taskId: task.id, requestId }, product: requestId ? await productOf(orgId, requestId) : null, owner, detail, cause: 'main_broken', fixIn });
    await writeTask(orgId, task.id, { mainBlocked: { requestId: fix.id, repo: logs.repo, branch: baseBranch, at } });
    const who = fixIn === 'pipeline' ? ` ${fix.created ? 'Its pipeline is being fixed by its owner' : 'Its owner is on it'}` : '';
    const line = `CI failed because ${baseBranch} is red (${failing}): ${diagnosis!.why} ${fix.created ? `Fix #${fix.id} was filed on ${baseBranch}` : `Fix #${fix.id} on ${baseBranch} already covers it`};${who ? `${who};` : ''} this pull request is checked again when ${baseBranch} is green.`;
    await note(orgId, requestId, line);
    return { requestId, did: fixIn === 'pipeline' ? 'ci main broken: owner fixing' : 'ci main broken: fix filed', line };
  }

  if (cause === 'infra' && logs) {
    // A pipeline that could not run is re-run once first, done for you: most
    // of what stops a runner (a lost machine, a registry blip) is gone by then.
    if (rerunsHere < FLAKY_RERUNS) {
      const res = await rerunFailed(orgId, { url, headSha: headSha ?? taskSha, taskId: task.id, why: diagnosis!.why, owner });
      if (res.ok) {
        await writeTask(orgId, task.id, { ciRerun: { headSha: headSha ?? taskSha, count: rerunsHere + 1, at, actionRunId: res.runId } });
        const how = res.pending ? `A re-run of the failed jobs is on a card for a person (action #${res.runId})` : `The failed jobs were re-run once (action #${res.runId})`;
        const line = `CI could not run (${failing}): ${diagnosis!.why} ${how}; if the pipeline fails again, its owner fixes it.`;
        await note(orgId, requestId, line);
        return { requestId, did: 'ci infra: re-ran', line };
      }
    }
    // Again, or the re-run could not start: the pipeline's owner fixes the pipeline itself.
    const branch = baseBranch ?? 'main';
    const fix = await fileMainFix(orgId, { repo: logs.repo, branch, baseSha: base?.sha ?? null, failing: logs.failing.map(f => f.name), why: diagnosis!.why, blocked: { url, taskId: task.id, requestId }, product: requestId ? await productOf(orgId, requestId) : null, owner, detail, cause: 'infra', fixIn: 'pipeline' });
    await writeTask(orgId, task.id, { mainBlocked: { requestId: fix.id, repo: logs.repo, branch, at } });
    const line = `CI could not run${rerunsHere > 0 ? ' again after a re-run' : ''} (${failing}): ${diagnosis!.why} ${fix.created ? `The pipeline's owner is fixing it on fix #${fix.id}` : `Fix #${fix.id} already covers it`}; this pull request is checked again when it lands.`;
    await note(orgId, requestId, line);
    return { requestId, did: 'ci infra: owner fixing', line };
  }

  const why = diagnosis
    ? `${diagnosis.why}${rerunsHere > 0 ? ' It failed again after a re-run.' : ''} So`
    : `The cause could not be read${unread ? ` (${unread})` : ''}, so`;
  return sendBack(orgId, { task, requestId, buildAgain, names, failing, detail, why, at });
}

async function sendBack(orgId: string, o: { task: { id: number; meta: Meta }; requestId: number | null; buildAgain: typeof import('@/services/agents/tools/recordVerdict').buildAgain; names: string; failing: string; detail: string; why: string; at: string }): Promise<Result> {
  const headline = `CI failed: ${o.failing}`;
  const noteText = `${headline}, although the worker's own run of the checks passed. What failed:\n${o.detail || '(no annotation or log text; open the checks on the pull request)'}\nReproduce it the way CI runs (a clean install, the full suite, its database), fix it, and keep what is already proven.`;
  await writeTask(orgId, o.task.id, { ciFailure: { at: o.at, checks: o.names, failing: o.failing, detail: o.detail.slice(0, 1500) } }, 'changes_requested');
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, o.task.id).catch(() => undefined);
  const reason = `${headline}; back with the engineer.`;
  const built = await o.buildAgain(orgId, { id: o.task.id, meta: o.task.meta }, { to: 'engineer', why: headline, note: noteText, reason, by: 'CI' });
  const line = `${headline}. ${o.why} it is back with the engineer.${built ? ` ${built}` : ''}`;
  await note(orgId, o.requestId, line);
  return { requestId: o.requestId, did: 'ci failed: built again', line };
}

async function isPipelineFix(orgId: string, requestId: number): Promise<boolean> {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const fix = (await readRecord(orgId, requestId))?.meta.pipelineFix;
  return !!fix && typeof fix === 'object';
}

async function productOf(orgId: string, requestId: number): Promise<string | null> {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  return str((await readRecord(orgId, requestId))?.meta.product);
}

const SYSTEM_PRINCIPAL = (orgId: string, owner: string | null) => ({ kind: 'agent' as const, id: `agent:${owner ?? 'system'}`, scope: { orgId }, grants: ['*'], autonomy: 2 });

/**
 * Re-run a head's failed jobs through the action rail, so the trust ladder,
 * the ledger and Undo apply.
 * @param orgId - The workspace.
 * @param o - What to re-run.
 * @param o.url - The pull request.
 * @param o.headSha - Its head.
 * @param o.taskId - The task.
 * @param o.why - The diagnosis.
 * @param o.owner - The seat proposing it.
 */
export async function rerunFailed(orgId: string, o: { url: string; headSha: string | null; taskId: number; why: string; owner: string | null }): Promise<{ ok: true; runId: number; pending: boolean } | { ok: false; error: string }> {
  try {
    const { proposeAction } = await import('@/services/ActionService');
    const res = await proposeAction({
      orgId,
      actionId: 'repo.rerun_failed_checks',
      input: { url: o.url, ...(o.headSha ? { headSha: o.headSha } : {}), taskId: o.taskId, reason: o.why.slice(0, 500) },
      principal: SYSTEM_PRINCIPAL(orgId, o.owner),
      invokedBy: `agent:${o.owner ?? 'system'}`,
      internal: true,
      proposal: { confidence: 0.9, rationale: `CI reads as flaky: ${o.why}`.slice(0, 500), agentSlug: o.owner ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'One re-run of the failed jobs; no code changes.' },
    } as never) as { runId: number; status: string; error?: string };
    if (res.status === 'failed') {
      return { ok: false, error: res.error ?? 'the re-run failed' };
    }
    return { ok: true, runId: res.runId, pending: res.status === 'pending' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * ONE FIX FOR A RED DEFAULT BRANCH, however many pull requests it blocks. An
 * open fix for the same repository and branch gains the pull request instead
 * of a second fix being filed. Filed as a request the factory carries
 * (`intakeDecision` starts a `pipelineFix` on its own).
 * @param orgId - The workspace.
 * @param o - The red branch and the pull request it blocks.
 * @param o.repo - `owner/name`.
 * @param o.branch - The default branch.
 * @param o.baseSha - Its head when it was read.
 * @param o.failing - The checks failing on it.
 * @param o.why - The diagnosis.
 * @param o.blocked - The pull request it blocks.
 * @param o.blocked.url - Its URL.
 * @param o.blocked.taskId - Its task.
 * @param o.blocked.requestId - Its request.
 * @param o.product - The product the blocked work is for.
 * @param o.owner - The seat filing it.
 * @param o.detail - What failed, for the fix's evidence.
 * @param o.cause
 * @param o.fixIn
 */
export async function fileMainFix(orgId: string, o: { repo: string; branch: string; baseSha: string | null; failing: string[]; why: string; blocked: { url: string; taskId: number; requestId: number | null }; product: string | null; owner: string | null; detail: string; cause?: 'main_broken' | 'infra'; fixIn?: CiFixPlace }): Promise<{ id: number; created: boolean }> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  const { CLOSED_REQUEST_STATES } = await import('@/libs/factory/requestStates');
  const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
  const infra = o.cause === 'infra';
  const fixIn: CiFixPlace = infra ? 'pipeline' : o.fixIn ?? 'code';
  const open = ((await listBusinessObjects(orgId, types.request).catch(() => [])) as Array<{ id: number; metadata: unknown }>).find((r) => {
    const m = (r.metadata ?? {}) as Meta;
    const fix = (m.pipelineFix ?? null) as Meta | null;
    // The same place, and the same kind of fix: a pipeline fix its owner writes is not an engineer's build.
    return fix && str(fix.repo) === o.repo && str(fix.branch) === o.branch && (str(fix.fixIn) ?? 'code') === fixIn && !fix.recheckedAt && !CLOSED_REQUEST_STATES.has(str(m.state) ?? 'new');
  });
  const blocked = { url: o.blocked.url, taskId: o.blocked.taskId, requestId: o.blocked.requestId };
  if (open) {
    const fix = ((open.metadata ?? {}) as Meta).pipelineFix as Meta;
    const blocks = Array.isArray(fix.blocks) ? (fix.blocks as Array<{ url?: string }>) : [];
    if (!blocks.some(b => b.url === o.blocked.url)) {
      await writeMeta(orgId, open.id, { pipelineFix: { ...fix, blocks: [...blocks, blocked] } });
      const { noteOnRequest } = await import('./carry');
      await noteOnRequest(orgId, open.id, `${o.blocked.url} is blocked by ${o.branch} too; it is checked again when this lands.`).catch(() => undefined);
    }
    return { id: open.id, created: false };
  }
  const { createBusinessObject } = await import('@/services/BusinessObjectService');
  const checks = o.failing.slice(0, 5).join(', ') || 'its checks';
  const row = await createBusinessObject({
    typeSlug: types.request,
    title: (infra ? `The pipeline could not run on ${o.repo}: ${checks}` : `${o.branch} is red on ${o.repo}: ${checks}`).slice(0, 140),
    metadata: {
      kind: 'incident',
      severity: 'p2',
      channel: 'github',
      state: 'new',
      ...(o.product ? { product: o.product } : {}),
      outcome: infra
        ? `The pipeline on ${o.repo} runs its checks again, and every pull request it blocked is checked again.`
        : `${o.branch} of ${o.repo} passes its checks again, and every pull request it blocked is checked again against it.`,
      story: infra ? `CI on the factory's pull requests could not run: ${o.why}` : `CI on the factory's pull requests is red because ${o.branch} itself is: ${o.why}`,
      body: `What failed (read from GitHub by the pipeline's owner):\n${o.detail || checks}`.slice(0, 4000),
      acceptance: [
        { statement: infra ? `${checks} run to completion on ${o.repo}.` : `${checks} pass on ${o.branch} of ${o.repo}.` },
        { statement: 'Every pull request listed as blocked on this request is checked again against the fixed branch.' },
      ],
      evidence: [{ label: `The checks on ${o.blocked.url}`, url: `${o.blocked.url}/checks` }],
      pipelineFix: { repo: o.repo, branch: o.branch, sha: o.baseSha, failing: o.failing, at: new Date().toISOString(), owner: o.owner, cause: o.cause ?? 'main_broken', fixIn, blocks: [blocked] },
    },
  }, orgId, `agent:${o.owner ?? 'system'}`, { source: 'service', actor: `agent:${o.owner ?? 'system'}` });
  // THE PIPELINE'S OWNER FIXES THE PIPELINE ITSELF (backlog 049): a fix in
  // the workflows, the runner or a check's config is not an engineer's build.
  if (fixIn === 'pipeline') {
    const { raisePipelineFix } = await import('./pipelineChange');
    await raisePipelineFix(orgId, { recordId: row!.id, title: String(row!.title ?? ''), repo: o.repo, branch: o.branch, cause: o.cause ?? 'main_broken', why: o.why, failing: checks, url: o.blocked.url, owner: o.owner });
  }
  return { id: row!.id, created: true };
}

/**
 * The watch over tasks waiting on QA with no review behind them.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param input - The automation's `do.input` (`owner`).
 */
export async function watchAwaitingReview(orgId: string, now: Date = new Date(), input: Meta = {}): Promise<Result[]> {
  const { and, desc, eq, gt, inArray, lt, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema, businessObjectSchema, eventLogSchema } = await import('@/models/Schema');
  const waiting = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata, updatedAt: businessObjectSchema.updatedAt })
    .from(businessObjectSchema)
    // A failed review is watched too: QA that could not finish gets another
    // review, at most REVIEW_RESTARTS times per task, so it can never loop.
    .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.status, ['awaiting_review', 'review_failed']), lt(businessObjectSchema.updatedAt, new Date(now.getTime() - AWAITING_REVIEW_QUIET_MS))))
    .limit(20);
  const out: Result[] = [];
  for (const task of waiting) {
    const meta = (task.meta ?? {}) as Meta;
    const url = str(meta.prUrl);
    // A pull request waiting on a fix to its base is watched by the reconciler, not here.
    if (!url || (meta.mainBlocked && typeof meta.mainBlocked === 'object')) {
      continue;
    }
    const since = task.updatedAt ?? new Date(0);
    const [reviewed] = await db.select({ id: automationRunSchema.id }).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), sql`${automationRunSchema.input} ->> 'url' = ${url}`, gt(automationRunSchema.startedAt, since))).limit(1);
    const restarts = Number(meta.reviewRestarts ?? 0);
    if (reviewed || restarts >= REVIEW_RESTARTS) {
      continue;
    }
    const [checks] = await db.select({ payload: eventLogSchema.payload, dedupeKey: eventLogSchema.dedupeKey }).from(eventLogSchema).where(and(eq(eventLogSchema.orgId, orgId), eq(eventLogSchema.type, 'pr.checks_completed'), sql`${eventLogSchema.payload} ->> 'url' = ${url}`)).orderBy(desc(eventLogSchema.id)).limit(1);
    if (!checks) {
      continue;
    }
    const payload = (checks.payload ?? {}) as Meta;
    if (str(payload.conclusion) !== 'success') {
      const r = await ciFailed(orgId, { ...input, ...payload }).catch(err => ({ requestId: Number(meta.requestId) || null, did: 'ci failed: could not answer', line: (err as Error).message }));
      if (r.did !== 'already answered') {
        out.push(r);
      }
      continue;
    }
    // CI passed and no review ran (or the last one could not finish): raise
    // the event again so the review starts, and count it. Keyed on the count,
    // so each restart is its own event and a second pass of the same one is not.
    await db.update(businessObjectSchema)
      .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ reviewRestarts: restarts + 1 })}::jsonb` })
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, task.id)));
    const { emitEvent } = await import('@/services/EventService');
    await emitEvent({ orgId, type: 'pr.checks_completed', payload, dedupeKey: `${checks.dedupeKey ?? url}:resweep:${restarts + 1}`, invokedBy: 'system:factory-reconcile' }).catch(() => undefined);
    const line = `QA had not started on ${url}; the review was started again (${restarts + 1} of ${REVIEW_RESTARTS}).`;
    await note(orgId, Number(meta.requestId) || null, line);
    out.push({ requestId: Number(meta.requestId) || null, did: 'review started again', line });
  }
  return out;
}
