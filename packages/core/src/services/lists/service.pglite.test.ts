import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { aggregateList, configureList, createList, listLists, readList, writeListRecords } = await import('./service');
const { installCrm } = await import('./crm');
const member = { orgId: 'lists-northwind', userId: 'lists-alex' };
const other = { ...member, userId: 'lists-blair' };
const admin = { ...member, userId: 'lists-admin' };
const outsider = { orgId: 'lists-harbor', userId: 'lists-outsider' };
const fields = [{ key: 'name', label: 'Name', type: 'text' as const }, { key: 'amount', label: 'Amount', type: 'number' as const }];
const make = (actor = member, scope: 'personal' | 'workspace' = 'personal') => createList(actor, { id: randomUUID(), title: 'Test list', fields, scope });

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values([{ id: 'lists-a', name: 'Northwind', slug: 'lists-northwind' }, { id: 'lists-b', name: 'Harbor', slug: 'lists-harbor' }]);
  await db.insert(userSchema).values([member, other, admin, outsider].map(a => ({ id: a.userId, email: `${a.userId}@example.test` })));
  await db.insert(accountMembershipSchema).values([member, other, admin, outsider].map(a => ({ userId: a.userId, accountId: a === outsider ? 'lists-b' : 'lists-a', role: a === admin ? 'admin' : 'member' })));
  await db.insert(projectSchema).values([{ id: member.orgId, accountId: 'lists-a', name: 'Northwind', slug: 'lists-northwind' }, { id: outsider.orgId, accountId: 'lists-b', name: 'Harbor', slug: 'lists-harbor' }]);
});

describe('durable workspace Lists', () => {
  it('isolates personal records, history and aggregates, including from admins', async () => {
    const list = await make();
    await writeListRecords(member, { id: list.id, expectedVersion: 1, records: [{ id: randomUUID(), values: { name: 'Private prospect', amount: 20 } }] });
    for (const actor of [other, admin, outsider, { ...outsider, orgId: member.orgId }]) {
      await expect(readList(actor, { id: list.id })).rejects.toMatchObject({ status: 404 });
      await expect(aggregateList(actor, { id: list.id })).rejects.toMatchObject({ status: 404 });
      await expect(writeListRecords(actor, { id: list.id, expectedVersion: 2, records: [{ id: randomUUID(), values: {} }] })).rejects.toMatchObject({ status: 404 });
    }

    expect((await listLists(other)).items.some(i => i.id === list.id)).toBe(false);
    expect((await readList(member, { id: list.id })).history).toHaveLength(2);
  });

  it('lets members edit shared records but reserves shared definitions for admins', async () => {
    await expect(make(member, 'workspace')).rejects.toMatchObject({ status: 403 });

    const shared = await make(admin, 'workspace');
    await writeListRecords(member, { id: shared.id, expectedVersion: 1, records: [{ id: randomUUID(), values: { name: 'Shared prospect' } }] });

    await expect(configureList(member, { id: shared.id, expectedVersion: 2, title: 'Changed' })).rejects.toMatchObject({ status: 403 });
    expect((await readList(other, { id: shared.id })).rows).toHaveLength(1);
    await expect(readList(outsider, { id: shared.id })).rejects.toMatchObject({ status: 404 });
  });

  it('rejects stale writes, rolls back invalid batches and preserves previous values', async () => {
    const list = await make();
    const id = randomUUID();
    await writeListRecords(member, { id: list.id, expectedVersion: 1, records: [{ id, values: { name: 'First', amount: 12 } }] });

    await expect(writeListRecords(member, { id: list.id, expectedVersion: 1, records: [{ id, values: { name: 'Stale' } }] })).rejects.toMatchObject({ status: 409 });
    await expect(writeListRecords(member, { id: list.id, expectedVersion: 2, records: [{ id, values: { name: 'Rolled back' } }, { id: randomUUID(), values: { amount: 'invalid' } }] })).rejects.toThrow('Invalid number');

    const after = await readList(member, { id: list.id });

    expect(after.list.version).toBe(2);
    expect(after.rows[0]?.values).toEqual({ name: 'First', amount: 12 });
    expect(after.history).toHaveLength(2);
  });

  it('retains IDs and history when an admin publishes their personal List', async () => {
    const list = await make(admin);
    const id = randomUUID();
    await writeListRecords(admin, { id: list.id, expectedVersion: 1, records: [{ id, values: { name: 'Lead' } }] });
    await configureList(admin, { id: list.id, expectedVersion: 2, scope: 'workspace' });
    const after = await readList(member, { id: list.id });

    expect(after.rows[0]?.id).toBe(id);
    expect(after.history).toHaveLength(3);

    const personal = await make();

    await expect(configureList(member, { id: personal.id, expectedVersion: 1, scope: 'workspace' })).rejects.toMatchObject({ status: 403 });
  });

  it('aggregates beyond pagination and applies saved views', async () => {
    const list = await make();
    await writeListRecords(member, { id: list.id, expectedVersion: 1, records: Array.from({ length: 60 }, (_, i) => ({ id: randomUUID(), values: { name: i < 30 ? 'A' : 'B', amount: 2 } })) });

    expect((await readList(member, { id: list.id, limit: 10 })).rows).toHaveLength(10);
    expect((await aggregateList(member, { id: list.id, sum: 'amount' })).groups).toEqual([{ group: null, count: 60, sum: '120' }]);

    await configureList(member, { id: list.id, expectedVersion: 2, views: [{ name: 'A only', columns: ['name'], filters: [{ field: 'name', value: 'A' }], sortBy: 'amount' }] });

    expect((await readList(member, { id: list.id, view: 'A only' })).total).toBe(30);
  });

  it('validates relationships and refuses sharing a reference to a private List', async () => {
    const target = await make(admin);
    const linked = await createList(admin, { id: randomUUID(), title: 'Links', fields: [{ key: 'contact', label: 'Contact', type: 'reference', referenceListId: target.id }] });

    await expect(writeListRecords(admin, { id: linked.id, expectedVersion: 1, records: [{ id: randomUUID(), values: { contact: randomUUID() } }] })).rejects.toThrow('Unknown record');
    await expect(configureList(admin, { id: linked.id, expectedVersion: 1, scope: 'workspace' })).rejects.toThrow('cannot reference a personal');
  });

  it('archives without removing records and restores editing', async () => {
    const list = await make();
    await configureList(member, { id: list.id, expectedVersion: 1, archived: true });

    await expect(writeListRecords(member, { id: list.id, expectedVersion: 2, records: [{ id: randomUUID(), values: {} }] })).rejects.toThrow('Restore');

    await configureList(member, { id: list.id, expectedVersion: 2, archived: false });
    await writeListRecords(member, { id: list.id, expectedVersion: 3, records: [{ id: randomUUID(), values: {} }] });
  });

  it('does not expose personal Lists through a shared chat actor', async () => {
    const list = await make();
    const sharedChat = { ...member, personalAccess: false };

    expect((await listLists(sharedChat)).items.some(l => l.id === list.id)).toBe(false);
    await expect(readList(sharedChat, { id: list.id })).rejects.toMatchObject({ status: 404 });
    await expect(createList(sharedChat, { id: randomUUID(), title: 'Private', fields })).rejects.toMatchObject({ status: 403 });
  });

  it('moves an owned personal List into an administered workspace with stable IDs', async () => {
    await db.insert(projectSchema).values({ id: 'lists-personal', accountId: 'lists-a', name: 'Personal', slug: 'lists-personal', kind: 'personal', ownerUserId: admin.userId });
    const owner = { ...admin, orgId: 'lists-personal' };
    const list = await make(owner);
    const id = randomUUID();
    await writeListRecords(owner, { id: list.id, expectedVersion: 1, records: [{ id, values: { name: 'Promoted' } }] });

    await expect(configureList(owner, { id: list.id, expectedVersion: 2, targetWorkspaceId: outsider.orgId, scope: 'workspace' })).rejects.toMatchObject({ status: 404 });

    await configureList(owner, { id: list.id, expectedVersion: 2, targetWorkspaceId: member.orgId, scope: 'workspace' });

    await expect(readList(owner, { id: list.id })).rejects.toMatchObject({ status: 404 });

    const shared = await readList(member, { id: list.id });

    expect(shared.rows[0]?.id).toBe(id);
    expect(shared.history).toHaveLength(3);
  });

  it('retries creation without duplicating the List or its first revision', async () => {
    const input = { id: randomUUID(), title: 'Idempotent', fields };
    await createList(member, input);
    await createList(member, input);

    expect((await readList(member, { id: input.id })).history).toHaveLength(1);
  });

  it('creates the CRM once, with linked types, and does not reset customizations', async () => {
    await expect(installCrm(member)).rejects.toMatchObject({ status: 403 });

    const first = await installCrm(admin);

    expect(first.lists).toHaveLength(4);

    const company = first.lists[0]!;
    await configureList(admin, { id: company.id, expectedVersion: 1, title: 'Accounts' });
    const second = await installCrm(admin);

    expect(second.lists.map(l => l.id)).toEqual(first.lists.map(l => l.id));
    expect(second.lists[0]?.title).toBe('Accounts');
  });
});
