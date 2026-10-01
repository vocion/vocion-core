import { describe, expect, it, vi } from 'vitest';

/**
 * The records a turn filed or changed, from its typed events — the chat's
 * microcards read these, never the reply's words. Fixtures are fictional.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/objects/recordHref', () => ({
  recordLinksForOrg: async () => ({ pages: new Map([['request', '/dashboard/p/feature/{id}']]), workspaceSlug: null, reports: new Set(['request']) }),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationMessageSchema, conversationSchema, toolCallSchema } = await import('@/models/Schema');
const { conversationRecords, threadRecordIds, turnRecordsOf } = await import('./turnRecords');

const ORG = 'org_turn_records';

describe('turnRecordsOf', () => {
  it('names what the turn filed and what it changed, with the fields and version the change wrote', async () => {
    const [req] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [product] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    const [filed] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: req!.id, title: 'Fix the header overflow', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    const [changed] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: product!.id, title: 'Northwind portal', metadata: {} } as never).returning({ id: businessObjectSchema.id });

    const out = await turnRecordsOf(ORG, {
      created: [{ type: 'object', id: String(filed!.id) }],
      written: [{ ref: { type: 'object', id: String(changed!.id) }, to: 2 }, { ref: { type: 'object', id: String(changed!.id) }, to: 3 }, { ref: { type: 'artifact', id: '9' }, to: 4 }],
      fields: new Map([[`object:${changed!.id}`, ['summary', 'surfaceUrl']]]),
    });

    expect(out).toEqual([
      // Each reads by its type's code (no type here declares one: derived from the slug).
      { id: filed!.id, code: `REQ-${filed!.id}`, title: 'Fix the header overflow', href: `/dashboard/p/feature/${filed!.id}`, filed: true, change: null, hasStatus: true },
      { id: changed!.id, code: `PRO-${changed!.id}`, title: 'Northwind portal', href: `/dashboard/objects/${changed!.id}`, filed: false, change: { fields: ['summary', 'surfaceUrl'], version: 3, historyRef: `${changed!.id}@3` }, hasStatus: false },
    ]);
  });

  it('is nothing for a turn that filed and changed nothing', async () => {
    expect(await turnRecordsOf(ORG, { created: [], written: [], fields: new Map() })).toEqual([]);
  });
});

describe('conversationRecords — what the thread is about, read from the records (#269)', () => {
  const orgId = 'org_thread_records';

  async function type(slug: string) {
    const [t] = await db.insert(businessObjectTypeSchema).values({ orgId, slug, label: slug, schema: { type: 'object', properties: {} } } as never).returning({ id: businessObjectTypeSchema.id });
    return t!.id;
  }

  it('names what the thread\'s own actions filed on a later turn that filed nothing, then what that turn read', async () => {
    const req = await type('request');
    const product = await type('product');
    const [conv] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'product-manager', title: 'Fix the header', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    const [other] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'product-manager', title: 'Elsewhere', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });
    const [filed] = await db.insert(businessObjectSchema).values({ orgId, typeId: req, title: 'Fix the header overflow', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    const [notOurs] = await db.insert(businessObjectSchema).values({ orgId, typeId: req, title: 'Filed in another thread', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    const [read] = await db.insert(businessObjectSchema).values({ orgId, typeId: product, title: 'Northwind portal', metadata: {} } as never).returning({ id: businessObjectSchema.id });
    await db.insert(actionRunSchema).values([
      { orgId, actionId: 'objects.create', status: 'done', input: {}, result: { objectId: filed!.id }, proposal: { origin: { conversationId: conv!.id } } },
      { orgId, actionId: 'objects.create', status: 'done', input: {}, result: { objectId: notOurs!.id }, proposal: { origin: { conversationId: other!.id } } },
    ] as never);
    // The turn before, and the later turn: "Stuck?", which filed nothing.
    await db.insert(conversationMessageSchema).values({ conversationId: conv!.id, role: 'user', content: 'fix the header', createdAt: new Date('2026-09-30T09:00:00Z') } as never);
    await db.insert(toolCallSchema).values({ orgId, agentSlug: 'product-manager', tool: 'read_object', input: { object_type: 'product', id: notOurs!.id }, output: 'ok', conversationId: conv!.id, createdAt: new Date('2026-09-30T09:00:10Z') } as never);
    await db.insert(conversationMessageSchema).values({ conversationId: conv!.id, role: 'user', content: 'Stuck?', createdAt: new Date('2026-09-30T10:00:00Z') } as never);
    await db.insert(toolCallSchema).values([
      { orgId, agentSlug: 'product-manager', tool: 'read_object', input: { object_type: 'product', id: read!.id }, output: 'ok', conversationId: conv!.id, createdAt: new Date('2026-09-30T10:00:05Z') },
      // An id with no object type beside it may be an ask or a run: not a record.
      { orgId, agentSlug: 'product-manager', tool: 'decide_ask', input: { id: notOurs!.id }, output: 'ok', conversationId: conv!.id, createdAt: new Date('2026-09-30T10:00:06Z') },
    ] as never);

    expect(await threadRecordIds(orgId, conv!.id)).toEqual([filed!.id]);

    const out = await conversationRecords(orgId, conv!.id);

    expect(out!.map(r => [r.id, r.filed, r.hasStatus])).toEqual([[filed!.id, true, true], [read!.id, false, false]]);
    expect(out![0]!.href).toBe(`/dashboard/p/feature/${filed!.id}`);
  });

  it('is null for a thread in another workspace', async () => {
    const [conv] = await db.insert(conversationSchema).values({ orgId: 'org_thread_records_other', agentSlug: 'product-manager', title: 'x', createdBy: 'usr-kestrel' } as never).returning({ id: conversationSchema.id });

    expect(await conversationRecords(orgId, conv!.id)).toBeNull();
  });
});
