/**
 * A FACTORY WHOSE TYPES ARE CALLED SOMETHING ELSE RUNS THE SAME LOOP (backlog
 * 045). The plugin names its roles in `factory.types`; here every one is
 * renamed, and filing, building, recovering and the feature page all work
 * with no core edit. Against PGlite; every name is invented.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const RENAMED = {
  request: 'ask_item',
  task: 'work_item',
  plan: 'design_note',
  environment: 'stage_site',
  release: 'ship_note',
  product: 'offering',
  repo: 'codebase',
};

vi.mock('@/libs/DB');
vi.mock('@/libs/workspace/plugins', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/workspace/plugins')>();
  return {
    ...real,
    listPluginSlugs: () => ['renamed-factory'],
    loadPlugin: (slug: string) => slug === 'renamed-factory'
      ? { manifest: { slug, name: 'Renamed factory', version: '1.0.0', description: 'x', depends: [], surfaces: [], nav: { section: 'Workspace', order: 0 }, recommend: { when: [], connectors: [] }, notifications: [], factory: { types: RENAMED } }, sourcePath: '/nowhere' }
      : real.loadPlugin(slug),
  };
});

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectSchema, trustRuleSchema, workerRunSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { resetFactoryTypesCache } = await import('@/libs/factory/types');
const carry = await import('./carry');
const { claimWorkerRun, failWorkerRun } = await import('@/services/WorkerRunService');
const { loadFeatureReport } = await import('./featureReportData');

const ORG = 'org_factory_renamed';
const typeIds: Record<string, number> = {};
const previous = process.env.VOCION_EXTERNAL_WORKERS;

beforeAll(async () => {
  resetFactoryTypesCache();
  process.env.VOCION_EXTERNAL_WORKERS = '1';
  for (const slug of Object.values(RENAMED)) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    typeIds[slug] = t!.id;
  }
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } } as never);
  await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: typeIds[RENAMED.repo]!,
    title: 'Acme/kestrel-ledger',
    metadata: { checks: [{ name: 'test' }], productPaths: { ledger: ['apps/ledger/src/**'] } },
  });
  for (const actionId of ['factory.dispatch_task.from_request', 'factory.dispatch_task.recovery']) {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.8, enabled: 'true' });
  }
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', threshold: 1, enabled: 'false' });
});

afterAll(() => {
  process.env.VOCION_EXTERNAL_WORKERS = previous;
  resetFactoryTypesCache();
});

describe('renamed factory types', () => {
  it('files, builds, recovers and reports a request of the renamed types', async () => {
    const [r] = await db.insert(businessObjectSchema).values({
      orgId: ORG,
      typeId: typeIds[RENAMED.request]!,
      title: 'The ledger total is off by one cent',
      metadata: { kind: 'bug', severity: 'p2', state: 'new', product: 'ledger', outcome: 'The total matches the lines.', acceptance: ['The total equals the sum of the lines.'], ownerRepo: 'Acme/kestrel-ledger' },
    }).returning();

    // Filing starts the build: the request is recognised by its renamed type.
    const out = await carry.intakeFiledRequest(ORG, { objectType: RENAMED.request, objectId: r!.id, conversationId: 7, byPerson: true });

    expect(out.did).toBe('start:done');

    // The task is written under the renamed task type, and the run names it.
    const tasks = await db.select().from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ORG), eq(businessObjectSchema.typeId, typeIds[RENAMED.task]!)));

    expect(tasks).toHaveLength(1);

    const runs = await db.select().from(workerRunSchema).where(eq(workerRunSchema.orgId, ORG));

    expect(runs).toHaveLength(1);
    expect((runs[0]!.input as { record: { type: string; id: number } }).record).toEqual({ type: RENAMED.task, id: tasks[0]!.id });

    // A failed run of the renamed task type is the factory's to recover.
    await claimWorkerRun({ orgId: ORG, id: runs[0]!.id, workerId: 'w-1' });
    await failWorkerRun({ orgId: ORG, id: runs[0]!.id, workerId: 'w-1', error: 'required checks failed: test', failures: [{ scope: 'checks', message: 'test failed' }] });
    const recovered = await carry.recoverFailedRun(ORG, runs[0]!.id);

    expect(recovered.did).not.toBe('not an engineering run');
    expect(recovered.requestId).toBe(r!.id);

    // The feature page reads the request, its task and its runs.
    const report = await loadFeatureReport(ORG, r!.id);

    expect(report).not.toBeNull();
    expect(report!.timeline.some(e => e.key === `contract-${tasks[0]!.id}`)).toBe(true);
  });
});
