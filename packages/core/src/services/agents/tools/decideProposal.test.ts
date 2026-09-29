import { beforeEach, describe, expect, it, vi } from 'vitest';

const decide = vi.fn(async () => ({ status: 'approved' }));
const snooze = vi.fn(async () => undefined);
vi.mock('@/services/ReviewService', () => ({ decide, snooze }));
// No database in this test: the gate reads `ctx.turnMessage`.
vi.mock('@/libs/DB', () => ({ db: { select: () => {
  throw new Error('no database in this test');
} } }));

// Whether the person said to take a decision is a model's reading of their
// words (`turnJudge.saidToDecide`); here, what that reading is for each case.
const CONSENTS: Record<string, string[]> = {
  'approve the first one, and defer the second': ['approve proposal #41', 'defer proposal #42'],
  'approve it': ['approve proposal #43'],
};
vi.mock('../turnJudge', () => ({
  saidToDecide: vi.fn(async ({ messages, decision }: { messages: string[]; decision: string }) => ({ said: (CONSENTS[messages[0] ?? ''] ?? []).includes(decision), quote: null })),
}));

const { decideProposalTool } = await import('./decideProposal');

const said = (turnMessage: string) => ({ orgId: 'org', userId: 'usr-1', conversationId: 7, connectorSources: [], turnMessage }) as never;
const person = said('approve the first one, and defer the second');

describe('decide_proposal', () => {
  beforeEach(() => {
    decide.mockClear();
    snooze.mockClear();
  });

  it('approves and rejects on the person\'s behalf, naming who decided', async () => {
    const out = await decideProposalTool(person).invoke({ id: 41, decision: 'approve', note: 'yes, cheapest first' });

    expect(out).toContain('Approved proposal #41');
    expect(decide).toHaveBeenCalledWith({ kind: 'action', id: 41 }, 'approve', 'org', expect.objectContaining({ reviewedBy: 'usr-1', note: 'yes, cheapest first' }));
  });

  it('defers through the review queue\'s own snooze, a week out', async () => {
    const out = await decideProposalTool(person).invoke({ id: 42, decision: 'defer' });

    expect(out).toContain('Deferred proposal #42 until');
    expect(snooze).toHaveBeenCalledWith('org', { kind: 'action', id: 42 }, expect.any(Date), 'usr-1', { note: 'Deferred from chat' });
  });

  it('refuses a decision the person did not say in their message (conversation 378: the gate is their words)', async () => {
    expect(await decideProposalTool(said('what does this card do?')).invoke({ id: 43, decision: 'approve' })).toMatch(/^Refused: the person has not said to approve proposal #43/);
    expect(await decideProposalTool(said('don\'t approve it yet')).invoke({ id: 43, decision: 'approve' })).toMatch(/^Refused/);
    expect(await decideProposalTool(said('approve it')).invoke({ id: 43, decision: 'reject' })).toMatch(/^Refused/);
    expect(decide).not.toHaveBeenCalled();
  });

  it('a workspace token is the person\'s own client acting, with no message to read', async () => {
    const token = { orgId: 'org', userId: 'token:abc', connectorSources: [] } as never;

    expect(await decideProposalTool(token).invoke({ id: 44, decision: 'approve' })).toContain('Approved proposal #44');
  });

  it('refuses on an agent\'s own schedule — an agent never approves its own proposals', async () => {
    const mission = { orgId: 'org', userId: 'usr-1', missionRunId: 3, connectorSources: [] } as never;
    const nobody = { orgId: 'org', conversationId: 7, connectorSources: [] } as never;

    expect(await decideProposalTool(mission).invoke({ id: 1, decision: 'approve' })).toContain('Refused');
    expect(await decideProposalTool(nobody).invoke({ id: 1, decision: 'reject' })).toContain('Refused');
    expect(decide).not.toHaveBeenCalled();
  });
});
