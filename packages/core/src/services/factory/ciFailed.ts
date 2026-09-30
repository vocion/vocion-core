/**
 * A FACTORY PULL REQUEST WHOSE CI FAILED GOES BACK TO ITS ENGINEER (Chris,
 * 2026-09-30, on #269: "Why is it stuck? Why did chat lie and not try to
 * progress it"). The worker's own checks passed 6 of 6, GitHub's CI failed on
 * an integration test, and QA only starts on a green CI: the task sat
 * "awaiting review" for seven hours with nothing running, and the page and the
 * PM both said QA was checking it.
 *
 * Two paths, one outcome:
 *   - `ciFailed` answers the `pr.checks_completed` event whose conclusion is
 *     not success: the attempt is built again, carrying the failing checks and
 *     what GitHub's annotations say, on the same per-stage limit.
 *   - `watchAwaitingReview` (the sweep) finds a task waiting on QA with no
 *     review behind it: CI failed → `ciFailed`; CI passed and no review ran →
 *     the event is raised again so the review starts. Nothing waits unwatched.
 */

type Meta = Record<string, unknown>;
type Result = { requestId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** How long a task may wait on QA with no review running before the sweep looks. */
export const AWAITING_REVIEW_QUIET_MS = 15 * 60_000;

/**
 * What GitHub says failed on a commit: each failing check with its annotation messages.
 * @param orgId - The workspace (its GitHub token).
 * @param prUrl - The pull request.
 * @param headSha - The commit the checks ran on.
 */
export async function failedCheckDetail(orgId: string, prUrl: string, headSha: string | null): Promise<string> {
  const { parsePullUrl, tokenForRepo } = await import('@/services/agents/tools/githubPullRead');
  const pr = parsePullUrl(prUrl);
  const token = pr ? await tokenForRepo(orgId, `${pr.owner}/${pr.repo}`).catch(() => null) : null;
  if (!pr || !token || !headSha) {
    return '';
  }
  const headers = { 'authorization': `Bearer ${token}`, 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion' };
  const base = `https://api.github.com/repos/${pr.owner}/${pr.repo}`;
  const res = await fetch(`${base}/commits/${headSha}/check-runs?per_page=50`, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) {
    return '';
  }
  const runs = ((await res.json()) as { check_runs?: Array<{ id: number; name: string; conclusion: string | null }> }).check_runs ?? [];
  const lines: string[] = [];
  for (const run of runs.filter(r => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion)).slice(0, 3)) {
    const a = await fetch(`${base}/check-runs/${run.id}/annotations`, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const notes = a?.ok ? ((await a.json()) as Array<{ path?: string; message?: string; annotation_level?: string }>).filter(n => n.annotation_level === 'failure').slice(0, 4) : [];
    lines.push(`${run.name}: ${notes.length > 0 ? notes.map(n => `${n.message ?? ''}${n.path && n.path !== '.github' ? ` (${n.path})` : ''}`.replace(/\s+/g, ' ').trim()).join('; ') : run.conclusion}`);
  }
  return lines.join('\n').slice(0, 2500);
}

/**
 * CI failed on a factory pull request: build the attempt again with what failed.
 * @param orgId - The workspace.
 * @param payload - The `pr.checks_completed` event payload.
 */
export async function ciFailed(orgId: string, payload: Meta): Promise<Result> {
  const url = str(payload.url);
  if (!url || str(payload.conclusion) === 'success') {
    return { requestId: null, did: 'not a failed check', line: null };
  }
  const { buildAgain, findTaskByPr } = await import('@/services/agents/tools/recordVerdict');
  const task = await findTaskByPr(orgId, url);
  const requestId = task ? Number(task.meta.requestId) || null : null;
  if (!task || String(task.status ?? '') !== 'awaiting_review') {
    return { requestId, did: 'no task waiting on this pull request', line: null };
  }
  const headSha = str(payload.headSha);
  const taskSha = str(task.meta.commitSha);
  if (headSha && taskSha && !headSha.startsWith(taskSha.slice(0, 7)) && !taskSha.startsWith(headSha.slice(0, 7))) {
    return { requestId, did: 'the checks are for another commit', line: null };
  }
  const names = Array.isArray(payload.failedChecks) ? (payload.failedChecks as unknown[]).map(String).join(', ') : 'the required checks';
  const detail = await failedCheckDetail(orgId, url, headSha ?? taskSha).catch(() => '');
  const why = `CI failed on the pull request (${names})`;
  const note = `${why}, although the worker's own run of the checks passed. What failed:\n${detail || '(no annotation text; open the checks on the pull request)'}\nReproduce it the way CI runs (a clean install, the full suite, its database), fix it, and keep what is already proven.`;
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db.update(businessObjectSchema)
    .set({ status: 'changes_requested', metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ status: 'changes_requested', ciFailure: { at: new Date().toISOString(), checks: names, detail: detail.slice(0, 1500) } })}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, task.id)));
  const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
  await recomputeRollupsForObject(orgId, task.id).catch(() => undefined);
  const line = await buildAgain(orgId, { id: task.id, meta: task.meta }, { to: 'engineer', why, note });
  return { requestId, did: 'ci failed: built again', line: line ? `${why}. ${line}` : why };
}

/**
 * The sweep's watch over tasks waiting on QA with no review behind them.
 * @param orgId - The workspace.
 * @param now - The clock.
 */
export async function watchAwaitingReview(orgId: string, now: Date = new Date()): Promise<Result[]> {
  const { and, desc, eq, gt, lt, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema, businessObjectSchema, eventLogSchema } = await import('@/models/Schema');
  const waiting = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata, updatedAt: businessObjectSchema.updatedAt })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.status, 'awaiting_review'), lt(businessObjectSchema.updatedAt, new Date(now.getTime() - AWAITING_REVIEW_QUIET_MS))))
    .limit(20);
  const out: Result[] = [];
  for (const task of waiting) {
    const meta = (task.meta ?? {}) as Meta;
    const url = str(meta.prUrl);
    if (!url) {
      continue;
    }
    const since = task.updatedAt ?? new Date(0);
    const [reviewed] = await db.select({ id: automationRunSchema.id }).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), sql`${automationRunSchema.input} ->> 'url' = ${url}`, gt(automationRunSchema.startedAt, since))).limit(1);
    if (reviewed) {
      continue;
    }
    const [checks] = await db.select({ payload: eventLogSchema.payload, dedupeKey: eventLogSchema.dedupeKey }).from(eventLogSchema).where(and(eq(eventLogSchema.orgId, orgId), eq(eventLogSchema.type, 'pr.checks_completed'), sql`${eventLogSchema.payload} ->> 'url' = ${url}`)).orderBy(desc(eventLogSchema.id)).limit(1);
    if (!checks) {
      continue;
    }
    const payload = (checks.payload ?? {}) as Meta;
    if (str(payload.conclusion) !== 'success') {
      out.push(await ciFailed(orgId, payload).catch(err => ({ requestId: Number(meta.requestId) || null, did: 'ci failed: could not build again', line: (err as Error).message })));
      continue;
    }
    // CI passed and no review ran: raise the event again so the review starts.
    const { emitEvent } = await import('@/services/EventService');
    await emitEvent({ orgId, type: 'pr.checks_completed', payload, dedupeKey: `${checks.dedupeKey ?? url}:resweep:${now.toISOString().slice(0, 13)}`, invokedBy: 'system:factory-sweep' }).catch(() => undefined);
    out.push({ requestId: Number(meta.requestId) || null, did: 'review started again', line: `QA had not started on ${url}; the review was started again.` });
  }
  return out;
}
