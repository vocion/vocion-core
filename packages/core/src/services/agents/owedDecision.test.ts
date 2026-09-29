import { describe, expect, it, vi } from 'vitest';
import { decidedInTurn, decideOwed, describeOpenDecisions, mergeDecisions, pendingCards } from './owedDecision';

/** Reply 1050 on conversation 378, as stored. */
const REPLY_1050 = 'Doing it in that order — the acceptance line goes on first, because approving the dispatch freezes the acceptance.\n\nThe run failed because the contract touches two packages without an approved plan.\n\n**What needs to happen:** I write the architecture plan, you approve it, then the task re-runs with the plan id on the contract.\n\nLet me write the plan now.';

describe('open decisions', () => {
  it('reads the cards still waiting in the replay, not the ones that ran', () => {
    const history = [
      { role: 'user', content: 'x' },
      { role: 'assistant', runs: [
        { type: 'card', runId: 5201, label: 'Re-dispatch #203 with plan #215', actionId: 'factory.dispatch_task', status: 'pending' },
        { type: 'card', runId: 5100, label: 'Old build', actionId: 'factory.dispatch_task', status: 'done' },
        { type: 'card', label: 'Unfiled', state: 'unfiled' },
      ] },
    ];

    expect(pendingCards(history)).toEqual([{ kind: 'proposal', id: 5201, title: 'Re-dispatch #203 with plan #215', actionId: 'factory.dispatch_task' }]);
  });

  it('merges the page record\'s and the thread\'s, each once, and names the call that decides each', () => {
    const merged = mergeDecisions(
      [{ kind: 'proposal', id: 5201, title: 'factory.dispatch_task: re-dispatch', actionId: 'factory.dispatch_task' }, { kind: 'ask', id: 221, title: 'Stopped: Document detail page', options: [] }],
      [{ kind: 'proposal', id: 5201, title: 'Re-dispatch #203', actionId: 'factory.dispatch_task' }],
    );

    expect(merged.map(d => `${d.kind}#${d.id}`)).toEqual(['proposal#5201', 'ask#221']);
    expect(describeOpenDecisions(merged)).toContain('decide_proposal id 5201');
    expect(describeOpenDecisions(merged)).toContain('decide_ask id 221');
  });

  it('a decision counts only when the tool took it, not when it refused', () => {
    expect(decidedInTurn([{ tool: 'decide_proposal', output: 'Approved proposal #5201 (approved).' }])).toBe(true);
    expect(decidedInTurn([{ tool: 'decide_proposal', output: 'Refused: the person has not said to approve' }])).toBe(false);
    expect(decidedInTurn([{ tool: 'read_object', output: '{}' }])).toBe(false);
  });
});

describe('decideOwed — the pass that carries the decision out', () => {
  const fakeTool = (name: string, answer: (args: Record<string, unknown>) => string) => ({ name, invoke: vi.fn(async (call: { args: Record<string, unknown> }) => answer(call.args)) });

  it('makes the change first, then decides, with a call required on the first step', async () => {
    const update = fakeTool('update_object', () => 'engineering task #203 updated — acceptance written (run #9001).');
    const decide = fakeTool('decide_proposal', args => `Approved proposal #${args.id} (approved). The card updates on its own; do not restate what it shows.`);
    const binds: unknown[] = [];
    const replies = [
      { tool_calls: [{ id: 'a', name: 'update_object', args: { object_type: 'engineering_task', id: 203, set: { acceptanceContract: ['…'] } } }] },
      { tool_calls: [{ id: 'b', name: 'decide_proposal', args: { id: 5201, decision: 'approve', note: 'approve, fix and run' } }] },
      { tool_calls: [] },
    ];
    const model = { bindTools: (_tools: unknown[], opts?: unknown) => {
      binds.push(opts);
      return { invoke: async () => replies.shift() as never };
    } };

    const out = await decideOwed({
      request: 'approve, fix and run',
      history: [{ role: 'assistant', content: 'Want me to add the share-path line before you approve?' }],
      answer: REPLY_1050,
      decisions: [{ kind: 'proposal', id: 5201, title: 'Re-dispatch #203', actionId: 'factory.dispatch_task' }],
      tools: [update, decide] as never,
      model: model as never,
    });

    expect(out.calls.map(c => c.tool)).toEqual(['update_object', 'decide_proposal']);
    expect(out.lines).toEqual(['Approved proposal #5201 (approved).']);
    expect(binds[0]).toEqual({ tool_choice: 'any' });
    expect(binds[1]).toBeUndefined();
  });

  it('does nothing with nothing waiting, and reports a refusal as no decision', async () => {
    const decide = fakeTool('decide_proposal', () => 'Refused: the person has not said to approve proposal #1 in their message.');
    const model = { bindTools: () => ({ invoke: async () => ({ tool_calls: [{ id: 'a', name: 'decide_proposal', args: { id: 1, decision: 'approve' } }] }) as never }) };

    expect(await decideOwed({ request: 'approve', history: [], answer: '', decisions: [], tools: [decide] as never, model: model as never })).toEqual({ calls: [], lines: [] });

    const refused = await decideOwed({ request: 'approve', history: [], answer: '', decisions: [{ kind: 'proposal', id: 1, title: 'x' }], tools: [decide] as never, model: model as never });

    expect(refused.lines).toEqual([]);
    expect(decidedInTurn(refused.calls)).toBe(false);
    expect(refused.calls.length).toBeLessThanOrEqual(3);
  });
});
