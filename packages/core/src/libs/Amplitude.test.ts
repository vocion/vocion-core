import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAmplitudeForTests, trackAgentModelCall, trackAgentToolCall } from './Amplitude';

const trackAiMessage = vi.fn();
const trackToolCall = vi.fn();
const constructed = vi.fn();

const keys = new Map<string, string>();
vi.mock('@/services/analytics/amplitudeKey', () => ({ amplitudeKeyFor: async (orgId: string) => keys.get(orgId) ?? null }));

vi.mock('@amplitude/ai', () => ({
  AIConfig: class {
    constructor(public opts: unknown) {}
  },
  AmplitudeAI: class {
    constructor(opts: unknown) {
      constructed(opts);
    }

    trackAiMessage = trackAiMessage;
    trackToolCall = trackToolCall;
  },
}));

const modelCall = {
  orgId: 'proj_northwind',
  userId: 'user_1',
  conversationId: 42,
  runId: null,
  traceId: 'tr_1',
  agentSlug: 'revenue-lead',
  feature: 'agent.turn',
  model: 'claude-sonnet-5',
  provider: 'anthropic',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 500,
  cacheWriteTokens: 0,
  microCents: 150_000_000,
  latencyMs: 900,
};

describe('Amplitude agent analytics', () => {
  beforeEach(() => {
    resetAmplitudeForTests();
    vi.clearAllMocks();
    keys.clear();
  });

  it('sends nothing for a workspace with no key', async () => {
    await trackAgentModelCall(modelCall);

    expect(constructed).not.toHaveBeenCalled();
    expect(trackAiMessage).not.toHaveBeenCalled();
  });

  it('files a model call as metadata only, on the conversation, with cost in dollars', async () => {
    keys.set('proj_northwind', 'key_1');
    await trackAgentModelCall(modelCall);

    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key_1' }));
    expect((constructed.mock.calls[0]![0] as { config: { opts: unknown } }).config.opts).toEqual({ contentMode: 'metadata_only' });
    expect(trackAiMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      sessionId: 'conversation:42',
      customerOrgId: 'proj_northwind',
      agentId: 'revenue-lead',
      content: '',
      totalCostUsd: 1.5,
      inputTokens: 1000,
      cacheReadTokens: 500,
    }));
  });

  it('sends each workspace to its own key, and files a run nobody started under its workspace', async () => {
    keys.set('proj_northwind', 'key_northwind');
    keys.set('proj_kestrel', 'key_kestrel');
    await trackAgentModelCall(modelCall);
    await trackAgentToolCall({ orgId: 'proj_kestrel', userId: null, conversationId: null, runId: 7, traceId: null, agentSlug: 'researcher', leadAgentSlug: 'revenue-lead', tool: 'search_knowledge', durationMs: 120, error: 'timed out' });

    expect(constructed.mock.calls.map(c => (c[0] as { apiKey: string }).apiKey)).toEqual(['key_northwind', 'key_kestrel']);

    const event = trackToolCall.mock.calls[0]![0] as Record<string, unknown>;

    expect(event).toMatchObject({ deviceId: 'workspace:proj_kestrel', sessionId: 'run:7', toolName: 'search_knowledge', success: false, agentId: 'researcher', parentAgentId: 'revenue-lead' });
    expect(event).not.toHaveProperty('userId');
    expect(event).not.toHaveProperty('input');
    expect(event).not.toHaveProperty('output');
  });
});
