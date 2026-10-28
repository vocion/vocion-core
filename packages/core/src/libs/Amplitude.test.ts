import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAmplitudeForTests, trackAgentModelCall, trackAgentToolCall, trackChatTurn, trackProductEvent } from './Amplitude';

const trackAiMessage = vi.fn();
const trackToolCall = vi.fn();
const constructed = vi.fn();
const initialised = vi.fn();
const tracked = vi.fn();

const keys = new Map<string, string>();
vi.mock('@/services/analytics/amplitudeKey', () => ({ amplitudeKeyFor: async (orgId: string) => keys.get(orgId) ?? null }));
vi.mock('@/services/analytics/workspaceName', () => ({ workspaceNameOf: async (orgId: string) => (orgId === 'proj_northwind' ? 'Northwind' : null) }));

vi.mock('@amplitude/analytics-node', () => ({
  createInstance: () => ({ init: (key: string) => ({ promise: Promise.resolve(initialised(key)) }), track: tracked }),
}));

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

    expect(initialised).toHaveBeenCalledWith('key_1');
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({ amplitude: expect.anything() }));
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

  it('sends each workspace to its own key, and files a run nobody started under the one unattended identity', async () => {
    keys.set('proj_northwind', 'key_northwind');
    keys.set('proj_kestrel', 'key_kestrel');
    await trackAgentModelCall(modelCall);
    await trackAgentToolCall({ orgId: 'proj_kestrel', userId: null, conversationId: null, runId: 7, traceId: null, agentSlug: 'researcher', leadAgentSlug: 'revenue-lead', tool: 'search_knowledge', durationMs: 120, error: 'timed out' });

    expect(initialised.mock.calls.map(c => c[0])).toEqual(['key_northwind', 'key_kestrel']);

    const event = trackToolCall.mock.calls[0]![0] as Record<string, unknown>;

    expect(event).toMatchObject({ deviceId: 'vocion-agents', sessionId: 'run:7', groups: { workspace: 'proj_kestrel' }, eventProperties: { actor: 'unattended' }, toolName: 'search_knowledge', success: false, agentId: 'researcher', parentAgentId: 'revenue-lead' });
    expect(event).not.toHaveProperty('userId');
    expect(event).not.toHaveProperty('input');
    expect(event).not.toHaveProperty('output');
  });

  it('counts only people as users: an automation or token is the unattended identity, named on the event', async () => {
    keys.set('proj_northwind', 'key_northwind');
    const base = { orgId: 'proj_northwind', conversationId: null, runId: null, traceId: null, agentSlug: 'researcher', leadAgentSlug: null, tool: 'search_knowledge', durationMs: 5, error: null };
    await trackAgentToolCall({ ...base, userId: 'automation:crm-sweep' });
    await trackAgentToolCall({ ...base, userId: 'token:tok_1' });
    await trackAgentToolCall({ ...base, userId: 'user_1' });

    const [automation, token, person] = trackToolCall.mock.calls.map(c => c[0] as Record<string, unknown>);

    expect(automation).toMatchObject({ deviceId: 'vocion-agents', eventProperties: { actor: 'automation:crm-sweep' } });
    expect(automation).not.toHaveProperty('userId');
    expect(token).toMatchObject({ deviceId: 'vocion-agents', eventProperties: { actor: 'token:tok_1' } });
    expect(person).toMatchObject({ userId: 'user_1', eventProperties: { actor: 'user_1' } });
    expect(person).not.toHaveProperty('deviceId');
  });

  it('stamps every event with the workspace id and name, as plain properties', async () => {
    keys.set('proj_northwind', 'key_1');
    await trackAgentModelCall(modelCall);

    expect(trackAiMessage).toHaveBeenCalledWith(expect.objectContaining({ eventProperties: { actor: 'user_1', workspace_id: 'proj_northwind', workspace_name: 'Northwind' } }));
  });

  it('sends a person\'s adoption event under its own name, as the person', async () => {
    keys.set('proj_northwind', 'key_1');
    await trackProductEvent({ orgId: 'proj_northwind', userId: 'user_1', eventType: 'review.decided', agentSlug: 'revenue-lead', resourceType: 'action_run', meta: { decision: 'approved' } });

    expect(tracked).toHaveBeenCalledWith('review.decided', expect.objectContaining({ decision: 'approved', agent: 'revenue-lead', resource_type: 'action_run', workspace_name: 'Northwind' }), { user_id: 'user_1', groups: { workspace: 'proj_northwind' } });
  });

  it('reports how a chat turn ended, with its cost in dollars', async () => {
    keys.set('proj_northwind', 'key_1');
    await trackChatTurn({ orgId: 'proj_northwind', userId: 'user_1', conversationId: 42, agentSlug: 'revenue-lead', feature: 'review', effortChoice: 'auto', effortLevel: 'standard', ending: 'complete', durationMs: 6000, toolCalls: 3, microCents: 50_000_000 });

    expect(tracked).toHaveBeenCalledWith('chat.turn_completed', expect.objectContaining({ conversation_id: 42, feature: 'review', effort_level: 'standard', ending: 'complete', tool_calls: 3, cost_usd: 0.5, workspace_id: 'proj_northwind' }), expect.objectContaining({ user_id: 'user_1' }));
  });
});
