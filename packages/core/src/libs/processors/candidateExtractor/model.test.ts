/**
 * The model call's contract: one call per document, one corrective retry and
 * no more, a timeout that becomes a counted skip rather than a thrown sync,
 * and cached input billed as cached.
 *
 * The chat model is stubbed everywhere. A test that reaches a real endpoint is
 * a test nobody runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncBudget } from '../budget';

const invoke = vi.fn();
const bindTools = vi.fn();
const chargeUsage = vi.fn(async () => {});
const preflightCheck = vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string });

vi.mock('@/libs/llm/langchain', () => ({
  buildChatModelForOrg: vi.fn(async () => ({ invoke, bindTools })),
  resolvedModelId: () => 'us.anthropic.claude-sonnet-4-6',
}));

vi.mock('@/services/BudgetService', () => ({
  preflightCheck: (...args: unknown[]) => preflightCheck(...(args as [])),
  chargeUsage: (...args: unknown[]) => chargeUsage(...(args as [])),
}));

const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
const { extractRecords } = await import('./model');
const { candidateExtractorConfigSchema } = await import('./config');

const config = candidateExtractorConfigSchema.parse({
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only public events.',
});

const prompt = { system: 'system', human: 'human', estimatedTokens: 500, trimmed: [] };

function call(overrides: Partial<Parameters<typeof extractRecords>[0]> = {}) {
  return extractRecords({
    orgId: 'org_extract',
    sourceSlug: 'higher-ground',
    config,
    prompt,
    budget: createSyncBudget(),
    signal: new AbortController().signal,
    trace: { uri: 'https://example.org/events', bytes: 1200, jsonLdBlocks: 1, knownCards: 3 },
    ...overrides,
  });
}

/**
 * One well-formed answer with a single record.
 * @param usage - Usage metadata to attach, when the test needs one.
 */
function goodAnswer(usage?: Record<string, unknown>) {
  return {
    content: '{"records":[{"fields":{"title":"Open Mic"},"confidence":0.9}]}',
    ...(usage ? { usage_metadata: usage } : {}),
  };
}

describe('candidate extractor model call', () => {
  beforeEach(() => {
    invoke.mockReset();
    bindTools.mockReset();
    chargeUsage.mockReset();
    preflightCheck.mockReset();
    preflightCheck.mockResolvedValue({ ok: true });
  });

  it('calls the model exactly once for a document it can read', async () => {
    invoke.mockResolvedValue(goodAnswer());

    const result = await call();

    expect(result.status).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.calls).toBe(1);
  });

  it('never binds tools', async () => {
    invoke.mockResolvedValue(goodAnswer());

    await call();

    // The one defence a prompt cannot provide: an extractor reading an
    // untrusted page has nothing to call, whatever the page asks for.
    expect(bindTools).not.toHaveBeenCalled();
    expect(vi.mocked(buildChatModelForOrg)).toHaveBeenCalledWith(
      'extractor',
      'org_extract',
      { temperature: 0, maxTokens: 2048, streaming: false },
    );
  });

  it('retries a malformed answer exactly once, then skips', async () => {
    invoke.mockResolvedValue({ content: 'Sure! Here are the events I found.' });

    const result = await call();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'skipped', reason: 'model_invalid', calls: 2 });
  });

  it('accepts the retry when the second answer parses', async () => {
    invoke.mockResolvedValueOnce({ content: 'not json' });
    invoke.mockResolvedValueOnce(goodAnswer());

    const result = await call();

    expect(result.status).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('strips code fences the way the classifier does', async () => {
    invoke.mockResolvedValue({ content: '```json\n{"records":[]}\n```' });

    const result = await call();

    expect(result.status).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('turns a timeout into a counted skip, with no retry', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    invoke.mockRejectedValue(timeout);

    const result = await call();

    // A second attempt shares the deadline, so it would time out too.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'skipped', reason: 'model_timeout' });
  });

  it('passes the cache read count through, so cached input is not billed at full rate', async () => {
    invoke.mockResolvedValue(goodAnswer({
      input_tokens: 1000,
      output_tokens: 40,
      input_token_details: { cache_read: 800 },
    }));

    await call();

    expect(chargeUsage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'us.anthropic.claude-sonnet-4-6',
      agentSlug: 'event-ingestion-lead',
      usage: { inputTokens: 1000, outputTokens: 40, cacheReadTokens: 800 },
    }));
  });

  it('refuses before the call when the sync has no model calls left', async () => {
    const budget = createSyncBudget({ limits: { maxModelCalls: 0 } });

    const result = await call({ budget });

    expect(result).toMatchObject({ status: 'skipped', reason: 'budget_model_calls', calls: 0 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses before the call when the agent is over its budget', async () => {
    preflightCheck.mockResolvedValue({ ok: false, reason: 'hard_tokens_exceeded' });

    const result = await call();

    expect(result).toMatchObject({ status: 'skipped', reason: 'budget_exceeded' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
