/**
 * The agent step's logic against a stand-in for the agent (`AgentTurn`): the
 * message it sends, the result it reads, the shape check and its one retry.
 */
import type { AgentTurn, AgentTurnRequest, AgentTurnResult } from './agentRunner';
import type { AgentWorkflowStep } from '@/libs/workspace/schemas';
import { describe, expect, it, vi } from 'vitest';
import { AgentStepError, agentStepMessage, extractResult, runAgentStep, shapeProblem } from './agentStep';

const output = { type: 'object', required: ['verdict', 'findings'], properties: { verdict: { enum: ['pass', 'revise'] }, findings: { type: 'array', items: { type: 'string' } } } };

const step: AgentWorkflowStep = {
  name: 'review',
  type: 'agent',
  agent: 'seo-editor',
  task: 'Review draft 7.',
  output,
  effort: 'standard',
  tools: ['read_artifact'],
};

/**
 * A turn that answers with each reply in order.
 * @param replies - What the agent says, turn by turn.
 */
function scripted(...replies: Array<Partial<AgentTurnResult> & { text: string }>): AgentTurn & { calls: AgentTurnRequest[] } {
  const calls: AgentTurnRequest[] = [];
  const fn = vi.fn(async (req: AgentTurnRequest) => {
    calls.push(req);
    const r = replies[calls.length - 1];
    if (!r) {
      throw new Error('no more replies');
    }
    return { traceId: `trace-${calls.length}`, toolCalls: 2, model: 'claude-sonnet-4-6', effort: 'standard', microCents: 1_000_000, ...r };
  });
  return Object.assign(fn, { calls });
}

const run = (turn: AgentTurn, s: AgentWorkflowStep = step) => runAgentStep({
  orgId: 'org_northwind',
  runId: 12,
  workflow: { slug: 'seo-page', name: 'Write one page' },
  runLabel: 'SB-512 · page 2 of 3',
  stepLabel: 'Editor review · round 1 of 3',
  step: s,
  task: s.task,
  turn,
});

describe('runAgentStep', () => {
  it('returns the validated result and records the turn', async () => {
    const turn = scripted({ text: 'Read it.\n\n```json\n{"verdict":"pass","findings":[]}\n```' });
    const record = await run(turn);

    expect(record.output).toEqual({ verdict: 'pass', findings: [] });
    expect(record).toMatchObject({ agent: 'seo-editor', model: 'claude-sonnet-4-6', effort: 'standard', microCents: 1_000_000, toolCalls: 2 });
    expect(record.attempts).toEqual([expect.objectContaining({ traceId: 'trace-1', ok: true })]);
    // The turn runs as the run, on the step's effort and tools.
    expect(turn.calls[0]).toMatchObject({ orgId: 'org_northwind', agentSlug: 'seo-editor', runId: 12, userId: 'workflow:seo-page:12', effort: 'standard', toolAllowlist: ['read_artifact'] });
    expect(turn.calls[0]!.message).toContain('Review draft 7.');
    expect(turn.calls[0]!.message).toContain('"verdict"');
    expect(turn.calls[0]!.message).toContain('SB-512 · page 2 of 3');
  });

  it('reads the result after the last tool call first', async () => {
    const record = await run(scripted({ text: 'Earlier {"verdict":"revise","findings":["x"]} then more', lastAnswer: '{"verdict":"pass","findings":[]}' }));

    expect(record.output).toEqual({ verdict: 'pass', findings: [] });
  });

  it('retries once on a bad shape, telling the agent exactly what failed', async () => {
    const turn = scripted(
      { text: '```json\n{"verdict":"maybe"}\n```' },
      { text: '```json\n{"verdict":"revise","findings":["Thin intro"]}\n```' },
    );
    const record = await run(turn);

    expect(record.output).toEqual({ verdict: 'revise', findings: ['Thin intro'] });
    expect(record.attempts.map(a => a.ok)).toEqual([false, true]);
    expect(record.attempts[0]!.problem).toMatch(/findings|verdict/);
    expect(record.microCents).toBe(2_000_000);
    // The correction carries the first turn and names the problem.
    expect(turn.calls[1]!.message).toContain('did not match');
    expect(turn.calls[1]!.message).toContain(record.attempts[0]!.problem!);
    expect(turn.calls[1]!.history).toEqual([{ role: 'user', content: turn.calls[0]!.message }, { role: 'assistant', content: '```json\n{"verdict":"maybe"}\n```' }]);
  });

  it('fails with the reason and the record after a second bad shape', async () => {
    const turn = scripted({ text: 'I could not finish.' }, { text: 'Still prose.' });
    const err = await run(turn).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AgentStepError);
    expect((err as AgentStepError).message).toMatch(/after 2 tries: no JSON object/);
    expect((err as AgentStepError).record.attempts).toHaveLength(2);
    expect(turn.calls).toHaveLength(2);
  });

  it('without an output schema, the reply is the output and nothing is validated', async () => {
    const turn = scripted({ text: 'Revised the draft.', lastAnswer: 'Revised the draft; v3 saved.' });
    const { output: _o, ...plain } = step;
    const record = await run(turn, { ...plain, effort: undefined, tools: undefined });

    expect(record.output).toBe('Revised the draft; v3 saved.');
    expect(turn.calls[0]).toMatchObject({ effort: 'auto' });
    expect(turn.calls[0]!.toolAllowlist).toBeUndefined();
    expect(turn.calls[0]!.message).not.toContain('JSON Schema');
  });
});

describe('extractResult', () => {
  it('takes the last fenced block that parses', () => {
    expect(extractResult('```json\n{"a":1}\n```\nthen\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractResult('```json\n{"a":1}\n```\n```\nnot json\n```')).toEqual({ a: 1 });
  });

  it('takes the whole reply, or the last object in prose', () => {
    expect(extractResult(' {"a":1} ')).toEqual({ a: 1 });
    expect(extractResult('Done. Result: {"a":{"b":2}} — thanks')).toEqual({ a: { b: 2 } });
    expect(extractResult('nothing here')).toBeNull();
  });
});

describe('shapeProblem', () => {
  it('names each problem by path', async () => {
    expect(await shapeProblem(output, { verdict: 'pass', findings: [] })).toBeNull();
    expect(await shapeProblem(output, { verdict: 'pass', findings: [3] })).toMatch(/\/findings\/0 must be string/);
    expect(await shapeProblem(output, null)).toMatch(/no JSON object/);
  });
});

describe('agentStepMessage', () => {
  it('says where the task sits and asks for the shape only when there is one', () => {
    const m = agentStepMessage({ task: 'Write it.', workflowName: 'Write one page', stepLabel: 'Writing the draft', output: { type: 'object' } });

    expect(m.startsWith('Write it.')).toBe(true);
    expect(m).toContain('"Writing the draft" of the workflow "Write one page"');
    expect(m).toContain('```json');
  });
});
