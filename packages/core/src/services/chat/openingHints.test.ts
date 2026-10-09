/**
 * The opening hint's reads, against PGlite: a newcomer to a new workspace is
 * offered the tour, and once they wave it away (the `chat.hint_dismissed`
 * event, which is all the ranker needs) it stays away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, userActivityEventSchema } = await import('@/models/Schema');
const { loadOpeningHints } = await import('./openingHints');

const ORG = 'proj-hints';

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-hints', name: 'Northwind', slug: 'northwind-hints' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-hints', slug: 'hints', name: 'Support' });
});

describe('loadOpeningHints', () => {
  it('offers a newcomer the tour, and leaves it away once dismissed', async () => {
    const first = await loadOpeningHints({ orgId: ORG, userId: 'usr-sam', isAdmin: true, leadSpoken: 'Ava' });

    expect(first.map(h => h.type)).toEqual(['capability']);
    expect(first[0]!.reason).toMatch(/Ava and the team/);

    await db.insert(userActivityEventSchema).values({ orgId: ORG, projectId: ORG, userId: 'usr-sam', eventType: 'chat.hint_dismissed', metadata: { key: 'capability', type: 'capability' } });

    expect(await loadOpeningHints({ orgId: ORG, userId: 'usr-sam', isAdmin: true, leadSpoken: 'Ava' })).toEqual([]);
  });

  it('lets the tour fade for someone who has talked here a while', async () => {
    await db.insert(userActivityEventSchema).values(Array.from({ length: 6 }, () => ({ orgId: ORG, projectId: ORG, userId: 'usr-dana', eventType: 'chat.conversation_created' })));

    expect(await loadOpeningHints({ orgId: ORG, userId: 'usr-dana', isAdmin: true, leadSpoken: 'Ava' })).toEqual([]);
  });
});
