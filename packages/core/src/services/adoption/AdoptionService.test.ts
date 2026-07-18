import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const {
  accountMembershipSchema,
  projectSchema,
  tenantAccountSchema,
  userActivityEventSchema,
  userSchema,
} = await import('@/models/Schema');
const { classifyStatus, countSessions, getAgentRows, getMemberProfile, getOverview, getUserRows } = await import('./AdoptionService');
const { track } = await import('./track');

const ORG_A = 'proj_adoption_a';
const ORG_B = 'proj_adoption_b';
const ACCT_A = 'acct_adoption_a';
const ACCT_B = 'acct_adoption_b';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function seedTenants() {
  await db.insert(tenantAccountSchema).values([
    { id: ACCT_A, name: 'A', slug: 'adoption-a' },
    { id: ACCT_B, name: 'B', slug: 'adoption-b' },
  ]);
  await db.insert(projectSchema).values([
    { id: ORG_A, accountId: ACCT_A, slug: 'adoption-a', name: 'A' },
    { id: ORG_B, accountId: ACCT_B, slug: 'adoption-b', name: 'B' },
  ]);
  await db.insert(userSchema).values([
    { id: 'usr-a1', name: 'Alice', email: 'alice@a.test' },
    { id: 'usr-a2', name: 'Aaron', email: 'aaron@a.test' },
    { id: 'usr-b1', name: 'Bob', email: 'bob@b.test' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: ACCT_A, userId: 'usr-a1', role: 'admin' },
    { accountId: ACCT_A, userId: 'usr-a2', role: 'member' },
    { accountId: ACCT_B, userId: 'usr-b1', role: 'admin' },
  ]);
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await seedTenants();
});

describe('countSessions', () => {
  it('splits sessions at the idle gap', () => {
    const ts = [0, 5, 10, 60, 65, 200].map(m => new Date(m * 60_000));
    // gaps: 5,5,50,5,135 → new sessions at 0, 60, 200
    expect(countSessions(ts, 30)).toBe(3);
  });

  it('counts one session for a single event and zero for none', () => {
    expect(countSessions([new Date()], 30)).toBe(1);
    expect(countSessions([], 30)).toBe(0);
  });

  it('a gap of exactly the timeout stays in the same session', () => {
    const ts = [0, 30].map(m => new Date(m * 60_000));
    expect(countSessions(ts, 30)).toBe(1);
  });
});

describe('classifyStatus', () => {
  it('never — no activity ever', () => {
    expect(classifyStatus({ windowDays: 30, activeDays: 0, interactions: 0, hasEverBeenActive: false })).toBe('never');
  });

  it('dormant — history but nothing in window', () => {
    expect(classifyStatus({ windowDays: 30, activeDays: 0, interactions: 0, hasEverBeenActive: true })).toBe('dormant');
  });

  it('active — some activity below the power bar', () => {
    expect(classifyStatus({ windowDays: 30, activeDays: 3, interactions: 40, hasEverBeenActive: true })).toBe('active');
  });

  it('power — ≥40% of days and ≥10 interactions', () => {
    expect(classifyStatus({ windowDays: 30, activeDays: 12, interactions: 10, hasEverBeenActive: true })).toBe('power');
    expect(classifyStatus({ windowDays: 30, activeDays: 12, interactions: 9, hasEverBeenActive: true })).toBe('active');
    expect(classifyStatus({ windowDays: 7, activeDays: 3, interactions: 25, hasEverBeenActive: true })).toBe('power');
  });
});

describe('track', () => {
  it('writes a row for a human actor', async () => {
    await track({ orgId: ORG_A, userId: 'usr-a1' }, 'chat.message_sent', {
      agentSlug: 'helper',
      resource: ['conversation_message', 42],
    });
    const rows = await db.select().from(userActivityEventSchema);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: ORG_A,
      userId: 'usr-a1',
      agentSlug: 'helper',
      eventType: 'chat.message_sent',
      resourceType: 'conversation_message',
      resourceId: '42',
    });
  });

  it('skips system principals', async () => {
    for (const userId of ['web', 'review-service', 'agent:helper', 'token:abc']) {
      await track({ orgId: ORG_A, userId }, 'review.decided', { meta: { kind: 'skill', decision: 'approved' } });
    }
    expect(await db.select().from(userActivityEventSchema)).toHaveLength(0);
  });

  it('is idempotent per resource (backfill / double-fire guard)', async () => {
    for (let i = 0; i < 2; i++) {
      await track({ orgId: ORG_A, userId: 'usr-a1' }, 'learning.added', { resource: ['learning', 7] });
    }
    expect(await db.select().from(userActivityEventSchema)).toHaveLength(1);
  });

  it('drops events with malformed metadata instead of throwing', async () => {
    await track({ orgId: ORG_A, userId: 'usr-a1' }, 'review.decided', {
      // @ts-expect-error — deliberately malformed
      meta: { kind: 'skill', decision: 'maybe' },
    });
    expect(await db.select().from(userActivityEventSchema)).toHaveLength(0);
  });
});

describe('session derivation (SQL)', () => {
  it('matches the 30-minute-gap convention', async () => {
    // usr-a1: two clusters (gap 120m). usr-a2: one cluster.
    const stamps = [
      { u: 'usr-a1', at: minutesAgo(300) },
      { u: 'usr-a1', at: minutesAgo(295) },
      { u: 'usr-a1', at: minutesAgo(175) },
      { u: 'usr-a1', at: minutesAgo(170) },
      { u: 'usr-a2', at: minutesAgo(50) },
      { u: 'usr-a2', at: minutesAgo(45) },
    ];
    await db.insert(userActivityEventSchema).values(stamps.map(s => ({
      orgId: ORG_A,
      userId: s.u,
      eventType: 'activity.heartbeat',
      createdAt: s.at,
    })));

    const overview = await getOverview(ORG_A, ACCT_A, 7);
    expect(overview.sessions).toBe(3);
    expect(overview.activeUsers).toBe(2);

    const users = await getUserRows(ORG_A, ACCT_A, 7);
    expect(users.find(u => u.userId === 'usr-a1')?.sessions).toBe(2);
    expect(users.find(u => u.userId === 'usr-a2')?.sessions).toBe(1);
  });
});

describe('multi-tenant isolation', () => {
  beforeEach(async () => {
    await db.insert(userActivityEventSchema).values([
      { orgId: ORG_A, userId: 'usr-a1', eventType: 'chat.message_sent', agentSlug: 'helper-a', createdAt: minutesAgo(60) },
      { orgId: ORG_B, userId: 'usr-b1', eventType: 'chat.message_sent', agentSlug: 'helper-b', createdAt: minutesAgo(60) },
    ]);
  });

  it('overview counts only the caller org', async () => {
    const a = await getOverview(ORG_A, ACCT_A, 30);
    expect(a.activeUsers).toBe(1);
    expect(a.chatMessages).toBe(1);
    expect(a.totalMembers).toBe(2);
  });

  it('user rows never include another account\'s members or events', async () => {
    const rowsA = await getUserRows(ORG_A, ACCT_A, 30);
    expect(rowsA.map(r => r.userId).sort()).toEqual(['usr-a1', 'usr-a2']);
    expect(rowsA.find(r => r.userId === 'usr-a1')?.messages).toBe(1);

    const rowsB = await getUserRows(ORG_B, ACCT_B, 30);
    expect(rowsB.map(r => r.userId)).toEqual(['usr-b1']);
  });

  it('agent rows are org-scoped', async () => {
    const agentsA = await getAgentRows(ORG_A, 30);
    expect(agentsA.map(a => a.agentSlug)).toEqual(['helper-a']);
  });

  it('members with no events classify as never', async () => {
    const rowsA = await getUserRows(ORG_A, ACCT_A, 30);
    expect(rowsA.find(r => r.userId === 'usr-a2')?.status).toBe('never');
  });
});

describe('getMemberProfile', () => {
  it('returns the profile for a member of the caller\'s account', async () => {
    expect(await getMemberProfile(ACCT_A, 'usr-a1')).toEqual({ name: 'Alice', email: 'alice@a.test' });
  });

  it('returns null for a user outside the caller\'s account (no cross-tenant PII)', async () => {
    expect(await getMemberProfile(ACCT_A, 'usr-b1')).toBeNull();
    expect(await getMemberProfile(ACCT_B, 'usr-a1')).toBeNull();
  });

  it('returns null for unknown users and missing account context', async () => {
    expect(await getMemberProfile(ACCT_A, 'usr-nope')).toBeNull();
    expect(await getMemberProfile(null, 'usr-a1')).toBeNull();
  });
});

describe('adoption router gating', () => {
  it('rejects members with 403 and serves admins', async () => {
    const { call } = await import('@orpc/server');
    const { adoptionUsersRoute } = await import('@/routers/Analytics');

    const session = (role: 'admin' | 'member') => ({
      user: { id: 'usr-a1', accountId: ACCT_A, projectId: ORG_A, role },
    });

    vi.mocked(auth as any).mockResolvedValue(session('member'));
    await expect(call(adoptionUsersRoute, { days: 30 })).rejects.toMatchObject({ status: 403 });

    vi.mocked(auth as any).mockResolvedValue(session('admin'));
    const rows = await call(adoptionUsersRoute, { days: 30 });
    expect(rows.map(r => r.userId).sort()).toEqual(['usr-a1', 'usr-a2']);
  });
});
