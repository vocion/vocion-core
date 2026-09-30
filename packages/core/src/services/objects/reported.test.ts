import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema } = await import('@/models/Schema');
const { createBusinessObject } = await import('@/services/BusinessObjectService');
const { reportedAttachments, reportedLinks } = await import('./reported');

/**
 * WHAT THE PERSON SAW, KEPT WITH WHAT THEY ASKED FOR (Chris, 2026-09-30,
 * #268: filed from chat with a screenshot, and the screenshot was nowhere on
 * its page or its contract). Fixture uploads, fictional.
 */

const ORG = 'org_reported';

async function clear() {
  await db.delete(artifactSchema);
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(conversationSchema);
}

async function upload(conversationId: number, title: string, over: Record<string, unknown> = {}) {
  const [a] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'file', title, url: `/api/artifacts/o-x/${title}`, conversationId, lastAuthorKind: 'human', ...over } as never).returning();
  return a!;
}

beforeEach(async () => {
  await clear();
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request' });
});

afterAll(clear);

describe('filing from a conversation', () => {
  it('links what the person sent in it to the new record, as reported', async () => {
    const [convo] = await db.insert(conversationSchema).values({ orgId: ORG, title: 'Header overflows on a phone', agentSlug: 'product-manager' } as never).returning({ id: conversationSchema.id });
    const shot = await upload(convo!.id, 'header-overflow.png');
    // Already another record's evidence: stays where it is.
    const other = await upload(convo!.id, 'older.png', { recordType: 'object', recordId: '1', recordRole: 'reported' });
    // The agent's own file in the thread is not what the person reported.
    const agents = await upload(convo!.id, 'agent-draft.png', { lastAuthorKind: 'agent' });

    const obj = await createBusinessObject({ typeSlug: 'request', title: 'Fix header width overflow on mobile', metadata: {} }, ORG, 'user_dana', { source: 'proposal', conversationId: convo!.id, actor: 'user_dana' });

    const rows = await db.select().from(artifactSchema).where(eq(artifactSchema.orgId, ORG));
    const by = (id: number) => rows.find(r => r.id === id)!;

    expect(by(shot.id)).toMatchObject({ recordType: 'object', recordId: String(obj!.id), recordRole: 'reported' });
    expect(by(other.id).recordId).toBe('1');
    expect(by(agents.id).recordId).toBeNull();
  });
});

describe('a record filed before uploads were linked', () => {
  it('finds them in the conversation it came from, and the contract gets their links', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.northwind.example');
    const [type] = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
    const [convo] = await db.insert(conversationSchema).values({ orgId: ORG, title: 'Header overflows on a phone', agentSlug: 'product-manager' } as never).returning({ id: conversationSchema.id });
    const shot = await upload(convo!.id, 'header-overflow.png', { createdAt: new Date('2026-09-30T08:00:00Z') });
    await upload(convo!.id, 'later.png', { createdAt: new Date('2026-09-30T12:00:00Z') });
    await db.insert(businessObjectSchema).values({ id: 268, orgId: ORG, typeId: type!.id, title: 'Fix header width overflow on mobile', metadata: {}, createdAt: new Date('2026-09-30T08:05:00Z') });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate', status: 'done', input: {}, proposal: { origin: { conversationId: convo!.id } }, result: { objectId: 268 } } as never);

    const sent = await reportedAttachments(ORG, { id: 268, createdAt: new Date('2026-09-30T08:05:00Z'), conversationId: convo!.id });

    expect(sent.map(a => a.title)).toEqual(['header-overflow.png']);
    expect(await reportedLinks(ORG, 268)).toEqual([{ title: 'header-overflow.png', url: `https://app.northwind.example/dashboard/artifacts/${shot.id}`, file: 'https://app.northwind.example/api/artifacts/o-x/header-overflow.png' }]);

    vi.unstubAllEnvs();
  });
});
