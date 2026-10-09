/**
 * view.save keeps a query as the asker's own view, refuses one that cannot
 * run, and Undo takes it back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/conversationChannel', () => ({
  personBehind: vi.fn(async (_orgId: string, invokedBy?: string) => (invokedBy === 'usr-vsave-alex' ? { userId: 'usr-vsave-alex', name: 'Alex Rivera', email: 'alex@northwind.example' } : null)),
}));

const { db } = await import('@/libs/DB');
const { stateViewSchema, userSchema } = await import('@/models/Schema');
const { viewSaveAction } = await import('./view-save');
const { viewBySlug } = await import('@/services/state/state');

const ORG = 'org-vsave';
const ALEX = 'usr-vsave-alex';
const input = { name: 'Big overdue invoices', description: 'Overdue invoices over $5,000.', query: { sets: ['finance.invoice'], filter: { due: { until: 'now' }, balance: { gt: 5000 } } }, in_brief: true };

beforeAll(async () => {
  await db.insert(userSchema).values({ id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' });
});

afterAll(async () => {
  await db.delete(stateViewSchema);
  await db.delete(userSchema);
});

describe('view.save', () => {
  it('saves the asker\'s own view, and Undo removes it', async () => {
    const ctx = { orgId: ORG, invokedBy: ALEX, proposedBy: 'agent:revenue-lead' };

    expect(await viewSaveAction.precheck!(ctx as never, input)).toBeUndefined();

    const result = await viewSaveAction.execute(ctx as never, input) as Record<string, unknown>;

    expect(result.slug).toBe('big-overdue-invoices');
    expect(await viewBySlug('big-overdue-invoices', { orgId: ORG, userId: ALEX })).toMatchObject({ scope: 'person', inBrief: true });

    await viewSaveAction.undo!(ctx as never, input, result);

    expect((await viewBySlug('big-overdue-invoices', { orgId: ORG, userId: ALEX }))).toBeUndefined();
  });

  it('refuses a query that cannot run, and a turn with no person behind it', async () => {
    expect(await viewSaveAction.precheck!({ orgId: ORG, invokedBy: ALEX } as never, { ...input, query: { sets: ['finance.invoice'], filter: { mood: 'x' } } })).toMatch(/cannot run/);
    expect(await viewSaveAction.precheck!({ orgId: ORG, invokedBy: 'agent:scheduler' } as never, input)).toMatch(/belongs to a person/);
  });
});
