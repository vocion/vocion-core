/**
 * request_human_review is a Decision like any other: in a person's own
 * conversation it is the gate the chat route docks as an approval (and the
 * turn ends at it); with nobody here it waits on Needs you, filed through
 * file_ask's own path. Never "approve" or "reject" put in anyone's mouth.
 * Fixtures are fictional (Kestrel Capital).
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

const fileAsk = vi.fn(async (_input: unknown) => 'Ask #9 filed (gate). It is on Needs you.');
vi.mock('./fileAsk', () => ({ fileAskTool: () => ({ invoke: (input: unknown) => fileAsk(input) }) }));
vi.mock('@/services/proposals/ProposalBudgetService', () => ({ isAgentsOwnSchedule: (ctx: { missionRunId?: number; conversationId?: number }) => Boolean(ctx.missionRunId) || !ctx.conversationId }));

const { requestHumanReviewTool } = await import('./hitl');

function ctx(over: Partial<RuntimeContext> = {}): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return { orgId: 'org_hitl', userId: 'usr-dana', conversationId: 392, agentSlug: 'revenue-lead', emit: (e: AgentEvent) => events.push(e), events, ...over } as RuntimeContext & { events: AgentEvent[] };
}

describe('request_human_review', () => {
  it('in a person\'s conversation, raises the gate the chat docks as an approval — and says the turn ends there', async () => {
    const c = ctx();
    const out = await requestHumanReviewTool(c).invoke({ name: 'send-followup', question: 'Send this follow-up to Kestrel Capital?', payload: { to: 'ops@kestrel.example' } });

    expect(c.events).toEqual([{ type: 'hitl_gate', gate: { name: 'send-followup', question: 'Send this follow-up to Kestrel Capital?', payload: { to: 'ops@kestrel.example' }, resumeUrl: undefined } }]);
    expect(out).toContain('docked above their composer');
    expect(out).toContain('Your turn ends here');
    expect(out).not.toContain('"approve"');
    expect(fileAsk).not.toHaveBeenCalled();
  });

  it('with nobody here (a mission), files a gate ask on Needs you instead', async () => {
    const c = ctx({ missionRunId: 41, conversationId: undefined });
    const out = await requestHumanReviewTool(c).invoke({ name: 'publish-deck', question: 'Publish the Kestrel Capital deck?', resumeUrl: 'https://decks.example/kestrel' });

    expect(c.events).toEqual([]);
    expect(fileAsk).toHaveBeenCalledWith(expect.objectContaining({ title: 'Publish the Kestrel Capital deck?', kind: 'gate', context_url: 'https://decks.example/kestrel', options: [expect.objectContaining({ id: 'approve' }), expect.objectContaining({ id: 'reject' })] }));
    expect(out).toContain('Needs you');
  });
});
