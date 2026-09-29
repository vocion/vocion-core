import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The org's pages are not under test: requests open on the generic record here.
vi.mock('@/services/objects/recordHref', async () => {
  const { genericRecordLinker } = await import('@/libs/workspace/recordHref');
  return { recordLinkerForOrg: async () => genericRecordLinker };
});

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, workerRunSchema } = await import('@/models/Schema');
const { runContext } = await import('./RunLogService');

const ORG = 'org_run_context';

async function clear() {
  await db.delete(workerRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
}

beforeEach(clear);

afterAll(clear);

describe('where an engineering run belongs (Chris, 2026-09-29)', () => {
  it('its feature, its task\'s plan, which attempt it is of that feature, and how much acceptance it carries', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request' }).returning({ id: businessObjectTypeSchema.id });
    await db.insert(businessObjectSchema).values([
      { id: 41, orgId: ORG, typeId: type!.id, title: 'Room PDF export', metadata: {} },
      { id: 52, orgId: ORG, typeId: type!.id, title: 'Render the room to PDF', metadata: {} },
      { id: 60, orgId: ORG, typeId: type!.id, title: 'Room PDF export task', metadata: { planId: 52 } },
    ]);
    const task = { request_id: '41', acceptance_contract: ['A PDF downloads', 'It keeps the layout', 'It names the room'] };
    const [first] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'failed', input: { task, record: { id: 60, type: 'engineering_task' } } }).returning();
    const [second] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: { task, record: { id: 60, type: 'engineering_task' } } }).returning();

    const c = await runContext(second!);

    expect(c).toEqual({
      feature: { id: 41, title: 'Room PDF export', href: '/dashboard/objects/41' },
      plan: { id: 52, title: 'Render the room to PDF', href: '/dashboard/objects/52' },
      attempt: { n: 2, of: 2, others: [{ runId: first!.id, status: 'failed', href: `/dashboard/p/runs/${first!.id}` }] },
      acceptance: { count: 3, href: '/dashboard/objects/41#report-acceptance' },
    });
  });

  it('a run that names no feature belongs nowhere it can say', async () => {
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'engineer', status: 'running', input: {} }).returning();

    expect(await runContext(run!)).toBeNull();
  });
});
