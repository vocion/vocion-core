import { beforeEach, describe, expect, it, vi } from 'vitest';
import { produceTranscripts } from './transcripts';

/**
 * The agent, faked.
 *
 * No test in this repo had mocked `runAgentDeep` before, so this is the first.
 * It exists because trajectory capture is the one piece of this feature that
 * cannot be checked by a pure function test: the ordered tool calls are
 * produced inside the per-case loop, and the bug worth catching is them being
 * dropped on the way out of it.
 */
const runAgentDeep = vi.hoisted(() => vi.fn());

vi.mock('../AgentService', () => ({ runAgentDeep }));

function agentResult(toolNames: string[], response = 'done') {
  return {
    response,
    traceId: 'trace-1',
    toolCalls: toolNames.map(tool => ({ tool, input: { a: 1 }, output: 'ok' })),
    usage: { model: 'm', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cents: 1, turns: 2 },
  };
}

describe('produceTranscripts', () => {
  beforeEach(() => {
    runAgentDeep.mockReset();
  });

  it('captures the tool calls in the order the agent made them', async () => {
    // The whole point. Before the split, only `toolCalls.length` escaped the
    // try block, which cannot tell "looked up the order then refunded" from
    // "refunded then looked up" — and that distinction is exactly what
    // AgentCore's trajectory evaluators score.
    runAgentDeep.mockResolvedValue(agentResult(['lookup_order', 'check_policy', 'issue_refund']));

    const [transcript] = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'refund 4471' }],
    });

    expect(transcript?.trajectory).toEqual(['lookup_order', 'check_policy', 'issue_refund']);
  });

  it('does not treat a reversed sequence as the same trajectory', async () => {
    runAgentDeep.mockResolvedValue(agentResult(['issue_refund', 'lookup_order']));

    const [transcript] = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'refund 4471' }],
    });

    expect(transcript?.trajectory).not.toEqual(['lookup_order', 'issue_refund']);
  });

  it('records an empty trajectory when the agent run throws', async () => {
    // The errored path used to leave the variable undefined. A transcript
    // whose trajectory is undefined crashes every consumer downstream, so the
    // empty value has to be defined rather than merely absent.
    runAgentDeep.mockRejectedValue(new Error('model unavailable'));

    const [transcript] = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'refund 4471' }],
    });

    expect(transcript?.errored).toBe(true);
    expect(transcript?.trajectory).toEqual([]);
    expect(transcript?.errorMessage).toBe('model unavailable');
  });

  it('keeps running the rest of the dataset after one case throws', async () => {
    // A run where 2 of 3 cases passed and one blew up is a useful result.
    // Losing it because of the one failure teaches nobody anything.
    runAgentDeep
      .mockResolvedValueOnce(agentResult(['a']))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(agentResult(['c']));

    const transcripts = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'one' }, { input: 'two' }, { input: 'three' }],
      concurrency: 1,
    });

    expect(transcripts).toHaveLength(3);
    expect(transcripts.map(t => t.errored)).toEqual([false, true, false]);
  });

  it('keeps each transcript against its own case when run concurrently', async () => {
    // Concurrency is the point of the rewrite, and filing a score against the
    // wrong test case is the way it silently goes wrong.
    runAgentDeep.mockImplementation(async (opts: { message: string }) => {
      const delay = opts.message === 'slow' ? 20 : 1;
      await new Promise(resolve => setTimeout(resolve, delay));
      return agentResult([`tool-for-${opts.message}`], opts.message);
    });

    const transcripts = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'slow' }, { input: 'fast' }],
      concurrency: 2,
    });

    expect(transcripts[0]?.itemIndex).toBe(0);
    expect(transcripts[0]?.output).toBe('slow');
    expect(transcripts[1]?.output).toBe('fast');
  });

  it('counts tool calls in the usage record it stores', async () => {
    runAgentDeep.mockResolvedValue(agentResult(['a', 'b']));

    const [transcript] = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'x' }],
    });

    expect(transcript?.usage?.toolCalls).toBe(2);
  });

  it('handles an agent that reports no tool calls at all', async () => {
    runAgentDeep.mockResolvedValue({ response: 'hi', traceId: '', toolCalls: undefined, usage: null });

    const [transcript] = await produceTranscripts({
      orgId: 'org_1',
      agentSlug: 'support',
      datasetSlug: 'refund-quality',
      items: [{ input: 'x' }],
    });

    expect(transcript?.trajectory).toEqual([]);
    expect(transcript?.errored).toBe(false);
  });
});
