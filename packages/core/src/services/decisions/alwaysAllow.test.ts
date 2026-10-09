/**
 * "ALWAYS ALLOW" APPEARS ONLY WHERE THE TRUST LADDER WOULD TAKE IT — an admin,
 * an earned next rung that automates — and choosing it promotes the kind,
 * then runs this one as Allow once. Fixtures are fictional (Northwind).
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/adoption/track', () => ({ track: vi.fn(async () => {}) }));
vi.mock('@/services/EventService', () => ({ ASK_DECIDED: 'ask.decided', emitEvent: vi.fn(async () => ({ eventId: 1, deduped: false, triggered: [] })) }));
const role = vi.fn(async (): Promise<'admin' | 'member' | null> => 'admin');
vi.mock('@/services/WorkspaceAccessService', () => ({ memberWorkspace: vi.fn(async () => {
  const r = await role();
  return r ? { accountRole: r } : null;
}) }));
const eligibility = vi.fn(async () => ({ earned: true, nextRung: 'execute-within-bounds', reason: 'Earned' }));
const promote = vi.fn(async () => ({}));
vi.mock('@/services/autonomy/AutonomyService', () => ({ eligibility: (...a: unknown[]) => (eligibility as (...x: unknown[]) => unknown)(...a), promote: (...a: unknown[]) => (promote as (...x: unknown[]) => unknown)(...a) }));
const decide = vi.fn(async () => ({ execution: { status: 'done' } }));
vi.mock('@/services/ReviewService', () => ({ decide: (...a: unknown[]) => (decide as (...x: unknown[]) => unknown)(...a), snooze: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { withAlwaysAllow } = await import('./alwaysAllow');
const { answerDecision } = await import('./DecisionService');
const { proposalDecisionView } = await import('./proposals');

const ORG = 'org_always_allow';
const DANA = 'usr-dana';

async function pending() {
  const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', input: { objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation' } }, status: 'pending', proposal: { rationale: 'They signed the LOI.', suggestedDecision: 'approve', origin: { conversationId: 392 } } }).returning();
  return run!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  role.mockResolvedValue('admin');
  eligibility.mockResolvedValue({ earned: true, nextRung: 'execute-within-bounds', reason: 'Earned' });
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
  await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
  await db.delete(tenantAccountSchema).where(eq(tenantAccountSchema.id, 'acct-always'));
  await db.insert(tenantAccountSchema).values({ id: 'acct-always', name: 'Northwind', slug: 'northwind-always' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-always', slug: 'northwind-always', name: 'Northwind Support' });
});

describe('Always allow on an approval', () => {
  it('sits between Allow once and Deny, naming the kind and the workspace, where the ladder would take it', async () => {
    const view = await withAlwaysAllow(ORG, DANA, await proposalDecisionView(await pending()), 'hubspot.update');

    expect(view.options.map(o => o.id)).toEqual(['approve', 'always', 'reject']);
    expect(view.options[1]!.label).toMatch(/^Always allow ".+" in Northwind Support$/);
    expect(view.options[1]!.consequence).toContain('Execute within bounds');
  });

  it('is not there for a member, on a rung not yet earned, on a next rung that still asks, or with no action', async () => {
    const view = await proposalDecisionView(await pending());
    role.mockResolvedValueOnce('member');

    expect((await withAlwaysAllow(ORG, DANA, view, 'hubspot.update')).options.map(o => o.id)).toEqual(['approve', 'reject']);

    eligibility.mockResolvedValueOnce({ earned: false, nextRung: 'execute-within-bounds', reason: 'Needs 20 decisions' });

    expect((await withAlwaysAllow(ORG, DANA, view, 'hubspot.update')).options).toHaveLength(2);

    eligibility.mockResolvedValueOnce({ earned: true, nextRung: 'execute-with-approval', reason: 'Below the default' });

    expect((await withAlwaysAllow(ORG, DANA, view, 'hubspot.update')).options).toHaveLength(2);
    expect((await withAlwaysAllow(ORG, DANA, view, null)).options).toHaveLength(2);
  });

  it('choosing it promotes the kind as the person, then approves this one — the agent hears "Always allow"', async () => {
    const run = await pending();
    const out = await answerDecision({ orgId: ORG, conversationId: 392, id: run.id, subject: 'proposal', answer: { kind: 'option', optionIds: ['always'] }, by: DANA, via: 'card' });

    expect(promote).toHaveBeenCalledWith(ORG, 'hubspot.update', DANA);
    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: run.id }, 'approve', ORG, { reviewedBy: DANA });
    expect(out.answer).toEqual({ kind: 'option', optionIds: ['always'] });
    expect(out.asked.options.some(o => o.id === 'always')).toBe(true);
  });

  it('is refused, and nothing moves, where the ladder would not take it', async () => {
    const run = await pending();
    role.mockResolvedValue('member');

    await expect(answerDecision({ orgId: ORG, conversationId: 392, id: run.id, subject: 'proposal', answer: { kind: 'option', optionIds: ['always'] }, by: DANA, via: 'card' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(promote).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it('an ask approval\'s Always allow promotes the kind its Allow once runs', async () => {
    const { raiseDecision } = await import('./DecisionService');
    const { view } = await raiseDecision({ orgId: ORG, conversationId: 392, ownerUserId: DANA, agentSlug: 'revenue-lead', kind: 'approval', question: 'Move Northwind to Negotiation', options: [{ id: 'approve', label: 'Allow once', action: { id: 'hubspot.update', input: { id: '4410' } } }, { id: 'reject', label: 'Deny' }] });
    await answerDecision({ orgId: ORG, conversationId: 392, id: view.id, answer: { kind: 'option', optionIds: ['always'] }, by: DANA, via: 'card' }).catch(() => null);

    expect(promote).toHaveBeenCalledWith(ORG, 'hubspot.update', DANA);
  });
});
