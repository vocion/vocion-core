/**
 * A proposal that waits on a person, filed during their conversation, is a
 * card there with Approve on it — the same run the review queue holds
 * (Jamie, 2026-10-07: "anything I needed to approve should've gotten served
 * as action items in chat"). Outside a conversation nothing is drawn.
 */
import type { AgentEvent } from '../types';
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('../turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('../turnJudge')>();
  return { ...real, saidToDecide: vi.fn(async () => ({ said: false, quote: null })) };
});
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 77, status: 'pending', outcome: 'created' })),
}));

const { proposeAction } = await import('@/services/ActionService');
const { runProposal } = await import('./proposeAction');

const filing = {
  actionId: 'objects.propose_candidate',
  input: { objectType: 'repo', title: 'northwind/send-api', fields: { url: 'https://github.example/northwind/send-api' }, dedupOn: ['slug'] },
  confidence: 0.85,
  rationale: 'The person named this repository.',
  suggestedDecision: 'approve' as const,
  suggestedDecisionReason: 'They asked for it.',
};

function ctxWith(events: AgentEvent[], conversationId?: number): RuntimeContext {
  return { orgId: 'org_pending_card', userId: 'usr-jamie', agentSlug: 'product-manager', conversationId, connectorSources: [], objectTypeSlugs: ['repo'], turnMessage: 'include send-api', emit: (e: AgentEvent) => events.push(e) } as unknown as RuntimeContext;
}

describe('a proposal that waits on a person', () => {
  beforeEach(() => {
    vi.mocked(proposeAction).mockClear();
  });

  it('is a card in the conversation it was filed from: the run, Approve, and the agent\'s reasons', async () => {
    const events: AgentEvent[] = [];

    const out = await runProposal(ctxWith(events, 42), filing, { tool: 'file_repo' });

    const card = events.find(e => e.type === 'card') as Extract<AgentEvent, { type: 'card' }> | undefined;
    expect(card).toBeDefined();
    expect(card!.card).toMatchObject({
      kind: 'action',
      title: 'Propose candidate: northwind/send-api',
      runId: 77,
      state: 'filed',
      rationale: 'The person named this repository.',
      confidence: 0.85,
      suggestedDecision: 'approve',
      source: { agentSlug: 'product-manager', tool: 'file_repo' },
    });
    expect(card!.card.actions[0]).toMatchObject({ label: 'Approve', actionId: 'objects.propose_candidate', input: { objectType: 'repo' } });
    expect(out).toContain('as a card in this conversation');
    expect(out).not.toContain('open the review queue page');
  });

  it('draws nothing outside a conversation (a mission run): the queue is where it waits', async () => {
    const events: AgentEvent[] = [];

    const out = await runProposal(ctxWith(events, undefined), filing, { tool: 'file_repo' });

    expect(events.some(e => e.type === 'card')).toBe(false);
    expect(out).toContain('PENDING human approval in the review queue');
  });
});
