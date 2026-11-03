import { beforeAll, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userSchema, accountMembershipSchema } = await import('@/models/Schema');
const { installCrm } = await import('@/services/lists/crm');
const { readList, writeListRecords } = await import('@/services/lists/service');
const { crmListId, crmRecordId } = await import('@/libs/crm/model');
const actor = { orgId: 'crm-workspace-a', userId: 'crm-admin' };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'crm-test-account', name: 'Example', slug: 'crm-test-account' });
  await db.insert(userSchema).values({ id: actor.userId, email: 'crm-admin@example.test' });
  await db.insert(accountMembershipSchema).values({ accountId: 'crm-test-account', userId: actor.userId, role: 'admin' });
  await db.insert(projectSchema).values([
    { id: actor.orgId, accountId: 'crm-test-account', name: 'A', slug: 'crm-a' },
    { id: 'crm-workspace-b', accountId: 'crm-test-account', name: 'B', slug: 'crm-b' },
  ]);
});

it('reuses native Lists without duplicating records, and isolates workspaces', async () => {
  await installCrm(actor);
  const id = crmListId(actor.orgId, 'companies');
  const list = await readList(actor, { id });
  await writeListRecords(actor, { id, expectedVersion: list.list.version, records: [{ id: crmRecordId(actor.orgId, 'native', 'companies', '1'), values: { name: 'Example Company' } }] });
  await installCrm(actor);

  expect((await readList(actor, { id })).rows).toHaveLength(1);
  await expect(readList({ ...actor, orgId: 'crm-workspace-b' }, { id })).rejects.toMatchObject({ status: 404 });
});
