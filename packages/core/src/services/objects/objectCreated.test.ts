import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eventLogSchema } = await import('@/models/Schema');
const { createBusinessObject, createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { actorIsPerson, objectCreatedPayload } = await import('./objectCreated');

const ORG = 'org_object_created';

describe('object.created (backlog 038)', () => {
  it('says who asked, and where', () => {
    expect(objectCreatedPayload(ORG, { id: 7, title: 'A room will not open' }, 'request', { source: 'proposal', conversationId: 12, actor: 'user_1', byPerson: true }))
      .toEqual({ orgId: ORG, objectId: 7, objectType: 'request', title: 'A room will not open', source: 'proposal', conversationId: 12, actor: 'user_1', byPerson: true });
    expect(objectCreatedPayload(ORG, { id: 7, title: 't' }, 'request', { source: 'service' })).toMatchObject({ actor: 'system', byPerson: false, conversationId: null });
  });

  it('tells a person from a machine', () => {
    expect(actorIsPerson('user_1')).toBe(true);
    expect(actorIsPerson('agent:product-manager')).toBe(false);
    expect(actorIsPerson('token:4')).toBe(false);
    expect(actorIsPerson('system')).toBe(false);
    expect(actorIsPerson(null)).toBe(false);
  });

  it('is raised by the create path, once per record', async () => {
    await createObjectType({ slug: 'request', label: 'Request' }, ORG);
    const obj = await createBusinessObject({ typeSlug: 'request', title: 'Rooms keep their order', metadata: {} } as never, ORG, 'user_1', { source: 'app', actor: 'user_1' });

    const rows = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'object.created')));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ objectId: obj!.id, objectType: 'request', source: 'app', byPerson: true });
    expect(rows[0]!.dedupeKey).toBe(`object.created:${obj!.id}`);
  });
});
