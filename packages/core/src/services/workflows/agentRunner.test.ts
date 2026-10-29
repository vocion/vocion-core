/**
 * The agent step's one call into the agent loop: on the step's effort and
 * tools, charged to the workflow run, and reporting what answered.
 */
import { describe, expect, it, vi } from 'vitest';
import { runAgentDeep } from '@/services/AgentService';
import { currentCallContext } from '@/services/spend/callContext';
import { runAgentTurn } from './agentRunner';

vi.mock('@/services/AgentService', () => ({ runAgentDeep: vi.fn() }));

describe('runAgentTurn', () => {
  it('runs the turn on the step\'s effort and tools, charged to the run', async () => {
    let context: ReturnType<typeof currentCallContext> | null = null;
    vi.mocked(runAgentDeep).mockImplementation(async (opts) => {
      context = currentCallContext();
      opts.onEvent?.({ type: 'run_meta', model: 'claude-opus-5-5', provider: 'anthropic', strength: 'deep', thinking: 'high', effort: { level: 'deep', chosenBy: 'person' } });
      return { response: 'Working… {"a":1}', lastAnswer: '{"a":1}', traceId: 'trace-9', toolCalls: [{ tool: 'web_search', input: {}, output: '' }], usage: { model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, microCents: 4_200_000, cents: 4.2 } as never };
    });

    const r = await runAgentTurn({ orgId: 'org_northwind', agentSlug: 'serp-analyst', message: 'Research it.', runId: 5, userId: 'workflow:seo-page:5', effort: 'deep', toolAllowlist: ['web_search'] });

    expect(vi.mocked(runAgentDeep).mock.calls[0]![0]).toMatchObject({
      orgId: 'org_northwind',
      agentSlug: 'serp-analyst',
      userId: 'workflow:seo-page:5',
      modelPrefs: { strength: 'balanced', effort: 'off', level: 'deep' },
      toolAllowlist: ['web_search'],
    });
    expect(context).toMatchObject({ runKind: 'workflow_run', runId: 5 });
    expect(r).toEqual({ text: 'Working… {"a":1}', lastAnswer: '{"a":1}', traceId: 'trace-9', model: 'claude-opus-5-5', effort: 'deep', microCents: 4_200_000, toolCalls: 1 });
  });
});
