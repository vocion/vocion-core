/**
 * A down environment is brought back before a person hears (backlog 049),
 * against PGlite: two bad reads start its recovery, one step a pass — re-run,
 * redeploy, roll back — each given time to work, then one incident and one
 * ask, and healthy again closes it. GitHub, the health read and the action
 * rail are injected; every name and host is invented.
 */
import type { WatchDeps } from './environmentHealth';
import type { HealthReading } from './environments';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { askSchema, businessObjectSchema, eventLogSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { STEP_WAIT_MS, watchEnvironments } = await import('./environmentHealth');

const ORG = 'org_environment_health';
const REPO = 'Acme/northwind-core';
const types: Record<string, number> = {};

beforeAll(async () => {
  for (const slug of ['environment', 'repo', 'request']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'northwind-core', metadata: { slug: 'northwind-core', url: `https://github.com/${REPO}` } });
});

async function anEnvironment(slug: string, extra: Record<string, unknown> = {}) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.environment!, title: slug, metadata: { slug, product: 'rooms', repo: 'northwind-core', stage: 'production', url: `https://${slug}.northwind.example`, healthCheck: { url: `https://${slug}.northwind.example/health` }, deploy: { workflow: '.github/workflows/deploy.yml' }, lastDeployedSha: 'bad0000000000', lastHealthySha: 'good000000000', lastDeployRunUrl: `https://github.com/${REPO}/actions/runs/36001`, ...extra } }).returning();
  return r!;
}

async function meta(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata as Record<string, any>;
}

const reading = (health: 'ok' | 'down'): HealthReading => ({ health, status: health === 'ok' ? 200 : 503, detail: health === 'ok' ? 'answered HTTP 200' : 'answered HTTP 503', url: 'https://rooms.northwind.example/health', checkedAt: '2026-09-30T12:00:00Z', bodyHash: null });

function deps(over: Partial<WatchDeps> = {}) {
  let health: 'ok' | 'down' = 'down';
  const propose = vi.fn(async (_orgId: string, o: { actionId: string }) => ({ runId: { 'repo.rerun_failed_checks': 11, 'repo.dispatch_pipeline': 12, 'repo.revert_pull': 13 }[o.actionId] ?? 1, status: 'done' }));
  const d: WatchDeps = {
    health: async () => reading(health),
    deployBranch: async () => 'main',
    latestRun: async () => ({ id: 36001, runNumber: 51, status: 'completed', conclusion: 'failure', url: `https://github.com/${REPO}/actions/runs/36001` } as never),
    triggers: async () => ({ dispatchable: true, pushBranches: ['main'], pathFiltered: false }),
    mergedPullFor: async () => `https://github.com/${REPO}/pull/140`,
    propose,
    ...over,
  };
  return { d, propose, set: (h: 'ok' | 'down') => {
    health = h;
  } };
}

const at = (min: number) => new Date(Date.parse('2026-09-30T12:00:00Z') + min * 60_000);
const kinds = (p: ReturnType<typeof vi.fn>, id: number) => p.mock.calls.filter(c => ((c as unknown[])[1] as { input: { recordId?: number } }).input.recordId === id).map(c => ((c as unknown[])[1] as { actionId: string }).actionId);

describe('a down environment is brought back, step by step', () => {
  it('re-run, redeploy, roll back — each given time to work — then one ask and one stop, on the environment', async () => {
    const env = await anEnvironment('rooms-api-production');
    const { d, propose } = deps();

    // One bad read is a blip: it is watched, nothing moves.
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(0), d);

    expect(kinds(propose, env.id)).toEqual([]);
    expect((await meta(env.id))).toMatchObject({ lastHealth: 'down', healthRecovery: { badReads: 1, attempts: [] } });

    // Twice: the failed deploy is re-run.
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(10), d);

    expect(kinds(propose, env.id)).toEqual(['repo.rerun_failed_checks']);
    expect(propose.mock.calls.at(-1)![1]).toMatchObject({ owner: 'release-engineer', input: { url: `https://github.com/${REPO}/actions/runs/36001`, recordId: env.id } });

    // Inside the re-run's wait, nothing else moves.
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(20), d);

    expect(kinds(propose, env.id)).toHaveLength(1);

    // Then a redeploy of what is merged, then the rollback of the release it went down on.
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(10 + STEP_WAIT_MS.rerun / 60_000), d);
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(40 + STEP_WAIT_MS.redeploy / 60_000), d);

    expect(kinds(propose, env.id)).toEqual(['repo.rerun_failed_checks', 'repo.dispatch_pipeline', 'repo.revert_pull']);
    expect(propose.mock.calls.at(-1)![1]).toMatchObject({ input: { url: `https://github.com/${REPO}/pull/140`, recordId: env.id, reason: expect.stringContaining('it was healthy on good000 before bad0000 deployed') } });
    expect((await meta(env.id)).healthRecovery.attempts.map((a: { kind: string; actionRunId: number }) => [a.kind, a.actionRunId])).toEqual([['rerun', 11], ['redeploy', 12], ['rollback', 13]]);

    // Out of steps and still down: one ask, the needs-person stop, on the environment.
    // No request is filed: an incident is not work for Work's In progress.
    const stopped = await watchEnvironments(ORG, { owner: 'release-engineer' }, at(200), d);

    expect(stopped.acted.find(a => a.recordId === env.id)?.did).toBe('stopped');

    const rec = (await meta(env.id)).healthRecovery;

    expect(rec.incidentId).toBeUndefined();
    expect(await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, types.request!)))).toHaveLength(0);
    expect((await meta(env.id)).recovery).toBeUndefined();

    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.id, rec.askId)));

    expect(ask!.sourceRef).toBe(`pipeline-stop:${env.id}:health:${rec.since}`);
    expect(ask!.body).toContain('rerun (action #11): done');
    expect(ask!.contextUrl).toBe(`/dashboard/objects/${env.id}`);

    const [event] = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.dedupeKey, `factory.stopped:${env.id}:${ask!.id}`)));

    expect(event!.payload).toMatchObject({ requestId: env.id, askId: ask!.id, why: expect.stringContaining('rooms-api-production is down (answered HTTP 503) after rerun, redeploy, rollback') });

    // Stopped: the next pass says nothing more.
    await watchEnvironments(ORG, { owner: 'release-engineer' }, at(260), d);

    expect(kinds(propose, env.id)).toHaveLength(3);
    expect(await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, ask!.sourceRef!)))).toHaveLength(1);
  });

  it('healthy again closes the recovery, says after what, and takes the ask back', async () => {
    const env = await anEnvironment('rooms-web-production');
    const { d, set } = deps();
    await watchEnvironments(ORG, {}, at(0), d);
    await watchEnvironments(ORG, {}, at(10), d);
    set('ok');

    const out = await watchEnvironments(ORG, {}, at(20), d);

    expect(out.acted.find(a => a.recordId === env.id)).toMatchObject({ did: 'healthy again', line: 'rooms-web-production is healthy again after rerun.' });
    expect((await meta(env.id))).toMatchObject({ lastHealth: 'ok', lastHealthySha: 'bad0000000000', healthRecovery: { closedAt: at(20).toISOString() }, lastPipelineLine: 'rooms-web-production is healthy again after rerun.' });
  });

  it('healthy again closes an incident request an earlier version filed, so it leaves Work by itself', async () => {
    const [incident] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'rooms-site-production is degraded', metadata: { kind: 'incident', state: 'new', recovery: { stage: 'stopped', line: 'Stopped: rooms-site-production is degraded.', attempts: [], log: [], limit: 3, since: null, askId: null, planRequestedAt: null, handledRunIds: [] } } }).returning();
    const env = await anEnvironment('rooms-site-production', { lastHealth: 'degraded', healthRecovery: { since: at(-60).toISOString(), badReads: 30, attempts: [{ n: 1, kind: 'redeploy', at: at(-50).toISOString(), actionRunId: 12, status: 'done', url: null }], stoppedAt: at(-30).toISOString(), incidentId: incident!.id } });
    const { d, set } = deps();
    set('ok');

    await watchEnvironments(ORG, {}, at(0), d);

    expect((await meta(env.id)).healthRecovery.closedAt).toBe(at(0).toISOString());
    expect(await meta(incident!.id)).toMatchObject({ state: 'answered', recovery: { stage: null, line: null } });
    expect((await meta(incident!.id)).recovery.log.at(-1).text).toBe('Closed: rooms-site-production is healthy again after redeploy.');
  });

  it('a step that does not apply is not taken: a deploy that passed, a workflow no one can start, a release that was never healthy', async () => {
    const env = await anEnvironment('rooms-worker-production', { lastHealthySha: 'bad0000000000' });
    const { d, propose } = deps({ latestRun: async () => ({ id: 1, runNumber: 9, status: 'completed', conclusion: 'success', url: 'u' } as never), triggers: async () => ({ dispatchable: false, pushBranches: ['main'], pathFiltered: false }) });

    await watchEnvironments(ORG, {}, at(0), d);
    const out = await watchEnvironments(ORG, {}, at(10), d);

    expect(kinds(propose, env.id)).toEqual([]);
    expect(out.acted.find(a => a.recordId === env.id)?.did).toBe('stopped');
    expect((await meta(env.id)).healthRecovery.stoppedAt).toBe(at(10).toISOString());
  });

  it('a person answered the stop and it is still down: its recovery starts again', async () => {
    const env = await anEnvironment('rooms-docs-production', { lastHealthySha: 'bad0000000000' });
    const { d } = deps({ latestRun: async () => null, triggers: async () => null });
    await watchEnvironments(ORG, {}, at(0), d);
    await watchEnvironments(ORG, {}, at(10), d);
    const first = (await meta(env.id)).healthRecovery;
    await db.update(askSchema).set({ status: 'approved' }).where(eq(askSchema.id, first.askId));

    await watchEnvironments(ORG, {}, at(30), d);

    const again = (await meta(env.id)).healthRecovery;

    expect(again.since).toBe(at(30).toISOString());
    expect((await meta(env.id)).pipelineLog.some((l: { line: string }) => l.line.includes('its recovery starts again'))).toBe(true);
  });
});
