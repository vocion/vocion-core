/**
 * "ALWAYS ALLOW" IS NEVER ON A CARD FOR A KIND A PERSON DECIDES. Every action
 * that declares `approvalRequired` is approved each time, so its approval
 * offers Allow once and Deny only — even for an admin, with the next rung
 * earned and automating. Fixtures are fictional (Northwind).
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/WorkspaceAccessService', () => ({ memberWorkspace: vi.fn(async () => ({ accountRole: 'admin' })) }));
// The ladder would take it: earned, and the next rung runs without asking.
const promote = vi.fn(async () => ({}));
vi.mock('@/services/autonomy/AutonomyService', () => ({
  eligibility: vi.fn(async () => ({ earned: true, nextRung: 'autonomous', reason: 'Earned' })),
  promote: (...a: unknown[]) => (promote as (...x: unknown[]) => unknown)(...a),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { listActions } = await import('@/libs/actions/registry');
const { alwaysAllowOption, takeAlwaysAllow, withAlwaysAllow } = await import('./alwaysAllow');
const { proposalDecisionView } = await import('./proposals');

const ORG = 'org_always_allow_required';
const DANA = 'usr-dana';
const REQUIRED = listActions().filter(a => a.approvalRequired === true).map(a => a.id);

beforeEach(async () => {
  promote.mockClear();
  await db.delete(actionRunSchema);
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, 'acct-always-required'));
  await db.insert(tenantAccountSchema).values({ id: 'acct-always-required', name: 'Northwind', slug: 'northwind-always-required' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-always-required', slug: 'northwind-always-required', name: 'Northwind Growth' });
});

describe('Always allow, for a kind that requires approval', () => {
  it('covers the money, books, MCP and decline kinds', () => {
    expect(REQUIRED).toEqual(expect.arrayContaining(['google_ads.set_budget', 'ads.set_status', 'finance.post_journal_entry', 'finance.recategorize_expense', 'mcp.call', 'review.decline']));
  });

  it.each(REQUIRED)('is never offered on a %s approval, and cannot be taken', async (actionId) => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId, input: {}, status: 'pending', proposal: { rationale: 'Northwind asked for it.', suggestedDecision: 'approve' } }).returning();
    const view = await withAlwaysAllow(ORG, DANA, await proposalDecisionView(run!), actionId);

    expect(await alwaysAllowOption(ORG, DANA, actionId)).toBeNull();
    expect(view.options.map(o => o.id)).not.toContain('always');
    await expect(takeAlwaysAllow(ORG, DANA, actionId)).rejects.toThrow(/Always allow is not open here/);
    expect(promote).not.toHaveBeenCalled();
  });

  it('is offered on a reversible kind that does not require approval, so the ladder above would take one', async () => {
    expect(await alwaysAllowOption(ORG, DANA, 'hubspot.update')).toMatchObject({ id: 'always' });
  });
});
