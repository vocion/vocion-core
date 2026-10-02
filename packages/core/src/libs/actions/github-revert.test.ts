/**
 * `repo.revert_pull` (backlog 049): a release an environment went down on is
 * rolled back by the pipeline's owner, the revert merges itself on green, and
 * Undo puts it back. GitHub is mocked; the repository is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const revertPull = vi.fn(async () => ({ revertUrl: 'https://github.com/Acme/northwind-core/pull/141' }));
const closePull = vi.fn(async () => ({ closed: true, state: 'closed' }));
const readPull = vi.fn(async (_org: string, url: string) => ({ title: url.endsWith('/150') ? 'revert: build the rooms image on amd64 again (#150)' : 'feat: rooms search', merged: true, mergedAt: url.endsWith('/150') ? '2026-01-10T16:00:00Z' : '2026-01-10T09:00:00Z', state: 'closed' }));
vi.mock('@/services/factory/githubMerge', () => ({ revertPull, closePull, readPull }));

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { githubRevertPullAction: action } = await import('./github-revert');

const ORG = 'org_revert';
let envId = 0;
let incidentId = 0;

beforeAll(async () => {
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'release-engineer', name: 'Release engineer', systemPrompt: 'x', harnessConfig: { grantTools: ['repo.revert_pull'] } },
    { orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: {} },
  ] as never);
  const [t] = await createObjectType({ slug: 'environment', label: 'environment' }, ORG);
  const [env] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: t!.id, title: 'rooms-api-production', metadata: { slug: 'rooms-api-production' } }).returning();
  envId = env!.id;
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'product-manager', name: 'PM', systemPrompt: 'x', harnessConfig: {} } as never);
  // #150 went out in a release production read healthy after: the fix.
  const [rel] = await createObjectType({ slug: 'release', label: 'release' }, ORG);
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: rel!.id, title: 'rooms 0a1b2c', metadata: { prUrls: ['https://github.com/Acme/northwind-core/pull/150'], healthAfter: 'ok', healthCheckedAt: '2026-01-10T16:20:00Z' } });
  const [inc] = await createObjectType({ slug: 'incident', label: 'incident' }, ORG);
  const [i] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: inc!.id, title: 'rooms-api 500s', metadata: {}, createdAt: new Date('2026-01-10T12:00:00Z') } as never).returning();
  incidentId = i!.id;
});

const input = () => ({ url: 'https://github.com/Acme/northwind-core/pull/140', recordId: envId, reason: 'rooms-api-production is down since bad0000 deployed; a re-run and a redeploy did not bring it back.' });

describe('repo.revert_pull', () => {
  it('is the pipeline owner\'s move, or a person\'s, never the engineer\'s', async () => {
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:release-engineer' }, input())).toBeUndefined();
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:task-engineer' }, input())).toContain('the seat that owns the pipeline (release-engineer)');
  });

  it('holds an agent to its seat even when the card was filed in a person\'s turn (action 5949)', async () => {
    const fix = { url: 'https://github.com/Acme/northwind-core/pull/140', reason: 'the person asked to defer a request, not this' };

    // invokedBy is the person whose thread it was; proposedBy is whose decision it is.
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'usr-qa', proposedBy: 'agent:product-manager' }, fix)).toContain('the seat that owns the pipeline (release-engineer)');

    const { proposeAction } = await import('@/services/ActionService');

    await expect(proposeAction({ orgId: ORG, actionId: 'repo.revert_pull', input: fix, principal: { kind: 'agent', id: 'agent:product-manager', scope: { orgId: ORG }, grants: ['*'], autonomy: 2 }, invokedBy: 'usr-qa', proposal: { confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: 'x' } }))
      .rejects
      .toThrow(/the seat that owns the pipeline \(release-engineer\), not by product-manager/);
  });

  it('refuses an agent\'s revert of a release production read healthy after, and one merged after the incident it answers; a person who names it is not refused', async () => {
    const fix = { url: 'https://github.com/Acme/northwind-core/pull/150', reason: 'roll the environment back to before the regression' };

    expect(await action.precheck!({ orgId: ORG, proposedBy: 'agent:release-engineer' }, fix)).toMatch(/^Not reverting Acme\/northwind-core\/pull\/150: it went out in REL-\d+, and production read healthy after it .*Only a person who names this revert can open it/);
    expect(await action.precheck!({ orgId: ORG, proposedBy: 'usr-dana' }, fix)).toBeUndefined();

    // #151 is not in a healthy release, but it merged (16:00) after the incident opened (12:00).
    readPull.mockResolvedValueOnce({ title: 'fix: rooms cache', merged: true, mergedAt: '2026-01-10T16:00:00Z', state: 'closed' });

    expect(await action.precheck!({ orgId: ORG, proposedBy: 'agent:release-engineer' }, { url: 'https://github.com/Acme/northwind-core/pull/151', recordId: incidentId, reason: 'the incident started after this deploy' })).toMatch(/merged at 2026-01-10T16:00:00.000Z, after INC-\d+ was opened at 2026-01-10T12:00:00.000Z, so it cannot be what broke it/);
  });

  it('takes only a pull request url, and its card says what it would undo', async () => {
    expect(action.inputSchema.safeParse({ url: 'https://github.com/northwind-core/pulls/151', reason: 'a malformed pull request link' }).success).toBe(false);

    const card = await action.reviewCard!({ orgId: ORG }, { url: 'https://github.com/Acme/northwind-core/pull/150', reason: 'roll back' });

    expect(card.fields.find(f => f.label === 'It undoes')?.value).toMatch(/^"revert: build the rooms image on amd64 again \(#150\)", shipped in REL-\d+ \(production read ok after it\) — taken back out of production$/);
  });

  it('opens the revert and tracks it on the environment, to merge on green', async () => {
    const out = await action.execute({ orgId: ORG, invokedBy: 'agent:release-engineer', runId: 55 }, input());
    const [env] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, envId));

    expect(out).toMatchObject({ url: 'https://github.com/Acme/northwind-core/pull/141', reverts: 'https://github.com/Acme/northwind-core/pull/140', objectId: envId });
    expect(env!.metadata).toMatchObject({ pipelineChange: { url: 'https://github.com/Acme/northwind-core/pull/141', riskClass: 'rollback', state: 'open', noRework: true, actionRunId: 55 }, lastPipelineLine: expect.stringContaining('Opened the rollback Acme/northwind-core/pull/141 of Acme/northwind-core/pull/140') });
  });

  it('undo closes an open revert, and reverts a merged one', async () => {
    expect(await action.undo!({ orgId: ORG }, input(), { url: 'https://github.com/Acme/northwind-core/pull/141' })).toMatchObject({ closed: true });

    closePull.mockResolvedValueOnce({ closed: false, state: 'merged' });
    revertPull.mockResolvedValueOnce({ revertUrl: 'https://github.com/Acme/northwind-core/pull/142' });

    expect(await action.undo!({ orgId: ORG }, input(), { url: 'https://github.com/Acme/northwind-core/pull/141' })).toMatchObject({ reopened: 'https://github.com/Acme/northwind-core/pull/142' });
  });
});
