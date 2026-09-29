import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A workspace whose requests open on a feature page, like the factory's.
vi.mock('@/services/objects/recordHref', async () => {
  const { recordLinker } = await import('@/libs/workspace/recordHref');
  return { recordLinkerForOrg: async () => recordLinker({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: null }) };
});

const { db } = await import('@/libs/DB');
const { askSchema, businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { followStateOf, followStatuses } = await import('./followStatus');

const ORG = 'org_follow_status';

async function clear() {
  await db.delete(workerRunSchema);
  await db.delete(askSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
}

beforeEach(clear);

afterAll(clear);

describe('where each thing a turn set moving stands (Chris, 2026-09-29)', () => {
  it('reads a status word as one of four states a person can read at a glance', () => {
    expect(followStateOf('queued')).toBe('queued');
    expect(followStateOf('running')).toBe('running');
    expect(followStateOf('claimed')).toBe('running');
    expect(followStateOf('completed')).toBe('done');
    expect(followStateOf('failed')).toBe('failed');
    expect(followStateOf('cancelled')).toBe('failed');
  });

  it('a run, an ask and a request each from their own row; a request follows its latest run', async () => {
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: { task: { request_id: '31' } } }).returning({ id: workerRunSchema.id });
    const [ask] = await db.insert(askSchema).values({ orgId: ORG, kind: 'approval', title: 'Ship the Kestrel fix?', status: 'open' } as never).returning({ id: askSchema.id });
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request' }).returning({ id: businessObjectTypeSchema.id });
    const [req] = await db.insert(businessObjectSchema).values({ id: 31, orgId: ORG, typeId: type!.id, title: 'Northwind upload', metadata: { state: 'building' } }).returning({ id: businessObjectSchema.id });

    const out = await followStatuses(ORG, [
      { type: 'worker_run', id: String(run!.id) },
      { type: 'ask', id: String(ask!.id) },
      { type: 'object', id: String(req!.id) },
      { type: 'worker_run', id: '999999' },
    ]);

    expect(out[`worker_run:${run!.id}`]).toEqual({ state: 'running', label: 'running' });
    expect(out[`ask:${ask!.id}`]).toEqual({ state: 'waiting', label: 'waiting on a person' });
    // Named as the workspace names it, whatever the client guessed.
    expect(out['object:31']).toEqual({ state: 'running', label: `running · run #${run!.id}`, name: 'feature #31' });
    // Not this org's, or not there: no dot rather than a guess.
    expect(out['worker_run:999999']).toBeUndefined();
    expect(await followStatuses('org_other', [{ type: 'worker_run', id: String(run!.id) }])).toEqual({});
  });
});
