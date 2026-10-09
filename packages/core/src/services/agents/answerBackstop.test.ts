import { describe, expect, it } from 'vitest';
import { answerPassSystem, evidenceBlock, owesAnswer, runAnswerBackstop } from './answerBackstop';

const calls = [
  { tool: 'lookup_objects', input: { type: 'request' }, output: 'request #41 Retry uploads — state building\nrequest #40 Roadmap page — state new' },
  { tool: 'list_recent_runs', output: 'run 354 completed send-0011 qa-probe $0.18' },
];

describe('what owes an answer', () => {
  it('a preamble after tool calls owes one; a real answer or a tool-less short reply does not', () => {
    expect(owesAnswer('I\'ll read the records before answering.', calls)).toBe(true);
    expect(owesAnswer('Yes — PR #16 merged on Sunday.', [])).toBe(false);
    expect(owesAnswer('x'.repeat(200), calls)).toBe(false);
  });
});

describe('the pass', () => {
  it('lays the evidence out tool by tool and caps each output', () => {
    const block = evidenceBlock([...calls, { tool: 'search_knowledge', output: 'y'.repeat(6000) }]);

    expect(block).toContain('### lookup_objects {"type":"request"}');
    expect(block).toContain('request #41 Retry uploads');
    expect(block).toContain('…[3500 more characters]');
  });

  it('asks for an answer from the results, in the agent\'s own prompt, with no tools and no guessing', () => {
    const sys = answerPassSystem('You are the PM.', 2);

    expect(sys.startsWith('You are the PM.')).toBe(true);
    expect(sys).toContain('You ran 2 tool steps and ended your turn without answering');
    expect(sys).toContain('Do not call tools');
    expect(sys).toContain('never guess');
  });

  it('appends the composed answer to a stalled turn and leaves an answered turn alone', async () => {
    let seen: { system: string; human: string } | null = null;
    const compose = async (input: { orgId: string; system: string; human: string }) => {
      seen = input;
      return '  Two things are open on Send: #41 is building, #40 is not triaged. Decide #40 first.  ';
    };

    expect(await runAnswerBackstop({ orgId: 'org', request: 'What should I do right now?', finalText: 'I\'ll read the records before answering.', toolCalls: calls, systemPrompt: 'You are the PM.', compose }))
      .toBe('Two things are open on Send: #41 is building, #40 is not triaged. Decide #40 first.');
    expect(seen!.human).toContain('The person said:\nWhat should I do right now?');
    expect(seen!.human).toContain('Your reply so far (do not repeat it):\nI\'ll read the records before answering.');
    expect(seen!.human).toContain('### list_recent_runs');

    seen = null;

    expect(await runAnswerBackstop({ orgId: 'org', request: 'x', finalText: 'A full answer '.repeat(20), toolCalls: calls, compose })).toBeNull();
    expect(seen).toBeNull();
  });

  it('is best-effort: a pass that throws or returns nothing appends nothing', async () => {
    expect(await runAnswerBackstop({ orgId: 'org', request: 'x', finalText: 'I\'ll check.', toolCalls: calls, compose: async () => {
      throw new Error('model down');
    } })).toBeNull();
    expect(await runAnswerBackstop({ orgId: 'org', request: 'x', finalText: 'I\'ll check.', toolCalls: calls, compose: async () => '   ' })).toBeNull();
  });

  it('a turn whose last event was a tool result owes an answer whatever its length', async () => {
    const longButUnanswered = 'I\'ll pull the records on this before answering. I have to correct something: my previous turn said I had read the record, and I had not. Let me actually do the work now, properly, and read every task.';
    let called = 0;
    const compose = async () => {
      called += 1;
      return 'Three of five tasks are blocked on the DNS record for stampsend.com; the other two wait on them.';
    };

    expect(owesAnswer(longButUnanswered, calls, false)).toBe(false);
    expect(owesAnswer(longButUnanswered, calls, true)).toBe(true);
    expect(owesAnswer(longButUnanswered, [], true)).toBe(false);
    expect(await runAnswerBackstop({ orgId: 'org', request: 'What unblocks the rename?', finalText: longButUnanswered, toolCalls: calls, compose, endedOnTool: true })).toContain('DNS record');
    expect(called).toBe(1);
  });

  it('a turn that ran no tool answers from the conversation, never "the context is missing" (conversation 378)', async () => {
    let seen: { system: string; human: string } | null = null;
    const compose = async (input: { system: string; human: string }) => {
      seen = input;
      return 'Plan #215 is already approved; the re-dispatch card #5201 is what unblocks it.';
    };

    await runAnswerBackstop({
      orgId: 'org',
      request: 'write it',
      finalText: '',
      toolCalls: [],
      compose,
      history: [
        { role: 'user', content: 'this is critical, what do we need to unblock and finish?' },
        { role: 'assistant', content: 'Plan #215 was written and approved last night. Re-dispatch #203 with it and it runs.' },
      ],
    });

    expect(seen!.human).toContain('The conversation so far:');
    expect(seen!.human).toContain('Plan #215 was written and approved last night');
    expect(seen!.human).toContain('no tool ran this turn');
    expect(seen!.system).toContain('never say the context is missing');
    expect(seen!.system).not.toContain('You ran 0 tool steps');
  });
});

describe('the answer pass continues the real conversation (conversation 384)', () => {
  it('reads the graph\'s messages instead of pasted evidence, and hands back a card it calls', async () => {
    const { runAnswerBackstop } = await import('./answerBackstop');
    const messages = [
      { role: 'user', content: 'Add branded share links to Northwind' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'read_wiki_page', args: { slug: 'northwind-capabilities' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '# Northwind capabilities\n- Share links (UUID)' },
    ];
    const seen: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const answer = await runAnswerBackstop({
      orgId: 'org_answer_pass',
      request: 'Add branded share links to Northwind',
      finalText: 'Let me read the capabilities page.',
      toolCalls: [{ tool: 'read_wiki_page', input: { slug: 'northwind-capabilities' }, output: '# Northwind capabilities' }],
      endedOnTool: true,
      messages,
      tools: [{ name: 'recommend_action' } as never],
      onToolCall: async (call) => {
        calls.push(call.name);
      },
      compose: async (input) => {
        seen.push(input as unknown as Record<string, unknown>);
        await input.onToolCall?.({ id: 'c2', name: 'recommend_action', args: { action_id: 'factory.dispatch_task', label: 'Build branded links', action_input: { requestId: 88 } } });
        return 'Branded links are not built; the Build card is below.';
      },
    });

    expect(answer).toContain('not built');
    expect(seen[0]!.messages).toBe(messages);
    expect(String(seen[0]!.human)).not.toContain('What you already did and found');
    expect(calls).toEqual(['recommend_action']);
  });
});

describe('the source check', () => {
  const answer = 'Jamie Smith at Contoso wants pricing for 40 seats by Friday [1]. Their budget is $80,000. Pat Lee asked for a call next week [2].';
  const sources = [
    { n: 1, title: 'Pricing for the managed service', source: 'gmail', snippet: 'Could you send pricing for 40 seats? We decide Friday.' },
    { n: 2, title: 'Re: Agents for your field team', source: 'gmail', snippet: 'Interesting. Could we talk next week?' },
  ];

  it('reads the answer against the snippets it cited', async () => {
    const { groundingPrompt } = await import('./answerBackstop');
    const prompt = groundingPrompt(answer, sources);

    expect(prompt).toContain('[1] Pricing for the managed service (gmail) — Could you send pricing for 40 seats?');
    expect(prompt).toContain('ANSWER:\nJamie Smith');
  });

  it('keeps only flags whose quote is in the answer, typed', async () => {
    const { parseGroundingFlags } = await import('./answerBackstop');
    const flags = parseGroundingFlags(JSON.stringify({ flags: [
      { quote: 'Their budget is $80,000', kind: 'amount', issue: 'unsupported' },
      { quote: 'They signed last week', kind: 'date', issue: 'unsupported' },
      { quote: 'Pat Lee asked for a call next week', kind: 'weird', issue: 'uncited' },
    ] }), answer);

    expect(flags).toEqual([
      { quote: 'Their budget is $80,000', kind: 'amount', issue: 'unsupported' },
      { quote: 'Pat Lee asked for a call next week', kind: 'other', issue: 'uncited' },
    ]);
    expect(parseGroundingFlags('not json', answer)).toEqual([]);
  });

  it('marks rather than rewrites, and never fails the turn', async () => {
    const { checkGrounding, groundingStep } = await import('./answerBackstop');
    const checked = await checkGrounding({ orgId: 'org-grounding', answer, sources, model: async () => ({ text: '{"flags":[{"quote":"Their budget is $80,000","kind":"amount","issue":"unsupported"}]}' }) });

    expect(checked).toMatchObject({ ran: true, flags: [{ quote: 'Their budget is $80,000' }] });

    const step = groundingStep(checked.flags);

    expect(step.label).toBe('Checked the answer against its sources');
    expect(step.detail).toBe('1 unverified');
    expect(step.resultDetail).toContain('not in the sources');

    const broken = await checkGrounding({ orgId: 'org-grounding', answer, sources, model: async () => {
      throw new Error('no key');
    } });

    expect(broken).toMatchObject({ ran: false, flags: [] });
  });
});
