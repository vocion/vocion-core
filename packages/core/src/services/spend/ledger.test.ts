/**
 * What a ledger row says, and how a call's context is laid over its caller's:
 * the pure half of the spend ledger. The write itself is covered against a
 * database in `spend.pglite.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { markCharged, providerOfModel, wasCharged } from '@/libs/llm/usage';
import { currentCallContext, mergeCallContext, noteCallContext, withCallContext } from './callContext';
import { AGENT_TURN_FEATURE, ledgerRowOf } from './ledger';

const CHARGE = { orgId: 'ws_1', model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, microCents: 42 };

describe('a ledger row', () => {
  it('takes the person, thread, run and effort from the context, and the rest from the charge', () => {
    const row = ledgerRowOf({ ...CHARGE, agentSlug: 'lead', feature: 'chat.judge' }, { userId: 'u1', conversationId: 3, runKind: 'browser_run', runId: 8, effortLevel: 'quick', traceId: 't1' }, undefined, 'acct_1');

    expect(row).toMatchObject({ orgId: 'ws_1', accountId: 'acct_1', agentSlug: 'lead', feature: 'chat.judge', userId: 'u1', conversationId: 3, runKind: 'browser_run', runId: '8', effortLevel: 'quick', traceId: 't1', microCents: 42 });
  });

  it('reads a mission run or a conversation from the run-cost scope when the context names none', () => {
    expect(ledgerRowOf(CHARGE, {}, { missionRunId: 12 }, null)).toMatchObject({ runKind: 'mission_run', runId: '12', conversationId: null });
    expect(ledgerRowOf(CHARGE, {}, { conversationId: 4 }, null)).toMatchObject({ runKind: null, runId: null, conversationId: 4 });
  });

  it('files an agent\'s call with no feature as an agent turn, and one with neither as unattributed', () => {
    expect(ledgerRowOf({ ...CHARGE, agentSlug: 'lead' }, {}, undefined, null).feature).toBe(AGENT_TURN_FEATURE);
    expect(ledgerRowOf(CHARGE, { agentSlug: 'from-context' }, undefined, null)).toMatchObject({ agentSlug: 'from-context', feature: AGENT_TURN_FEATURE });
    expect(ledgerRowOf(CHARGE, {}, undefined, null).feature).toBe('unattributed');
  });

  it('prefers the charge\'s own trace over the context\'s', () => {
    expect(ledgerRowOf({ ...CHARGE, traceId: 'own' }, { traceId: 'ctx' }, undefined, null).traceId).toBe('own');
  });
});

describe('the call context', () => {
  it('lays an inner scope over the outer one, field by field', async () => {
    expect(mergeCallContext({ userId: 'u1', runKind: 'eval_run', runId: 'ds' }, { runKind: 'browser_run', runId: 2, userId: undefined })).toEqual({ userId: 'u1', runKind: 'browser_run', runId: 2 });

    const seen = await withCallContext({ userId: 'u1' }, () => withCallContext({ conversationId: 9 }, async () => currentCallContext()));

    expect(seen).toEqual({ userId: 'u1', conversationId: 9 });
    expect(currentCallContext()).toEqual({});
  });

  it('takes a field learned after the scope opened, and ignores it outside one', async () => {
    noteCallContext({ traceId: 'nowhere' });

    expect(currentCallContext()).toEqual({});

    const seen = await withCallContext({ userId: 'u1' }, async () => {
      noteCallContext({ traceId: 't9' });
      return currentCallContext();
    });

    expect(seen).toEqual({ userId: 'u1', traceId: 't9' });
  });
});

describe('a response charged once', () => {
  it('is marked by the agent\'s hook and recognised after', () => {
    const response = { content: 'ok' };

    expect(wasCharged(response)).toBe(false);

    markCharged(response);

    expect(wasCharged(response)).toBe(true);
    expect(wasCharged(null)).toBe(false);
  });

  it('names the vendor from the model id', () => {
    expect(providerOfModel('claude-opus-5-5')).toBe('anthropic');
    expect(providerOfModel('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toBe('bedrock');
    expect(providerOfModel('amazon.titan-embed-text-v1')).toBe('bedrock');
    expect(providerOfModel('text-embedding-3-small')).toBe('openai');
    expect(providerOfModel('gpt-4o-mini')).toBe('openai');
    expect(providerOfModel('mystery-model')).toBeNull();
  });
});

describe('a classifier call made inside an agent\'s graph', () => {
  it('is not charged a second time by the call site', async () => {
    vi.resetModules();
    const charged: unknown[] = [];
    vi.doMock('@/services/BudgetService', () => ({ chargeUsage: async (opts: unknown) => {
      charged.push(opts);
    } }));
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { markCharged: mark } = await import('@/libs/llm/usage');
    const inGraph = { usage_metadata: { input_tokens: 100, output_tokens: 10 }, response_metadata: { model_name: 'claude-haiku-4-5-20251001' } };
    const alone = { usage_metadata: { input_tokens: 100, output_tokens: 10 }, response_metadata: { model_name: 'claude-haiku-4-5-20251001' } };
    mark(inGraph);

    await chargeModelCall({ orgId: 'ws_1', feature: 'chat.judge', role: 'classifier', response: inGraph });
    await chargeModelCall({ orgId: 'ws_1', feature: 'chat.judge', role: 'classifier', response: alone });

    expect(charged).toHaveLength(1);

    vi.doUnmock('@/services/BudgetService');
  });
});
