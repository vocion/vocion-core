import { eq } from 'drizzle-orm';
import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const get = vi.hoisted(() => vi.fn());
vi.mock('@/services/agents/tools/hubspotDirect', () => ({ hubspotClientForOrg: async () => ({ ok: true, client: { get }, sources: [{ configJson: { portalId: '123' } }] }) }));
const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userSchema, accountMembershipSchema, crmSyncSchema, listRecordSchema } = await import('@/models/Schema');
const { syncCrmPage } = await import('./sync');
const { crmDashboard } = await import('./dashboard');
const { crmListId } = await import('@/libs/crm/model');
const { readList, writeListRecords } = await import('@/services/lists/service');
const actor = { orgId: 'sync-a', userId: 'sync-admin' };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'sync-account', name: 'Example', slug: 'sync-account' });
  await db.insert(userSchema).values({ id: actor.userId, email: 'sync-admin@example.test' });
  await db.insert(accountMembershipSchema).values({ accountId: 'sync-account', userId: actor.userId, role: 'admin' });
  await db.insert(projectSchema).values({ id: actor.orgId, accountId: 'sync-account', name: 'A', slug: 'sync-a', outboundDryRun: true });
  get.mockImplementation(async (path: string, params: Record<string, string>) => {
    if (path.includes('/pipelines/')) {
      return { ok: true, data: { results: [{ id: 'p1', label: 'Sales', stages: [{ id: 's1', label: 'Qualified', displayOrder: 1, metadata: { isClosed: 'false' } }] }] } };
    }
    if (path.endsWith('/companies')) {
      return { ok: true, data: { results: [{ id: 'company1', properties: { name: 'Example' } }] } };
    }
    if (path.endsWith('/contacts')) {
      return { ok: true, data: { results: Array.from({ length: params.after ? 1 : 100 }, (_, i) => ({ id: String((params.after ? 100 : 0) + i), properties: { firstname: `Lead ${i}`, lifecyclestage: 'marketingqualifiedlead' }, associations: { companies: { results: [{ id: 'company1' }] } } })), ...(!params.after ? { paging: { next: { after: '100' } } } : {}) } };
    }
    if (path.endsWith('/deals')) {
      return { ok: true, data: { results: [{ id: 'deal1', properties: { dealname: 'Proposal', pipeline: 'p1', dealstage: 's1', amount: '100', deal_currency_code: 'USD' } }] } };
    }
    return { ok: true, data: { results: [] } };
  });
});

it('resumes pagination, retains associations, aggregates every row and blocks source edits', async () => {
  await syncCrmPage(actor);
  await syncCrmPage(actor);
  const [checkpoint] = await db.select().from(crmSyncSchema).where(eq(crmSyncSchema.projectId, actor.orgId));

  expect(checkpoint?.state?.after).toBe('100');
  expect(checkpoint?.lastCompletedAt).toBeNull();

  await syncCrmPage(actor);
  await syncCrmPage(actor);

  expect((await syncCrmPage(actor)).done).toBe(true);

  const dashboard = await crmDashboard(actor);

  expect(dashboard.leads).toEqual([{ stage: 'marketingqualifiedlead', count: 101 }]);
  expect(dashboard.deals[0]).toMatchObject({ count: 1, amount: '100', currency: 'USD', pipeline: 'Sales' });

  const list = await readList(actor, { id: crmListId(actor.orgId, 'contacts') });

  expect(list.total).toBe(101);
  expect(list.rows[0]?.values.company).toBeTruthy();
  await expect(writeListRecords(actor, { id: list.list.id, expectedVersion: list.list.version, records: [{ id: list.rows[0]!.id, values: { name: 'Overwrite' } }] })).rejects.toMatchObject({ status: 409 });
});

it('repeated import is idempotent and inaccessible to an unrelated actor', async () => {
  await syncCrmPage(actor);

  expect(await db.select().from(listRecordSchema).where(eq(listRecordSchema.listId, crmListId(actor.orgId, 'companies')))).toHaveLength(1);
  await expect(syncCrmPage({ ...actor, userId: 'stranger' })).rejects.toMatchObject({ status: 404 });
});

it('keeps its checkpoint when the provider fails', async () => {
  get.mockResolvedValueOnce({ ok: false, error: 'missing_scope', scope: 'crm.objects.contacts.read', message: 'Denied' });

  await expect(syncCrmPage(actor)).rejects.toThrow('permission');

  const [failed] = await db.select().from(crmSyncSchema).where(eq(crmSyncSchema.projectId, actor.orgId));

  expect(failed?.status).toBe('failed');
  expect(failed?.state?.phase).toBe(1);
  expect(failed?.lease).toBeNull();
});
