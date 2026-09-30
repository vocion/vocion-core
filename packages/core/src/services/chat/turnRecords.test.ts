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
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { turnRecordsOf } = await import('./turnRecords');

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
      { id: filed!.id, title: 'Fix the header overflow', href: `/dashboard/p/feature/${filed!.id}`, filed: true, change: null, hasStatus: true },
      { id: changed!.id, title: 'Northwind portal', href: `/dashboard/objects/${changed!.id}`, filed: false, change: { fields: ['summary', 'surfaceUrl'], version: 3, historyRef: `${changed!.id}@3` }, hasStatus: false },
    ]);
  });

  it('is nothing for a turn that filed and changed nothing', async () => {
    expect(await turnRecordsOf(ORG, { created: [], written: [], fields: new Map() })).toEqual([]);
  });
});
