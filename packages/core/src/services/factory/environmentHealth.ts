/**
 * AN UNHEALTHY ENVIRONMENT IS BROUGHT BACK, OR A PERSON HEARS ONCE (backlog
 * 049; Chris, 2026-09-30: "a scheduled health read per environment that has a
 * healthCheck. An unhealthy one raises one needs-person notification only
 * after the Release engineer's own recovery (re-run, redeploy, revert of the
 * last release) has been tried and failed, with each attempt recorded").
 *
 * Every pass reads each environment's health (`environments.readHealth`) and
 * writes it on the record. An environment that is down or degraded on two
 * reads in a row starts its recovery, one step a pass, each given time to
 * work before the next:
 *
 *   rerun      the last run of its deploy workflow failed: its failed jobs
 *              run again (`github.rerun_failed_jobs`).
 *   redeploy   the deploy workflow runs again on the deploy branch
 *              (`github.dispatch_workflow`), when it can be started by hand.
 *   rollback   it was healthy on the commit before its last deploy and is not
 *              on this one: that release's pull request is reverted
 *              (`github.revert_pull`), and the revert merges itself on green.
 *
 * Each step is an action on the rail — done for you, its Undo on it — and a
 * line on the environment's own account. A step that does not apply is not
 * taken. Healthy again, the recovery closes and says after what. Out of steps
 * and still unhealthy: one incident request and one ask
 * (`pipelineChange.escalatePipeline`), the needs-person notification, and the
 * next pass says nothing more until a person answers or it is healthy.
 *
 * Nothing here names a product, stage or surface: the records say how each
 * environment deploys and what its health check must read.
 */

import type { EnvironmentRow, HealthReading, WorkflowTriggers } from './environments';
import type { WorkflowRunSummary } from './githubChecks';

type Meta = Record<string, unknown>;
type Result = { recordId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

/** How many unhealthy reads in a row start a recovery: one bad read is a blip. */
export const CONFIRM_READS = 2;

export const RECOVERY_STEPS = ['rerun', 'redeploy', 'rollback'] as const;
export type RecoveryStep = typeof RECOVERY_STEPS[number];

/** How long each step is given to work before the next one is taken. */
export const STEP_WAIT_MS: Record<RecoveryStep, number> = { rerun: 15 * 60_000, redeploy: 20 * 60_000, rollback: 45 * 60_000 };

export type RecoveryAttempt = { n: number; kind: RecoveryStep; at: string; actionRunId: number | null; status: string; url: string | null; error?: string | null };
export type HealthRecovery = { since: string; badReads: number; attempts: RecoveryAttempt[]; closedAt?: string | null; stoppedAt?: string | null; askId?: number | null; incidentId?: number | null };

export function readHealthRecovery(meta: Meta): HealthRecovery | null {
  const r = obj(meta.healthRecovery);
  return r && typeof r.since === 'string' ? { badReads: 0, attempts: [], ...r } as unknown as HealthRecovery : null;
}

/** Where the health watch reads and acts, injected in tests. */
export type WatchDeps = {
  health: (orgId: string, env: Meta) => Promise<HealthReading | null>;
  deployBranch: (orgId: string, repo: string) => Promise<string>;
  latestRun: (orgId: string, repo: string, workflow: string, branch: string) => Promise<WorkflowRunSummary | null>;
  triggers: (orgId: string, repo: string, workflow: string, ref: string) => Promise<WorkflowTriggers | null>;
  mergedPullFor: (orgId: string, repo: string, sha: string) => Promise<string | null>;
  propose: (orgId: string, o: { actionId: string; input: Meta; owner: string | null; why: string }) => Promise<{ runId: number; status: string; error?: string }>;
};

async function defaultDeps(): Promise<WatchDeps> {
  const gh = await import('./githubChecks');
  const env = await import('./environments');
  return {
    health: (orgId, meta) => env.readHealth(orgId, meta),
    deployBranch: async (orgId, repo) => {
      const { sourceConfigForRepo } = await import('@/services/agents/tools/githubPullRead');
      return str((await sourceConfigForRepo(orgId, repo))?.deployBranch) ?? await (await import('./githubChange')).defaultBranch(orgId, repo);
    },
    latestRun: async (orgId, repo, workflow, branch) => (await gh.listWorkflowRuns(orgId, repo, { workflow, branch, limit: 1 }))[0] ?? null,
    triggers: env.readWorkflowTriggers,
    mergedPullFor: gh.mergedPullFor,
    propose: async (orgId, o) => {
      const { proposeAction } = await import('@/services/ActionService');
      return await proposeAction({
        orgId,
        actionId: o.actionId,
        input: o.input,
        principal: { kind: 'agent', id: `agent:${o.owner ?? 'system'}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${o.owner ?? 'system'}`,
        internal: true,
        proposal: { confidence: 0.9, rationale: o.why.slice(0, 500), agentSlug: o.owner ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'The environment is unhealthy; this is the next step of its recovery, and Undo takes it back.' },
      } as never) as { runId: number; status: string; error?: string };
    },
  };
}

/**
 * A write that does not move `updatedAt`: reading health is not a change to the record.
 * @param orgId
 * @param id
 * @param set
 */
async function quiet(orgId: string, id: number, set: Meta): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db.update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: sql`${businessObjectSchema.updatedAt}` })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

type Planned = { kind: RecoveryStep; actionId: string; input: Meta; url: string | null; why: string };

/**
 * The next recovery step that applies, or null when none is left.
 * @param orgId - The workspace.
 * @param env - The environment.
 * @param rec - Its recovery so far.
 * @param reading - What its health just said.
 * @param d - The reads.
 */
export async function nextStep(orgId: string, env: EnvironmentRow, rec: HealthRecovery, reading: HealthReading, d: WatchDeps): Promise<Planned | null> {
  const tried = new Set(rec.attempts.map(a => a.kind));
  const deploy = obj(env.meta.deploy);
  const workflow = str(deploy?.workflow);
  const repo = env.repo;
  const name = str(env.meta.slug) ?? env.title;
  const why = `${name} is ${reading.health} (${reading.detail})`;
  if (!repo) {
    return null;
  }
  const branch = workflow ? await d.deployBranch(orgId, repo) : null;
  if (workflow && branch && !tried.has('rerun')) {
    const run = await d.latestRun(orgId, repo, workflow, branch).catch(() => null);
    if (run && run.status === 'completed' && run.conclusion && !['success', 'neutral', 'skipped'].includes(run.conclusion)) {
      return { kind: 'rerun', actionId: 'github.rerun_failed_jobs', input: { url: run.url, recordId: env.id, reason: `${why}, and its last deploy run #${run.runNumber} ended ${run.conclusion}.` }, url: run.url, why };
    }
  }
  if (workflow && branch && !tried.has('redeploy')) {
    const triggers = await d.triggers(orgId, repo, workflow, branch).catch(() => null);
    if (triggers?.dispatchable) {
      const sha = str(env.meta.lastDeployedSha);
      return { kind: 'redeploy', actionId: 'github.dispatch_workflow', input: { repo, workflow, ref: branch, ...(sha && /^[0-9a-f]{7,40}$/i.test(sha) ? { sha } : {}), recordId: env.id, reason: `${why}; redeploying what is merged, as step ${rec.attempts.length + 1} of its recovery.` }, url: null, why };
    }
  }
  const healthy = str(env.meta.lastHealthySha);
  const deployed = str(env.meta.lastDeployedSha);
  if (!tried.has('rollback') && healthy && deployed && healthy !== deployed) {
    const pull = await d.mergedPullFor(orgId, repo, deployed).catch(() => null);
    if (pull) {
      return { kind: 'rollback', actionId: 'github.revert_pull', input: { url: pull, recordId: env.id, reason: `${why}; it was healthy on ${healthy.slice(0, 7)} before ${deployed.slice(0, 7)} deployed, and ${rec.attempts.length > 0 ? rec.attempts.map(a => a.kind).join(' and ') : 'nothing else'} did not bring it back.` }, url: pull, why };
    }
  }
  return null;
}

async function fileIncident(orgId: string, env: EnvironmentRow, reading: HealthReading, tried: string[], owner: string | null): Promise<number> {
  const { createBusinessObject } = await import('@/services/BusinessObjectService');
  const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
  const name = str(env.meta.slug) ?? env.title;
  const row = await createBusinessObject({
    typeSlug: types.request,
    title: `${name} is ${reading.health}`.slice(0, 140),
    metadata: {
      kind: 'incident',
      severity: str(env.meta.stage) === 'production' ? 'p1' : 'p2',
      channel: 'pipeline',
      state: 'new',
      ...(str(env.meta.product) ? { product: str(env.meta.product) } : {}),
      environment: name,
      environmentId: env.id,
      outcome: `${name} answers its health check again.`,
      story: `${name} is ${reading.health}: ${reading.detail}. The pipeline's own recovery did not bring it back.`,
      body: [`Health: ${reading.detail}`, tried.length > 0 ? `Tried:\n${tried.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : 'No recovery step applied.'].join('\n\n').slice(0, 4000),
      evidence: [{ label: 'Health check', url: reading.url }, ...(str(env.meta.lastDeployRunUrl) ? [{ label: 'Last deploy run', url: str(env.meta.lastDeployRunUrl)! }] : [])],
    },
  }, orgId, `agent:${owner ?? 'system'}`, { source: 'service', actor: `agent:${owner ?? 'system'}` });
  return row!.id;
}

/**
 * One pass over every environment that has a health check.
 * @param orgId - The workspace.
 * @param input - The automation's `do.input` (`owner`: the seat that owns the pipeline).
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function watchEnvironments(orgId: string, input: Meta = {}, now: Date = new Date(), deps?: WatchDeps): Promise<{ acted: Result[] }> {
  const owner = str(input.owner);
  const { environmentRows, healthFields, noteOnRecord } = await import('./environments');
  const envs = (await environmentRows(orgId)).filter(e => obj(e.meta.healthCheck) && str(e.meta.stage) !== 'local');
  if (envs.length === 0) {
    return { acted: [] };
  }
  const d = deps ?? await defaultDeps();
  const acted: Result[] = [];
  for (const env of envs) {
    try {
      const r = await watchOne(orgId, env, now, owner, d, { healthFields, noteOnRecord });
      if (r) {
        acted.push(r);
      }
    } catch (err) {
      console.warn('environment health: a pass failed', { orgId, environmentId: env.id, message: (err as Error).message });
    }
  }
  return { acted };
}

async function watchOne(orgId: string, env: EnvironmentRow, now: Date, owner: string | null, d: WatchDeps, lib: Pick<typeof import('./environments'), 'healthFields' | 'noteOnRecord'>): Promise<Result | null> {
  const reading = await d.health(orgId, env.meta);
  if (!reading) {
    return null;
  }
  const at = now.toISOString();
  const name = str(env.meta.slug) ?? env.title;
  const prior = str(env.meta.lastHealth);
  let rec = readHealthRecovery(env.meta);
  const set: Meta = { ...lib.healthFields(reading, str(obj(env.meta.healthCheck)?.expect)), ...(reading.health === 'ok' && str(env.meta.lastDeployedSha) ? { lastHealthySha: str(env.meta.lastDeployedSha) } : {}) };
  if (prior !== reading.health) {
    await lib.noteOnRecord(orgId, env.id, `Health ${prior ? `went from ${prior} to` : 'read'} ${reading.health}: ${reading.detail}.`, { url: reading.url, at });
  }

  if (reading.health === 'ok') {
    await quiet(orgId, env.id, set);
    if (rec && !rec.closedAt) {
      const steps = rec.attempts.map(a => a.kind).join(', then ');
      const line = `${name} is healthy again${rec.attempts.length > 0 ? ` after ${steps}` : ''}.`;
      await quiet(orgId, env.id, { healthRecovery: { ...rec, closedAt: at } });
      await lib.noteOnRecord(orgId, env.id, line, { at });
      if (rec.askId) {
        const { supersedeAsk } = await import('@/services/AskService');
        await supersedeAsk(orgId, rec.askId, line).catch(() => undefined);
      }
      if (rec.incidentId) {
        const { noteOnRequest } = await import('./carry');
        await noteOnRequest(orgId, rec.incidentId, line).catch(() => undefined);
      }
      return { recordId: env.id, did: 'healthy again', line };
    }
    return null;
  }

  if (!rec || rec.closedAt) {
    rec = { since: at, badReads: 1, attempts: [] };
    await quiet(orgId, env.id, { ...set, healthRecovery: rec });
    return { recordId: env.id, did: `${reading.health}: watching`, line: null };
  }
  rec = { ...rec, badReads: rec.badReads + 1 };
  // A person answered the stop and it is still unhealthy: the recovery starts over, once more.
  if (rec.stoppedAt && rec.askId) {
    const { getAsk } = await import('@/services/AskService');
    const ask = await getAsk(orgId, rec.askId).catch(() => null);
    if (ask && ask.status !== 'open') {
      rec = { since: at, badReads: CONFIRM_READS, attempts: [] };
      await lib.noteOnRecord(orgId, env.id, `${name} is still ${reading.health} after ask #${ask.id} was answered; its recovery starts again.`, { at });
    }
  }
  if (rec.stoppedAt || rec.badReads < CONFIRM_READS) {
    await quiet(orgId, env.id, { ...set, healthRecovery: rec });
    return null;
  }
  const last = rec.attempts.at(-1);
  if (last && now.getTime() - Date.parse(last.at) < STEP_WAIT_MS[last.kind]) {
    await quiet(orgId, env.id, { ...set, healthRecovery: rec });
    return null;
  }

  const step = await nextStep(orgId, env, rec, reading, d);
  if (step) {
    const res = await d.propose(orgId, { actionId: step.actionId, input: step.input, owner, why: step.why }).catch((err: Error) => ({ runId: 0, status: 'failed', error: err.message }));
    const attempt: RecoveryAttempt = { n: rec.attempts.length + 1, kind: step.kind, at, actionRunId: res.runId || null, status: res.status, url: step.url, ...(res.error ? { error: res.error.slice(0, 300) } : {}) };
    rec = { ...rec, attempts: [...rec.attempts, attempt] };
    await quiet(orgId, env.id, { ...set, healthRecovery: rec });
    // A step that ran says so itself, on this record; one that did not, says why here.
    const line = res.status === 'failed'
      ? `${name} is ${reading.health}; step ${attempt.n} (${step.kind}) could not run: ${res.error ?? 'no reason given'}.`
      : res.status === 'pending'
        ? `${name} is ${reading.health}; step ${attempt.n} (${step.kind}) is on a card for a person (action #${res.runId}).`
        : `${name} is ${reading.health}; step ${attempt.n} of its recovery: ${step.kind} (action #${res.runId}).`;
    if (res.status !== 'done') {
      await lib.noteOnRecord(orgId, env.id, line, { runId: res.runId || null, at });
    }
    return { recordId: env.id, did: `recovery: ${step.kind} ${res.status}`, line };
  }

  // Out of steps and still unhealthy: one incident, one ask, one notification.
  const tried = rec.attempts.map(a => `${a.kind}${a.actionRunId ? ` (action #${a.actionRunId})` : ''}: ${a.status}${a.error ? ` — ${a.error}` : ''}`);
  const incidentId = rec.incidentId ?? await fileIncident(orgId, env, reading, tried, owner);
  const { escalatePipeline } = await import('./pipelineChange');
  const why = `${name} is ${reading.health} (${reading.detail})${rec.attempts.length > 0 ? ` after ${rec.attempts.map(a => a.kind).join(', ')}` : ', and no recovery step applied to it'}`;
  const { askId, line } = await escalatePipeline(orgId, { recordId: env.id, requestId: incidentId, why, unblock: 'bring it back up (its hosting, its config, a service it needs), then approve to read its health again', owner, evidenceUrl: str(env.meta.lastDeployRunUrl), key: `health:${rec.since}`, tried, now: at });
  rec = { ...rec, stoppedAt: at, askId, incidentId };
  await quiet(orgId, env.id, { ...set, healthRecovery: rec });
  await lib.noteOnRecord(orgId, env.id, `${line} Incident #${incidentId}, ask #${askId}.`, { at });
  return { recordId: env.id, did: 'stopped', line };
}
