/**
 * Auto-approvals on the adoption overview, against PGlite.
 *
 * This number is counted from `action_run` rather than from the activity
 * stream, and the test that matters most here is the one proving why: every
 * other figure on that screen counts what a PERSON did, so an agent's decision
 * must raise the auto-approval count and move nothing else. If that ever
 * regresses, adoption silently starts reporting agent work as human work.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, userActivityEventSchema } = await import('@/models/Schema');
const { countAutoApprovals, getOverview } = await import('./AdoptionService');

const ORG = 'proj_auto_approvals';
const OTHER_ORG = 'proj_auto_approvals_other';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

async function makeRun(opts: {
  orgId?: string;
  approvedByAgent: boolean | null;
  decidedAt: Date | null;
}): Promise<void> {
  await db.insert(actionRunSchema).values({
    orgId: opts.orgId ?? ORG,
    actionId: 'crm.update',
    input: { field: 'value' },
    status: 'done',
    approvedByAgent: opts.approvedByAgent,
    decidedAt: opts.decidedAt,
  });
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(userActivityEventSchema);
});

describe('countAutoApprovals', () => {
  it('counts the runs an agent approved', async () => {
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(1) });
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(2) });

    expect(await countAutoApprovals(ORG, daysAgo(7), null)).toBe(2);
  });

  it('leaves out runs a person decided', async () => {
    await makeRun({ approvedByAgent: false, decidedAt: daysAgo(1) });

    expect(await countAutoApprovals(ORG, daysAgo(7), null)).toBe(0);
  });

  it('leaves out runs nobody has decided yet', async () => {
    await makeRun({ approvedByAgent: null, decidedAt: null });

    expect(await countAutoApprovals(ORG, daysAgo(7), null)).toBe(0);
  });

  it('is scoped to the org', async () => {
    await makeRun({ orgId: OTHER_ORG, approvedByAgent: true, decidedAt: daysAgo(1) });

    expect(await countAutoApprovals(ORG, daysAgo(7), null)).toBe(0);
  });

  it('windows on when the agent decided, not on when the proposal was made', async () => {
    // A proposal raised weeks ago and released today belongs to today.
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(1) });
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(40) });

    expect(await countAutoApprovals(ORG, daysAgo(7), null)).toBe(1);
  });

  it('treats the upper bound as exclusive, so adjacent windows never double-count one decision', async () => {
    const boundary = daysAgo(7);
    await makeRun({ approvedByAgent: true, decidedAt: boundary });

    const previousWindow = await countAutoApprovals(ORG, daysAgo(14), boundary);
    const currentWindow = await countAutoApprovals(ORG, boundary, null);

    expect(previousWindow).toBe(0);
    expect(currentWindow).toBe(1);
  });
});

describe('getOverview', () => {
  it('reports auto-approvals without counting the agent as an active user or an interaction', async () => {
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(1) });

    const overview = await getOverview(ORG, null, 30);

    expect(overview.autoApprovals).toBe(1);
    // The whole reason this is not an adoption event: an agent deciding is not
    // a person using the product, and must not read as one.
    expect(overview.activeUsers).toBe(0);
    expect(overview.interactions).toBe(0);
    expect(overview.accountabilityActions).toBe(0);
  });

  it('carries auto-approvals for the preceding window too, so the screen can show a delta', async () => {
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(3) });
    await makeRun({ approvedByAgent: true, decidedAt: daysAgo(10) });

    const overview = await getOverview(ORG, null, 7);

    expect(overview.autoApprovals).toBe(1);
    expect(overview.previous.autoApprovals).toBe(1);
  });
});
