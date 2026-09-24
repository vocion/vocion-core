import { beforeEach, describe, expect, it, vi } from 'vitest';

const decide = vi.fn(async () => ({ status: 'approved' }));
const snooze = vi.fn(async () => undefined);
vi.mock('@/services/ReviewService', () => ({ decide, snooze }));

const { decideProposalTool } = await import('./decideProposal');

const person = { orgId: 'org', userId: 'usr-1', conversationId: 7, connectorSources: [] } as never;

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

  it('refuses on an agent\'s own schedule — an agent never approves its own proposals', async () => {
    const mission = { orgId: 'org', userId: 'usr-1', missionRunId: 3, connectorSources: [] } as never;
    const nobody = { orgId: 'org', conversationId: 7, connectorSources: [] } as never;

    expect(await decideProposalTool(mission).invoke({ id: 1, decision: 'approve' })).toContain('Refused');
    expect(await decideProposalTool(nobody).invoke({ id: 1, decision: 'reject' })).toContain('Refused');
    expect(decide).not.toHaveBeenCalled();
  });
});
