/**
 * A FAILED DEPLOY NOBODY ANSWERED IS ANSWERED BY THE RECONCILE (2026-10-01,
 * #294: PR #147 merged at 10:21, the deploy failed on a known QEMU flake that
 * a re-run fixes, Vocion heard `run.failed` at 10:30 — and nothing happened
 * for two hours, because the automation that answers a failed deploy had been
 * paused since 21 September and nothing said so. Resuming it later did not
 * help: the event was gone).
 *
 * Every five minutes (`factory-reconcile`), each workflow that deploys an
 * environment is read back on its deploy branch. A run of it that failed in
 * the last day, and that no newer run of the same workflow has since deployed
 * past, gets the handling `run.failed` would have given it: every automation
 * subscribed to `run.failed` whose filter matches the run and that has no run
 * of its own for that run id and attempt is fired now, with the event's own
 * payload. The automation run it leaves is the key, so a run is answered once.
 *
 *   - A PAUSED AUTOMATION IS A PERSON'S CHOICE and is not overridden. It is
 *     shown, once per failed run: a `skipped` row on the automation, a line
 *     on the environments the workflow deploys and on the feature whose merge
 *     it carried — "Deploy failed and its automation is paused (since …, by
 *     …): Resume" — and the feature's delivery carries the pause, so its page
 *     reads Blocked with Resume as the move. Once resumed, the next pass
 *     answers the run like any other.
 *   - THE ANSWER IS WRITTEN ON THE FEATURE: who is on it (the seat that owns
 *     the automation that answered) or the pause, on `delivery.answer`, so the
 *     feature page and its Work row say "Deploy run #59 failed (step API) ·
 *     Release engineer is on it".
 *
 * Nothing here names a workflow, an automation or a seat: the environments
 * say which workflows deploy, the automations say which of them answer
 * `run.failed`, and an automation that runs a deterministic job records a
 * deploy rather than answering one.
 */

import type { WorkflowRunSummary } from './githubChecks';
import type { DeliveryAnswer } from '@/libs/factory/delivery';

type Meta = Record<string, unknown>;
type Result = { recordId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

/** A failed deploy older than this is history: its answer, if any, has been given or never will be by this path. */
export const UNANSWERED_WINDOW_MS = 24 * 3_600_000;
/** How many times a fire that could not start is tried again for one run. */
const MAX_FIRE_FAILURES = 3;
/** A run whose conclusion is a failure, as `libs/github/events.ts` raises `run.failed` for it. */
const FAILING = new Set(['failure', 'timed_out', 'startup_failure', 'action_required', 'stale']);

/** What the watch reads and does, injected in tests. */
export type DeployFailureDeps = {
  runs: (orgId: string, repo: string, workflow: string, branch: string) => Promise<WorkflowRunSummary[]>;
  deployBranch: (orgId: string, repo: string) => Promise<string>;
  /** Start one automation's fire for the run; resolves once its run row exists. */
  fire: (orgId: string, slug: string, payload: Meta) => Promise<{ automationRunId: number }>;
};

async function defaultDeps(): Promise<DeployFailureDeps> {
  const gh = await import('./githubChecks');
  return {
    runs: (orgId, repo, workflow, branch) => gh.listWorkflowRuns(orgId, repo, { workflow, branch, limit: 20 }),
    deployBranch: async (orgId, repo) => {
      const { sourceConfigForRepo } = await import('@/services/agents/tools/githubPullRead');
      return str((await sourceConfigForRepo(orgId, repo).catch(() => null))?.deployBranch) ?? await (await import('./githubChange')).defaultBranch(orgId, repo);
    },
    fire: async (orgId, slug, payload) => {
      // The row is written before this resolves, so the run is answered once;
      // the work (an agent reading the logs) runs after, off the pass.
      const { beginAutomationFire, completeAutomationFire } = await import('@/services/AutomationService');
      const pending = await beginAutomationFire(orgId, slug, { input: payload, invokedBy: 'system:factory-reconcile' });
      void completeAutomationFire(pending).catch(() => undefined);
      return { automationRunId: pending.automationRunId };
    },
  };
}

/**
 * The failed runs still owed an answer: completed, failed, in the window, and
 * not deployed past by a newer run of the same workflow.
 * @param runs - The workflow's runs on its deploy branch.
 * @param now - The clock.
 */
export function owedRuns(runs: readonly WorkflowRunSummary[], now: Date): WorkflowRunSummary[] {
  const since = now.getTime() - UNANSWERED_WINDOW_MS;
  const newestGreen = Math.max(0, ...runs.filter(r => r.status === 'completed' && r.conclusion === 'success').map(r => r.runNumber));
  return runs.filter((r) => {
    const at = Date.parse(r.updatedAt ?? r.createdAt ?? '');
    return r.status === 'completed' && FAILING.has(r.conclusion ?? '') && Number.isFinite(at) && at >= since && r.runNumber > newestGreen;
  });
}

type AutomationRow = { slug: string; name: string; status: string; whenConfig: { event?: string | string[]; filter?: unknown }; doConfig: { job?: string }; ownerAgentSlug: string | null; pausedAt: Date | null; pausedBy: string | null; pausedNote: string | null };
type RunRow = { id: number; kind: string; status: string; result: unknown; startedAt: Date | null };

/**
 * The fires an automation already made for one run and attempt.
 * @param orgId - Tenant.
 * @param slugs - The automations.
 * @param runId - The GitHub run.
 * @param attempt - Its attempt.
 */
async function firesFor(orgId: string, slugs: string[], runId: number, attempt: number): Promise<Map<string, RunRow[]>> {
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema } = await import('@/models/Schema');
  const out = new Map<string, RunRow[]>();
  if (slugs.length === 0) {
    return out;
  }
  const rows = await db.select({ id: automationRunSchema.id, slug: automationRunSchema.slug, kind: automationRunSchema.kind, status: automationRunSchema.status, result: automationRunSchema.result, startedAt: automationRunSchema.startedAt })
    .from(automationRunSchema)
    .where(and(
      eq(automationRunSchema.orgId, orgId),
      inArray(automationRunSchema.slug, slugs),
      sql`${automationRunSchema.input} ->> 'runId' = ${String(runId)}`,
      sql`coalesce(${automationRunSchema.input} ->> 'runAttempt', '1') = ${String(attempt)}`,
    ));
  for (const r of rows) {
    out.set(r.slug, [...(out.get(r.slug) ?? []), r]);
  }
  return out;
}

const isFire = (r: RunRow) => r.kind !== 'skipped' && r.kind !== 'control';
const skipReason = (r: RunRow) => (r.kind === 'skipped' ? str(obj(r.result)?.reason) : null);

/**
 * The seat that owns an automation, by name.
 * @param orgId - Tenant.
 * @param slug - The agent's slug.
 */
async function seatName(orgId: string, slug: string | null): Promise<string | null> {
  if (!slug) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const [row] = await db.select({ name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).limit(1);
  return row?.name?.trim() || slug;
}

/**
 * The features whose merge this run carried: their delivery names its commit or the run.
 * @param orgId - Tenant.
 * @param run - The run.
 */
async function featuresOf(orgId: string, run: WorkflowRunSummary): Promise<Array<{ id: number; meta: Meta }>> {
  const { and, eq, or, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  return (await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(
    eq(businessObjectSchema.orgId, orgId),
    or(
      sql`${businessObjectSchema.metadata} -> 'delivery' ->> 'mergeSha' = ${run.headSha}`,
      sql`${businessObjectSchema.metadata} -> 'delivery' -> 'runs' @> ${JSON.stringify([{ runId: run.id }])}::jsonb`,
    ),
  )).limit(10)).map(r => ({ id: r.id, meta: (r.meta ?? {}) as Meta }));
}

/**
 * Write the answer on each feature's delivery, when it changed.
 * @param orgId - Tenant.
 * @param features - The features the run carried.
 * @param answer - Who is on it, or the pause.
 */
async function writeAnswer(orgId: string, features: Array<{ id: number; meta: Meta }>, answer: DeliveryAnswer): Promise<void> {
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  for (const f of features) {
    const delivery = obj(f.meta.delivery);
    if (!delivery) {
      continue;
    }
    const prior = obj(delivery.answer);
    const same = prior && Number(prior.runId) === answer.runId && prior.slug === answer.slug && Number(prior.automationRunId ?? 0) === Number(answer.automationRunId ?? 0) && !!prior.paused === !!answer.paused && prior.by === answer.by;
    if (!same) {
      await writeMeta(orgId, f.id, { delivery: { ...delivery, answer } });
    }
  }
}

/**
 * One reconcile pass over failed deploys: answer what nobody answered, say
 * what a pause is holding, and write who is on each.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function answerFailedDeploys(orgId: string, now: Date, deps?: DeployFailureDeps): Promise<Result[]> {
  const { environmentRows } = await import('./environments');
  const envs = (await environmentRows(orgId)).filter(e => e.repo && str(obj(e.meta.deploy)?.workflow));
  if (envs.length === 0) {
    return [];
  }
  // A stopped workspace answers nothing; its own pause already says so.
  const { readWorkspacePauseWithName } = await import('@/services/workspacePause');
  if (await readWorkspacePauseWithName(orgId)) {
    return [];
  }
  const { matchesFilter, subscribesTo } = await import('@/services/eventFilter');
  const { RUN_FAILED, runFailedEvent } = await import('@/libs/github/events');
  const { listAutomations } = await import('@/services/AutomationService');
  const subscribers = ((await listAutomations(orgId)) as unknown as AutomationRow[]).filter(a => a.status === 'active' && subscribesTo(a.whenConfig?.event, RUN_FAILED));
  if (subscribers.length === 0) {
    return [];
  }
  const d = deps ?? await defaultDeps();
  const groups = new Map<string, typeof envs>();
  for (const e of envs) {
    const key = `${e.repo!.toLowerCase()}|${str(obj(e.meta.deploy)?.workflow)!.split('/').pop()!.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const out: Result[] = [];
  const { recordPausedMatch, noteOnAffected, pauserName } = await import('./pausedMatch');
  for (const rows of groups.values()) {
    const repo = rows[0]!.repo!;
    const workflow = str(obj(rows[0]!.meta.deploy)?.workflow)!;
    let runs: WorkflowRunSummary[];
    try {
      runs = await d.runs(orgId, repo, workflow, await d.deployBranch(orgId, repo));
    } catch (err) {
      console.warn('failed-deploy watch: the runs could not be read', { orgId, repo, workflow, message: (err as Error).message });
      continue;
    }
    for (const run of owedRuns(runs, now)) {
      const event = runFailedEvent(repo, { id: run.id, name: run.name, head_branch: run.branch, head_sha: run.headSha, run_number: run.runNumber, run_attempt: run.attempt, event: run.event, status: run.status, conclusion: run.conclusion, html_url: run.url, updated_at: run.updatedAt, path: run.path, created_at: run.createdAt ?? undefined });
      if (!event) {
        continue;
      }
      const payload = event.payload as unknown as Meta;
      const matching = subscribers.filter(a => matchesFilter(payload, a.whenConfig?.filter));
      const fires = await firesFor(orgId, matching.map(a => a.slug), run.id, run.attempt);
      const features = await featuresOf(orgId, run);
      const records = { requests: features.map(f => f.id), others: rows.map(r => r.id) };
      const failedAt = run.updatedAt.slice(11, 16);
      let answer: DeliveryAnswer | null = null;
      for (const a of matching) {
        const own = fires.get(a.slug) ?? [];
        // An automation that runs a deterministic job records the deploy; one
        // that runs an agent answers it, and that is the answer the feature shows.
        const answers = !a.doConfig?.job;
        const fired = own.filter(isFire).sort((x, y) => y.id - x.id)[0];
        if (fired) {
          if (answers && !answer) {
            answer = { runId: run.id, automation: a.name, slug: a.slug, by: await seatName(orgId, a.ownerAgentSlug), automationRunId: fired.id, at: (fired.startedAt ?? now).toISOString(), paused: null };
          }
          continue;
        }
        if (a.pausedAt) {
          if (answers && !answer) {
            answer = { runId: run.id, automation: a.name, slug: a.slug, by: null, automationRunId: null, at: now.toISOString(), paused: { since: a.pausedAt.toISOString(), by: await pauserName(orgId, a.pausedBy), note: a.pausedNote } };
          }
          if (own.some(r => skipReason(r) === 'automation_paused')) {
            continue;
          }
          const would = `${run.name || 'The deploy'} run #${run.runNumber} on ${run.headSha.slice(0, 7)} failed at ${failedAt} UTC and would have been answered by "${a.name}"`;
          const res = await recordPausedMatch(orgId, { slug: a.slug, name: a.name, pausedAt: a.pausedAt, pausedBy: a.pausedBy, pausedNote: a.pausedNote }, { event: RUN_FAILED, payload, would, records });
          out.push({ recordId: rows[0]!.id, did: 'failed deploy: automation paused', line: res.line });
          continue;
        }
        if (own.filter(r => skipReason(r) === 'fire_failed').length >= MAX_FIRE_FAILURES) {
          continue;
        }
        try {
          const res = await d.fire(orgId, a.slug, { ...payload, reconciled: `No run of "${a.name}" answered this failed run; the reconcile read it back from GitHub and handed it on.` });
          if (answers && !answer) {
            answer = { runId: run.id, automation: a.name, slug: a.slug, by: await seatName(orgId, a.ownerAgentSlug), automationRunId: res.automationRunId, at: now.toISOString(), paused: null };
          }
          const line = `${run.name || 'The deploy'} run #${run.runNumber} on ${run.headSha.slice(0, 7)} failed at ${failedAt} UTC and nothing answered it; the reconcile handed it to "${a.name}" (automation run #${res.automationRunId}).`;
          if (answers) {
            await noteOnAffected(orgId, records, line, { url: run.url });
          }
          out.push({ recordId: rows[0]!.id, did: 'failed deploy: answered', line });
        } catch (err) {
          const { recordSkippedFire } = await import('@/services/AutomationService');
          const message = (err as Error).message;
          await recordSkippedFire(orgId, a.slug, { event: RUN_FAILED, payload, invokedBy: 'system:factory-reconcile', result: { kind: 'skipped', reason: 'fire_failed', detail: `the reconcile could not hand run #${run.runNumber} to "${a.name}": ${message}`.slice(0, 500), event: RUN_FAILED, causedBy: null }, error: message }).catch(() => undefined);
          out.push({ recordId: rows[0]!.id, did: 'failed deploy: fire failed', line: message });
        }
      }
      if (answer) {
        await writeAnswer(orgId, features, answer);
      }
    }
  }
  return out;
}
