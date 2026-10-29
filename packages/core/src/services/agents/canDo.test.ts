import { describe, expect, it, vi } from 'vitest';
import { CAN_DO_RULE, canDoNudge, failedStepsLine, worthCheckingCanDo } from './canDo';

vi.mock('@/services/budget/chargeModelCall', () => ({ chargeModelCall: vi.fn(async () => undefined) }));

const { readUnableClaim } = await import('./turnJudge');

/**
 * A model bound to the one report tool, answering with these fields.
 * @param args - The fields it reports.
 */
function modelSaying(args: Record<string, unknown>) {
  return {
    bindTools: (tools: Array<{ name: string }>) => ({ invoke: async () => ({ tool_calls: [{ name: tools[0]!.name, args }] }) }),
  } as never;
}

const ACTIONS = [{ id: 'hubspot.update', line: 'Update a HubSpot record.' }, { id: 'gmail.send', line: 'Send an email.' }];
const turn = { personTurn: true, refused: false, handedOff: false, writes: 0, asks: 'change', reply: 'I can\'t execute the CRM update directly in this session.', already: false };

describe('can before can\'t (a HubSpot deal update, 2026-10-28)', () => {
  it('reads a person\'s act-turn that wrote nothing and said something', () => {
    expect(worthCheckingCanDo(turn)).toBe(true);
    expect(worthCheckingCanDo({ ...turn, asks: 'answer' })).toBe(false);
    expect(worthCheckingCanDo({ ...turn, writes: 1 })).toBe(false);
    expect(worthCheckingCanDo({ ...turn, handedOff: true })).toBe(false);
    expect(worthCheckingCanDo({ ...turn, already: true })).toBe(false);
    expect(worthCheckingCanDo({ ...turn, personTurn: false })).toBe(false);
  });

  it('takes the model\'s reading, and only an action the turn has', async () => {
    expect(await readUnableClaim({ orgId: 'org_judge', message: 'Move Northwind renewal to contract sent', reply: turn.reply, actions: ACTIONS }, modelSaying({ claims_unable: true, action_id: 'hubspot.update' }))).toEqual({ claims_unable: true, action_id: 'hubspot.update' });
    expect(await readUnableClaim({ orgId: 'org_judge', message: 'x', reply: turn.reply, actions: ACTIONS }, modelSaying({ claims_unable: true, action_id: 'made.up' }))).toEqual({ claims_unable: true, action_id: null });
    expect(await readUnableClaim({ orgId: 'org_judge', message: 'x', reply: '', actions: ACTIONS }, modelSaying({ claims_unable: true, action_id: 'hubspot.update' }))).toEqual({ claims_unable: false, action_id: null });
  });

  it('nudges with the action and the steps that failed, never "I can\'t"', () => {
    const nudge = canDoNudge('hubspot.update', [{ tool: 'mcp_call', message: 'tool not found: hubspot_update_deal' }, { tool: 'mcp_call', message: 'tool not found: hubspot_update_deal' }]);

    expect(nudge).toContain('propose_action (action_id "hubspot.update")');
    expect(nudge).toContain('- mcp_call: tool not found: hubspot_update_deal');
    expect(failedStepsLine([{ tool: 'a', message: 'x' }, { tool: 'a', message: 'x' }]).split('\n')).toHaveLength(1);
    expect(CAN_DO_RULE).toMatch(/tool search/);
  });
});
