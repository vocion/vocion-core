/**
 * Conversation 420 (2026-10-01): "drop the incident card" — the card was the
 * on-call engineer's, and every path the product manager had answered "not
 * yours". An agent never takes back another seat's card on its own; when the
 * person's words say to drop it, it is rejected as the person's decision.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const withdrawProposal = vi.fn();
vi.mock('@/services/proposals/ProposalBudgetService', () => ({
  withdrawProposal,
  proposalBudgetLine: vi.fn(async () => 'open 0/5'),
  isAgentsOwnSchedule: (ctx: { userId?: string | null; conversationId?: number | null; missionRunId?: number | null }) => !ctx.userId || Boolean(ctx.missionRunId) || !ctx.conversationId,
}));
const decide = vi.fn(async () => ({ status: 'rejected' }));
vi.mock('@/services/ReviewService', () => ({ decide, snooze: vi.fn() }));
vi.mock('@/libs/DB', () => ({ db: { select: () => {
  throw new Error('no database in this test');
} } }));
const saidToDecide = vi.fn();
vi.mock('../turnJudge', () => ({ saidToDecide }));

const { withdrawProposalTool } = await import('./withdrawProposal');

const turn = (turnMessage: string) => ({ orgId: 'org', userId: 'usr-qa', agentSlug: 'release-engineer', conversationId: 9, connectorSources: [], turnMessage }) as never;

describe('withdraw_proposal on another seat\'s card', () => {
  beforeEach(() => {
    decide.mockClear();
    saidToDecide.mockReset();
    withdrawProposal.mockResolvedValue({ ok: false, message: 'Proposal #77 is not yours to withdraw.', notOwned: true });
  });

  it('rejects it as the person\'s decision when their words say to drop it', async () => {
    saidToDecide.mockResolvedValue({ said: true, quote: 'drop the incident card' });

    const out = await withdrawProposalTool(turn('drop the incident card')).invoke({ kind: 'proposal', id: 77, reason: 'The outage is already fixed.' });

    expect(out).toContain('Rejected proposal #77');
    expect(out).toContain('as the person\'s decision');
    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: 77 }, 'reject', 'org', expect.objectContaining({ reviewedBy: 'usr-qa', note: 'The outage is already fixed.' }));
  });

  it('leaves it when the person did not say so, and says how their word would decide it', async () => {
    saidToDecide.mockResolvedValue({ said: false, quote: null });

    const out = await withdrawProposalTool(turn('what is that card?')).invoke({ kind: 'proposal', id: 77, reason: 'tidy' });

    expect(out).toContain('not yours to withdraw');
    expect(out).toContain('decide_proposal');
    expect(decide).not.toHaveBeenCalled();
  });

  it('never on an agent\'s own schedule', async () => {
    const mission = { orgId: 'org', userId: 'usr-qa', agentSlug: 'release-engineer', missionRunId: 4, connectorSources: [] } as never;

    const out = await withdrawProposalTool(mission).invoke({ kind: 'proposal', id: 77, reason: 'tidy' });

    expect(out).toContain('not yours');
    expect(decide).not.toHaveBeenCalled();
    expect(saidToDecide).not.toHaveBeenCalled();
  });
});
