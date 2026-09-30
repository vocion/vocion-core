/**
 * An environment knows what it runs (backlog 049), against PGlite: a deploy
 * branch run is written on the environments whose `deploy` names its workflow
 * and step, their health is read after it, and a merge its deploy never ran
 * for is started once. GitHub and the health address are injected; every
 * repository, host and name is invented.
 */
import type { MissedDeps } from './environments';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { deployedBy, deploysWith, readHealth, recordDeploy, triggersOf, watchMissedDeploys } = await import('./environments');

const ORG = 'org_environments';
const REPO = 'Acme/northwind-core';
const types: Record<string, number> = {};

beforeAll(async () => {
  for (const slug of ['environment', 'repo']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'northwind-core', metadata: { slug: 'northwind-core', url: `https://github.com/${REPO}` } });
});

async function anEnvironment(slug: string, deploy: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.environment!, title: slug, metadata: { slug, product: 'rooms', repo: 'northwind-core', stage: 'production', url: `https://${slug}.northwind.example`, deploy, ...extra } }).returning();
  return r!;
}

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata as Record<string, any>;
}

const JOBS = [
  { name: 'changes', steps: [{ name: 'Which surfaces changed', conclusion: 'success' }] },
  { name: 'deploy', steps: [{ name: 'API', conclusion: 'skipped' }, { name: 'Web app', conclusion: 'success' }, { name: 'Marketing site', conclusion: 'failure' }] },
];

describe('which run deployed which environment', () => {
  it('matches the workflow by its file or its name, and the step that deploys the surface', () => {
    expect(deploysWith({ workflow: '.github/workflows/deploy.yml' }, { path: '.github/workflows/deploy.yml', name: 'Deploy' })).toBe(true);
    expect(deploysWith({ workflow: 'deploy.yml' }, { path: '.github/workflows/deploy.yml' })).toBe(true);
    expect(deploysWith({ workflow: 'Deploy' }, { path: null, name: 'Deploy' })).toBe(true);
    expect(deploysWith({ workflow: '.github/workflows/ci.yml' }, { path: '.github/workflows/deploy.yml', name: 'Deploy' })).toBe(false);
    expect(deploysWith({}, { path: '.github/workflows/deploy.yml' })).toBe(false);

    expect(deployedBy({ step: 'Web app', job: 'deploy' }, 'success', JOBS)).toBe('deployed');
    expect(deployedBy({ step: 'API' }, 'success', JOBS)).toBe('not-this');
    expect(deployedBy({ step: 'Marketing site' }, 'failure', JOBS)).toBe('failed');
    expect(deployedBy({}, 'success', JOBS)).toBe('deployed');
    expect(deployedBy({}, 'failure', JOBS)).toBe('failed');
  });
});

describe('a deploy is written on its environments', () => {
  it('the environments its steps deployed take the run\'s commit, time, URL and health; the others are left alone', async () => {
    const web = await anEnvironment('rooms-web-production', { workflow: '.github/workflows/deploy.yml', job: 'deploy', step: 'Web app' });
    const api = await anEnvironment('rooms-api-production', { workflow: '.github/workflows/deploy.yml', step: 'API' }, { lastDeployedSha: 'old0000000000' });
    const site = await anEnvironment('rooms-marketing-production', { workflow: '.github/workflows/deploy.yml', step: 'Marketing site' });
    const health = vi.fn(async () => ({ health: 'ok' as const, status: 200, detail: 'https://rooms-web-production.northwind.example answered HTTP 200', url: 'u', checkedAt: '2026-09-30T12:40:00Z', bodyHash: 'h1' }));

    const out = await recordDeploy(ORG, { repo: REPO, runId: 36001, runNumber: 51, name: 'Deploy', path: '.github/workflows/deploy.yml', headSha: 'c0ffee1234567', conclusion: 'success', url: `https://github.com/${REPO}/actions/runs/36001`, completedAt: '2026-09-30T12:39:00Z' }, { runJobs: async () => JOBS, health });

    expect(await read(web.id)).toMatchObject({ lastDeployedSha: 'c0ffee1234567', lastDeployedAt: '2026-09-30T12:39:00Z', lastDeployRunUrl: `https://github.com/${REPO}/actions/runs/36001`, lastHealth: 'ok', lastHealthCheckedAt: '2026-09-30T12:40:00Z', lastPipelineLine: expect.stringMatching(/^Deployed c0ffee1 to rooms-web-production \(run #51\); healthy/) });
    expect((await read(api.id)).lastDeployedSha).toBe('old0000000000');
    expect((await read(site.id)).lastPipelineLine).toContain('did not deploy rooms-marketing-production (step "Marketing site" failed)');
    expect(out.map(o => o.did).sort()).toEqual(['deploy failed', 'deployed: ok']);

    // The same run read again (the webhook and the poller) writes nothing new.
    const again = await recordDeploy(ORG, { repo: REPO, runId: 36001, runNumber: 51, name: 'Deploy', path: '.github/workflows/deploy.yml', headSha: 'c0ffee1234567', conclusion: 'success', url: `https://github.com/${REPO}/actions/runs/36001`, completedAt: '2026-09-30T12:39:00Z' }, { runJobs: async () => JOBS, health });

    expect(again.find(o => o.recordId === web.id)?.did).toBe('already recorded');
    expect(health).toHaveBeenCalledTimes(1);
  });
});

describe('the health read', () => {
  it('down when it does not answer or answers 5xx; degraded when the answer does not say what it must, read once per answer', async () => {
    const meets = vi.fn(async () => ({ meets: false, why: 'the page is the maintenance notice' }));

    expect(await readHealth(ORG, { url: 'https://rooms.northwind.example' }, new Date(), { fetch: async () => {
      throw new Error('connect ETIMEDOUT');
    } })).toMatchObject({ health: 'down', status: null });
    expect(await readHealth(ORG, { url: 'https://rooms.northwind.example' }, new Date(), { fetch: async () => ({ status: 503, body: 'Service Unavailable' }) })).toMatchObject({ health: 'down', status: 503 });
    expect(await readHealth(ORG, { healthCheck: { url: 'https://rooms.northwind.example/health', expect: '"status":"ok"' } }, new Date(), { fetch: async () => ({ status: 200, body: '{"status":"ok"}' }), meets })).toMatchObject({ health: 'ok' });
    expect(meets).not.toHaveBeenCalled();

    const first = await readHealth(ORG, { healthCheck: { url: 'https://rooms.northwind.example', expect: 'the title names Rooms' } }, new Date(), { fetch: async () => ({ status: 200, body: '<title>Down for maintenance</title>' }), meets });

    expect(first).toMatchObject({ health: 'degraded', detail: expect.stringContaining('the page is the maintenance notice') });

    // The same answer again is the same verdict, without asking the model.
    await readHealth(ORG, { healthCheck: { url: 'https://rooms.northwind.example', expect: 'the title names Rooms' }, lastHealthRead: { bodyHash: first!.bodyHash, expect: 'the title names Rooms', meets: false, why: 'the page is the maintenance notice' } }, new Date(), { fetch: async () => ({ status: 200, body: '<title>Down for maintenance</title>' }), meets });

    expect(meets).toHaveBeenCalledTimes(1);
    expect(await readHealth(ORG, { stage: 'local' })).toBeNull();
  });
});

describe('a deploy that should have run and did not', () => {
  it('reads the workflow\'s own triggers', () => {
    expect(triggersOf('on:\n  push:\n    branches: [main]\n  workflow_dispatch: {}\n', parse)).toEqual({ dispatchable: true, pushBranches: ['main'], pathFiltered: false });
    expect(triggersOf('on:\n  push:\n    branches: [main]\n    paths: [apps/**]\n', parse)).toEqual({ dispatchable: false, pushBranches: ['main'], pathFiltered: true });
    expect(triggersOf('on: [push, workflow_dispatch]\n', parse)).toEqual({ dispatchable: true, pushBranches: [], pathFiltered: false });
    expect(triggersOf('on:\n  schedule:\n    - cron: "0 5 * * *"\n', parse)).toMatchObject({ pushBranches: null });
  });

  function deps(over: Partial<MissedDeps> = {}): MissedDeps & { dispatch: ReturnType<typeof vi.fn> } {
    return {
      deployBranch: async () => 'main',
      branchHead: async () => ({ sha: 'feed00000000000000000000000000000000abcd', committedAt: '2026-09-30T12:00:00Z' }),
      runs: async () => [],
      triggers: async () => ({ dispatchable: true, pushBranches: ['main'], pathFiltered: false }),
      dispatch: vi.fn(async () => ({ runId: 901, status: 'done' })),
      ...over,
    } as MissedDeps & { dispatch: ReturnType<typeof vi.fn> };
  }

  it('starts the workflow once for the commit no run followed, and says so on the environments it deploys', async () => {
    const env = await anEnvironment('kestrel-web-production', { workflow: '.github/workflows/release.yml' });
    const twin = await anEnvironment('kestrel-api-production', { workflow: '.github/workflows/release.yml' });
    const d = deps();

    const out = await watchMissedDeploys(ORG, new Date('2026-09-30T12:30:00Z'), 'release-engineer', d);

    expect(out.find(o => o.recordId === env.id || o.recordId === twin.id)?.did).toBe('missed deploy: done');

    const started = d.dispatch.mock.calls.filter(c => (c as unknown[])[1] && ((c as unknown[])[1] as { workflow: string }).workflow === '.github/workflows/release.yml');

    expect(started).toHaveLength(1);
    expect(started[0]![1]).toMatchObject({ repo: REPO, ref: 'main', sha: 'feed00000000000000000000000000000000abcd', owner: 'release-engineer' });
    expect((await read(twin.id)).missedDeploy).toMatchObject({ sha: 'feed00000000000000000000000000000000abcd', started: true });

    // The next pass: already started for this commit.
    await watchMissedDeploys(ORG, new Date('2026-09-30T12:35:00Z'), 'release-engineer', d);

    expect(d.dispatch.mock.calls.filter(c => ((c as unknown[])[1] as { workflow: string }).workflow === '.github/workflows/release.yml')).toHaveLength(1);
  });

  it('leaves alone a merge that is too new, one a run followed, and a workflow not every push starts', async () => {
    await anEnvironment('bellwater-web-production', { workflow: '.github/workflows/ship.yml' });
    const young = deps({ branchHead: async () => ({ sha: 'aaaa000000000000000000000000000000000000', committedAt: '2026-09-30T12:25:00Z' }) });
    const followed = deps({ runs: async () => [{ id: 1, headSha: 'feed00000000000000000000000000000000abcd' } as never] });
    const filtered = deps({ triggers: async () => ({ dispatchable: true, pushBranches: ['main'], pathFiltered: true }) });

    for (const d of [young, followed, filtered]) {
      await watchMissedDeploys(ORG, new Date('2026-09-30T12:30:00Z'), 'release-engineer', d);

      expect(d.dispatch.mock.calls.filter(c => ((c as unknown[])[1] as { workflow: string }).workflow === '.github/workflows/ship.yml')).toHaveLength(0);
    }
  });
});
