/**
 * Saved views are rows with owners, the narrowest owner wins for a slug, a
 * person's view is checked before it is kept, and a question asked three
 * times in two weeks is noticed — once — by its shape, not its words.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { stateQueryLogSchema, stateViewSchema, userSchema } = await import('@/models/Schema');
const { briefViews, resetCoreViewSeed, savePersonView, viewBySlug, viewsFor } = await import('./views');
const { noteQuery, REPEAT_THRESHOLD } = await import('./learnViews');

const ORG = 'org-views-own';
const ALEX = 'usr-views-alex';
const CASS = 'usr-views-cass';

beforeAll(async () => {
  resetCoreViewSeed();
  await db.insert(userSchema).values([
    { id: ALEX, email: 'alex@northwind.example', name: 'Alex Rivera' },
    { id: CASS, email: 'cass@northwind.example', name: 'Cass Lund' },
  ]);
});

afterAll(async () => {
  await db.delete(stateQueryLogSchema);
  await db.delete(stateViewSchema);
  await db.delete(userSchema);
});

describe('saved views', () => {
  it('a person\'s copy of a core view replaces it for them alone', async () => {
    const core = await viewBySlug('awaiting-their-reply', { orgId: ORG, userId: ALEX });

    expect(core?.scope).toBe('core');

    await savePersonView({ orgId: ORG, userId: ALEX, slug: 'awaiting-their-reply', name: 'Waiting on their reply (a week)', description: 'Threads I wrote last over a week ago.', query: { ...core!.query, filter: { ...core!.query.filter, last_outbound_at: { since: '-30d', until: '-7d' } } }, createdBy: ALEX });

    expect((await viewBySlug('awaiting-their-reply', { orgId: ORG, userId: ALEX }))?.scope).toBe('person');
    expect((await viewBySlug('awaiting-their-reply', { orgId: ORG, userId: CASS }))?.scope).toBe('core');
  });

  it('a workspace view reaches everyone in it, under a person\'s own', async () => {
    await db.insert(stateViewSchema).values({ scope: 'workspace', orgId: ORG, slug: 'big-invoices', name: 'Big overdue invoices', description: 'Overdue invoices over $5,000.', query: { sets: ['finance.invoice'], filter: { due: { until: 'now' }, balance: { gt: 5000 } } }, createdBy: ALEX });

    expect((await viewsFor({ orgId: ORG, userId: CASS })).map(v => v.slug)).toContain('big-invoices');
    expect((await viewsFor({ orgId: 'org-views-elsewhere', userId: CASS })).map(v => v.slug)).not.toContain('big-invoices');
  });

  it('refuses to keep a view that cannot run', async () => {
    await expect(savePersonView({ orgId: ORG, userId: ALEX, name: 'Moods', description: 'x', query: { sets: ['mail.thread'], filter: { mood: 'happy' } }, createdBy: ALEX })).rejects.toThrow(/cannot run/);
  });

  it('views marked for the brief are found for the brief', async () => {
    await savePersonView({ orgId: ORG, userId: ALEX, name: 'Stale big deals', description: 'Open deals over $50k untouched for 14 days.', query: { sets: ['crm.deal'], filter: { amount: { gt: 50000 }, updated_at: { until: '-14d' } } }, inBrief: true, createdBy: 'agent' });

    expect((await briefViews(ALEX, [ORG])).map(v => v.slug)).toEqual(['stale-big-deals']);
    expect(await briefViews(CASS, [ORG])).toEqual([]);
  });
});

describe('learning a person\'s views', () => {
  const query = { sets: ['finance.invoice'], filter: { due: { until: 'now' }, balance: { gt: 0 } } };

  it('notices the same question the third time in two weeks, and only then', async () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const said: Array<unknown> = [];
    for (let i = 0; i < REPEAT_THRESHOLD + 1; i++) {
      said.push(await noteQuery({ orgId: ORG, userId: CASS, query, ownViews: [], now: new Date(now.getTime() + i * 3_600_000) }));
    }

    expect(said.slice(0, 2)).toEqual([null, null]);
    expect(said[2]).toMatchObject({ times: 3, query });
    expect(said[3]).toBeNull();
  });

  it('the shape is the question, not its order or wording', async () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const reordered = { sets: ['finance.invoice'], filter: { balance: { gt: 0 }, due: { until: 'now' } } };
    await noteQuery({ orgId: ORG, userId: ALEX, query, ownViews: [], now });
    await noteQuery({ orgId: ORG, userId: ALEX, query: reordered, ownViews: [], now });

    expect(await noteQuery({ orgId: ORG, userId: ALEX, query, ownViews: [], now })).toMatchObject({ times: 3 });
  });

  it('says nothing when the person already has that view', async () => {
    const own = [{ id: 1, scope: 'person' as const, slug: 'unpaid', name: 'Unpaid', description: 'x', query, inBrief: false }];
    const now = new Date('2026-10-20T12:00:00Z');
    for (let i = 0; i < REPEAT_THRESHOLD; i++) {
      expect(await noteQuery({ orgId: ORG, userId: ALEX, query, ownViews: own, now })).toBeNull();
    }
  });
});
