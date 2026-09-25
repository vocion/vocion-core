import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The status panel polls this every 15s. It must COUNT, never load rows: on
 * 2026-09-25 it selected every agent, skill, object and knowledge chunk (with
 * embeddings) to read `.length`, the calls piled up, and production ran out of
 * heap twice. Fixtures are fictional.
 */

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn(async () => ({ userId: 'usr-kestrel' })) }));

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { GET } = await import('./route');

afterEach(() => vi.restoreAllMocks());

describe('/rpc/admin', () => {
  it('reports counts and never selects whole rows', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: 'org_kestrel', slug: 'request', label: 'Request', schema: {} } as never).returning({ id: businessObjectTypeSchema.id });
    await db.insert(businessObjectSchema).values([1, 2, 3].map(i => ({ orgId: 'org_kestrel', typeId: type!.id, title: `Kestrel ${i}`, metadata: { body: 'x'.repeat(1000) } })) as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const select = vi.spyOn(db, 'select');

    const res = await GET();
    const body = await res.json() as { db: { objects: number; objectTypes: number } };

    expect(body.db.objects).toBe(3);
    expect(body.db.objectTypes).toBe(1);

    // Every select is a projection (count), never `select()` of whole rows.
    for (const call of select.mock.calls) {
      expect(call.length).toBeGreaterThan(0);
    }
  });
});
