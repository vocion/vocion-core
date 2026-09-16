/**
 * The approval-rate trend on the per-agent adoption page. Worth pinning: the
 * cumulative rate uses the same decision buckets as the stat card (edits count
 * against), rule adoptions land on the day they happened, and another org's
 * events never leak in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  projectSchema,
  tenantAccountSchema,
  userActivityEventSchema,
  userSchema,
} = await import('@/models/Schema');
const { getAgentDetail } = await import('./AdoptionService');

const ORG = 'proj_trend_a';
const OTHER_ORG = 'proj_trend_b';
const ACCT = 'acct_trend_a';
const SLUG = 'revenue-lead';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const dayKey = (d: number) => daysAgo(d).toISOString().slice(0, 10);

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'A', slug: 'trend-a' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: ACCT, slug: 'trend-a', name: 'A' },
    { id: OTHER_ORG, accountId: ACCT, slug: 'trend-b', name: 'B' },
  ]);
  await db.insert(userSchema).values({ id: 'usr-t1', name: 'Tess', email: 'tess@a.test' });
});

function decision(orgId: string, decision: string, at: Date) {
  return {
    orgId,
    userId: 'usr-t1',
    eventType: 'review.decided',
    agentSlug: SLUG,
    metadata: { decision },
    createdAt: at,
  };
}

describe('getAgentDetail approvalTrend', () => {
  it('accumulates the rate with edits counting against, and marks adoptions', async () => {
    await db.insert(userActivityEventSchema).values([
      decision(ORG, 'approved', daysAgo(5)),
      decision(ORG, 'approved', daysAgo(5)),
      decision(ORG, 'rejected', daysAgo(3)),
      decision(ORG, 'edited', daysAgo(3)),
      decision(ORG, 'approved', daysAgo(1)),
      // Cross-tenant: same slug, other org — must not move the trend.
      decision(OTHER_ORG, 'rejected', daysAgo(1)),
      {
        orgId: ORG,
        userId: 'usr-t1',
        eventType: 'learning.added',
        agentSlug: SLUG,
        metadata: {},
        createdAt: daysAgo(3),
      },
    ]);

    const detail = await getAgentDetail(ORG, ACCT, SLUG, 7);
    const byDay = new Map(detail.approvalTrend.map(p => [p.day, p]));

    // Day -5: 2 approved of 2 → 100%.
    expect(byDay.get(dayKey(5))).toMatchObject({ decisions: 2, ratePct: 100, adoptions: 0 });
    // Day -3: +1 rejected +1 edited → 2 of 4 → 50%, and the adoption marker.
    expect(byDay.get(dayKey(3))).toMatchObject({ decisions: 2, ratePct: 50, adoptions: 1 });
    // Day -1: +1 approved → 3 of 5 → 60%; the other org's rejection is invisible.
    expect(byDay.get(dayKey(1))).toMatchObject({ decisions: 1, ratePct: 60 });
    // Quiet days carry the cumulative rate forward instead of dropping to zero.
    expect(byDay.get(dayKey(2))).toMatchObject({ decisions: 0, ratePct: 50 });
    expect(detail.approvalTrend).toHaveLength(7);
  });

  it('reports zero across the board when nothing was ever decided', async () => {
    const detail = await getAgentDetail(ORG, ACCT, SLUG, 7);

    expect(detail.approvalTrend.every(p => p.decisions === 0 && p.ratePct === 0)).toBe(true);
  });
});
