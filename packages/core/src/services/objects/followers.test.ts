/**
 * The conversation that acts on a request follows it, and can decide its cards from there
 * (FE-133, 2026-10-06). Against PGlite; every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { followFromAction, followersOf, MAX_FOLLOWERS } = await import('./followers');
const { defaultThreadApprovalDeps } = await import('@/services/chat/slackApproval');
const { eq } = await import('drizzle-orm');

const ORG = 'org_followers';
let requestId = 0;
let planId = 0;

beforeAll(async () => {
  const [req] = await createObjectType({ slug: 'request', label: 'Request' }, ORG);
  const [plan] = await createObjectType({ slug: 'architecture_plan', label: 'Plan' }, ORG);
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: req!.id, title: 'Send Word and PowerPoint', metadata: { state: 'building' } }).returning();
  requestId = r!.id;
  const [p] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: plan!.id, title: 'Plan', metadata: { requestId } }).returning();
  planId = p!.id;
});

const meta = async () => (await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId)))[0]!.metadata as Record<string, unknown>;

describe('a conversation that acts on a request follows it', () => {
  it('by the request, its plan or its task, once each, newest kept', async () => {
    await followFromAction(ORG, { requestId }, 501);
    await followFromAction(ORG, { planId }, 501);
    await followFromAction(ORG, { planId }, 502);

    expect(followersOf(await meta())).toEqual([501, 502]);

    for (let c = 600; c < 600 + MAX_FOLLOWERS; c++) {
      await followFromAction(ORG, { requestId }, c);
    }

    expect(followersOf(await meta())).toHaveLength(MAX_FOLLOWERS);
    expect(followersOf(await meta()).at(-1)).toBe(600 + MAX_FOLLOWERS - 1);

    await followFromAction(ORG, { nothing: true }, 700);
  });

  it('can decide a card about the request it follows, though another conversation filed it', async () => {
    await db.update(businessObjectSchema).set({ metadata: { state: 'building', followConversations: [501] } }).where(eq(businessObjectSchema.id, requestId));
    const [card] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.approve_plan', status: 'pending', input: { planId }, invokedBy: 'factory:product-manager', proposal: { origin: { conversationId: 12 } } } as never).returning();

    expect((await defaultThreadApprovalDeps.pending(ORG, 501)).map(c => c.runId)).toEqual([card!.id]);
    expect((await defaultThreadApprovalDeps.pending(ORG, 501, requestId)).map(c => c.runId)).toEqual([card!.id]);
    expect(await defaultThreadApprovalDeps.pending(ORG, 999)).toEqual([]);
    expect(await defaultThreadApprovalDeps.pending(ORG, 501, requestId + 1000)).toEqual([]);
  });
});
