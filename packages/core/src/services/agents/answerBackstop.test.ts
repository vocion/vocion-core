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
});
