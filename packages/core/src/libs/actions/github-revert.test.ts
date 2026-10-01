/**
 * `repo.revert_pull` (backlog 049): a release an environment went down on is
 * rolled back by the pipeline's owner, the revert merges itself on green, and
 * Undo puts it back. GitHub is mocked; the repository is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const revertPull = vi.fn(async () => ({ revertUrl: 'https://github.com/Acme/northwind-core/pull/141' }));
const closePull = vi.fn(async () => ({ closed: true, state: 'closed' }));
vi.mock('@/services/factory/githubMerge', () => ({ revertPull, closePull }));

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { githubRevertPullAction: action } = await import('./github-revert');

const ORG = 'org_revert';
let envId = 0;

beforeAll(async () => {
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'release-engineer', name: 'Release engineer', systemPrompt: 'x', harnessConfig: { grantTools: ['repo.revert_pull'] } },
    { orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: {} },
  ] as never);
  const [t] = await createObjectType({ slug: 'environment', label: 'environment' }, ORG);
  const [env] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: t!.id, title: 'rooms-api-production', metadata: { slug: 'rooms-api-production' } }).returning();
  envId = env!.id;
});

const input = () => ({ url: 'https://github.com/Acme/northwind-core/pull/140', recordId: envId, reason: 'rooms-api-production is down since bad0000 deployed; a re-run and a redeploy did not bring it back.' });

describe('repo.revert_pull', () => {
  it('is the pipeline owner\'s move, or a person\'s, never the engineer\'s', async () => {
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:release-engineer' }, input())).toBeUndefined();
    expect(await action.precheck!({ orgId: ORG, invokedBy: 'agent:task-engineer' }, input())).toContain('the seat that owns the pipeline (release-engineer)');
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
