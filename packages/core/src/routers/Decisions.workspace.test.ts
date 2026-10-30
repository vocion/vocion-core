import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
vi.mock('@/services/ReviewService', () => ({ decide: vi.fn(), snooze: vi.fn() }));
vi.mock('@/services/ActionService', () => ({ proposeAction: vi.fn(), executeAction: vi.fn() }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn() }));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, actionRunSchema, askSchema, projectMemberSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { guardAuth } = await import('./AuthGuards');
const { answerRoute } = await import('./Decisions');
const { decide, snooze } = await import('@/services/ReviewService');
const { proposeAction, executeAction } = await import('@/services/ActionService');
const { emitEvent } = await import('@/services/EventService');
const USER = 'review-both-member';
const ACCOUNT = 'review-account';
const HERE = 'review-here';
const THERE = 'review-there';

beforeEach(async () => {
  vi.clearAllMocks();
  for (const table of [askSchema, actionRunSchema, projectMemberSchema, projectSchema, accountMembershipSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
  await db.insert(userSchema).values({ id: USER, email: 'reviewer@northwind.example' });
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, slug: ACCOUNT, name: 'Northwind' });
  await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: USER, role: 'member' });
  await db.insert(projectSchema).values([HERE, THERE].map(id => ({ id, slug: id, name: id, accountId: ACCOUNT })));
  await db.insert(projectMemberSchema).values([HERE, THERE].map(projectId => ({ projectId, userId: USER, role: 'member' as const })));
  vi.mocked(guardAuth).mockResolvedValue({ userId: USER, orgId: HERE, accountId: ACCOUNT, projectId: HERE, role: 'member', has: () => true });
});

describe('decisions.answer stays in the active workspace even for a member of both', () => {
  it.each(['ask', 'proposal'] as const)('rejects a foreign %s id without changing it or dispatching an effect', async (subject) => {
    const [membership] = await db.select().from(projectMemberSchema).where(and(eq(projectMemberSchema.projectId, THERE), eq(projectMemberSchema.userId, USER)));

    expect(membership?.role).toBe('member');

    const [ask] = await db.insert(askSchema).values({ orgId: THERE, kind: 'ruling', title: 'Foreign private question', options: [{ id: 'approve', label: 'Approve' }] }).returning();
    const [proposal] = await db.insert(actionRunSchema).values({ orgId: THERE, actionId: 'hubspot.update', input: { private: 'foreign input' }, status: 'pending' }).returning();
    const id = subject === 'ask' ? ask!.id : proposal!.id;
    const route = answerRoute as unknown as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<unknown> } };

    await expect(route['~orpc'].handler({ input: { id, subject, option_ids: ['approve'] }, context: {} })).rejects.toMatchObject({ code: 'not-found', status: 404 });
    expect(await db.select().from(askSchema).where(eq(askSchema.id, ask!.id))).toEqual([ask]);
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, proposal!.id))).toEqual([proposal]);

    for (const effect of [decide, snooze, proposeAction, executeAction, emitEvent]) {
      expect(effect).not.toHaveBeenCalled();
    }
  });
});
