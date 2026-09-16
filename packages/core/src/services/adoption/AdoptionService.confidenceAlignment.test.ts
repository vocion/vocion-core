/**
 * Confidence alignment — the agent's stated proposal confidence joined with
 * reviewer outcomes. Worth pinning: the bucket edges, the approved definition
 * (anything decided that is not rejected), the confident-but-rejected
 * misalignment window, and org isolation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  actionRunSchema,
  projectSchema,
  tenantAccountSchema,
  userActivityEventSchema,
  userSchema,
} = await import('@/models/Schema');
const { getAgentDetail } = await import('./AdoptionService');

const ORG = 'proj_conf_a';
const OTHER_ORG = 'proj_conf_b';
const ACCT = 'acct_conf_a';
const SLUG = 'revenue-lead';

function proposalRun(orgId: string, confidence: number, status: 'done' | 'rejected', daysAgo = 1) {
  return {
    orgId,
    actionId: 'crm.update',
    input: {},
    status,
    invokedBy: `agent:${SLUG}`,
    proposal: { confidence },
    decidedBy: 'usr-c1',
    decidedAt: new Date(Date.now() - daysAgo * 86_400_000),
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

beforeEach(async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(actionRunSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(userSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'A', slug: 'conf-a' });
  await db.insert(projectSchema).values([
    { id: ORG, accountId: ACCT, slug: 'conf-a', name: 'A' },
    { id: OTHER_ORG, accountId: ACCT, slug: 'conf-b', name: 'B' },
  ]);
});

describe('getAgentDetail confidenceAlignment', () => {
  it('buckets by stated confidence and joins the reviewer outcome', async () => {
    await db.insert(actionRunSchema).values([
      proposalRun(ORG, 0.95, 'done'),
      proposalRun(ORG, 0.92, 'done'),
      proposalRun(ORG, 0.91, 'rejected', 2),
      proposalRun(ORG, 0.7, 'done'),
      proposalRun(ORG, 0.65, 'rejected'),
      proposalRun(ORG, 0.4, 'rejected'),
      // Another org's identical agent slug must not move the numbers.
      proposalRun(OTHER_ORG, 0.95, 'rejected'),
    ]);

    const detail = await getAgentDetail(ORG, ACCT, SLUG, 30);
    const [confident, unsure, hesitant] = detail.confidenceAlignment.buckets;

    expect(confident).toMatchObject({ proposals: 3, approvedPct: 67 });
    expect(unsure).toMatchObject({ proposals: 2, approvedPct: 50 });
    expect(hesitant).toMatchObject({ proposals: 1, approvedPct: 0 });
    expect(detail.confidenceAlignment.confidentRejectedLast7).toBe(1);
  });

  it('reports empty buckets as dashes, not zeros', async () => {
    const detail = await getAgentDetail(ORG, ACCT, SLUG, 30);

    expect(detail.confidenceAlignment.buckets.every(b => b.proposals === 0 && b.approvedPct === null)).toBe(true);
    expect(detail.confidenceAlignment.confidentRejectedLast7).toBe(0);
  });

  it('leaves a confident rejection older than a week out of the misalignment row', async () => {
    await db.insert(actionRunSchema).values([proposalRun(ORG, 0.95, 'rejected', 10)]);

    const detail = await getAgentDetail(ORG, ACCT, SLUG, 30);

    expect(detail.confidenceAlignment.buckets[0]).toMatchObject({ proposals: 1, approvedPct: 0 });
    expect(detail.confidenceAlignment.confidentRejectedLast7).toBe(0);
  });
});
