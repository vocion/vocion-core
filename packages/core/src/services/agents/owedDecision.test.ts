import { describe, expect, it, vi } from 'vitest';
import { announcedAction, asksForAction, decidedInTurn, decideOwed, decisionNamed, describeOpenDecisions, mergeDecisions, pendingCards, personSaid, personSaidRecently } from './owedDecision';

/** Reply 1050 on conversation 378, as stored. */
const REPLY_1050 = 'Doing it in that order — the acceptance line goes on first, because approving the dispatch freezes the acceptance.\n\nThe run failed because the contract touches two packages without an approved plan.\n\n**What needs to happen:** I write the architecture plan, you approve it, then the task re-runs with the plan id on the contract.\n\nLet me write the plan now.';

describe('asksForAction — the person told the agent to do something', () => {
  it.each([
    'approve, fix and run',
    'write it',
    'Yes',
    'ok, go ahead',
    'please dispatch it',
    'Approve the first one.',
    'Great. Now add the share-path line and run it',
  ])('"%s" is an instruction', (m) => {
    expect(asksForAction(m)).toBe(true);
  });

  it.each([
    'this is critical, what do we need to unblock and finish?',
    'should I approve it?',
    'don\'t run it yet',
    'How do I approve a plan',
    'The plan looks thin to me.',
    '',
  ])('"%s" is not', (m) => {
    expect(asksForAction(m)).toBe(false);
  });

  it('reads the person\'s words, not the page context under them', () => {
    expect(asksForAction('why is it stuck?\n\n--- where I am ---\nApprove to build again')).toBe(false);
    expect(asksForAction('approve it\n\n--- where I am ---\nI am looking at request #201')).toBe(true);
  });
});

describe('announcedAction — the turn ended on the move instead of making it', () => {
  it('finds reply 1050\'s last sentence', () => {
    expect(announcedAction(REPLY_1050)).toBe('Let me write the plan now.');
  });

  it.each([
    'I\'ll put the card up now.',
    'Next I\'ll dispatch #203 with plan #215.',
    '**Putting the re-dispatch card up now.**',
    'I am going to approve proposal #5201.',
  ])('"%s" is an announcement', (t) => {
    expect(announcedAction(`Here is what happened.\n\n${t}`)).not.toBeNull();
  });

  it.each([
    'Approved proposal #5201; the build is running.',
    'Let me know if you want the share-path line too.',
    'Want me to add the acceptance line first?',
    'I\'ll come straight back if the clone fails.',
    'If it fails on clone, I\'ll report back.',
  ])('"%s" is not', (t) => {
    expect(announcedAction(`Here is what happened.\n\n${t}`)).toBeNull();
  });
});

describe('personSaid — the gate on a decision taken for the person', () => {
  it('approve, reject and defer need their own words', () => {
    expect(personSaid('approve, fix and run', 'approve')).toBe(true);
    expect(personSaid('approve, fix and run', 'reject')).toBe(false);
    expect(personSaid('leave it stopped', 'reject')).toBe(true);
    expect(personSaid('defer the rename a week', 'defer')).toBe(true);
    expect(personSaid('what does this card do?', 'approve')).toBe(false);
  });

  it('a refused verb is not the verb', () => {
    expect(personSaid('don\'t approve it yet', 'approve')).toBe(false);
    expect(personSaid('should I approve it?', 'approve')).toBe(false);
  });

  it('an option is said by its label, its id, or a go-ahead when it is the recommended one', () => {
    expect(personSaid('restore paths, then run it', 'restore-paths', { label: 'Restore paths' })).toBe(true);
    expect(personSaid('yes', 'restore-paths', { label: 'Restore paths', recommended: true })).toBe(true);
    expect(personSaid('yes', 'restore-paths', { label: 'Restore paths' })).toBe(false);
  });

  it('a bare "write it" carries the instruction the last turn left undone — one message back, never further', () => {
    expect(personSaidRecently(['write it', 'approve, fix and run'], 'approve')).toBe(true);
    expect(personSaidRecently(['what is this?', 'approve, fix and run'], 'approve')).toBe(false);
    expect(personSaidRecently(['no, leave it', 'approve'], 'approve')).toBe(false);
    expect(personSaidRecently(['write it'], 'approve')).toBe(false);
  });

  it('names the decision the words take', () => {
    expect(decisionNamed('approve, fix and run')).toBe('approve');
    expect(decisionNamed('write it')).toBeNull();
    expect(decisionNamed('reject the admin panel')).toBe('reject');
  });
});

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
