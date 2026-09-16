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
    content: '{"records":[{"fields":{"title":"Open Mic"},"confidence":0.9,"suggestedDecision":"approve","suggestedDecisionReason":"Fits the operator rules."}]}',
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
      { temperature: 0, maxTokens: 4096, streaming: false },
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

  it('makes a record with no recommendation cost the corrective retry', async () => {
    // The whole point of requiring it: a card nobody recommended anything
    // about cannot be compared against what the reviewer then did, so it is
    // worth one more model call rather than a card that measures nothing.
    invoke.mockResolvedValueOnce({ content: '{"records":[{"fields":{"title":"Open Mic"},"confidence":0.9}]}' });
    invoke.mockResolvedValueOnce(goodAnswer());

    const result = await call();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.records[0]?.suggestedDecision).toBe('approve');
  });

  it('carries the recommendation and its reason through to the record', async () => {
    invoke.mockResolvedValue({
      content: '{"records":[{"fields":{"title":"Open Mic"},"confidence":0.9,"suggestedDecision":"reject","suggestedDecisionReason":"  The date has already passed.  "}]}',
    });

    const result = await call();

    expect(result.status === 'ok' && result.records[0]?.suggestedDecision).toBe('reject');
    // Trimmed on the way in, so the review card never renders the padding.
    expect(result.status === 'ok' && result.records[0]?.suggestedDecisionReason).toBe('The date has already passed.');
  });

  it('keeps a long reason whole rather than cutting it mid-word', async () => {
    // The prompt asks for one short sentence, but a model that writes two must
    // not have the second chopped at a character count — half a word tells a
    // reviewer less than the long version does. The card clamps what it shows.
    const long = `The venue sits outside the coverage area, ${'and the run repeats every Tuesday, '.repeat(9)}so a person should turn it down.`;

    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{ fields: { title: 'Open Mic' }, confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: long }],
      }),
    });

    const result = await call();

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.records[0]?.suggestedDecisionReason).toBe(long);
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

  it('gives the call the model deadline from the budget, which a source may lower', async () => {
    // The old 20s literal was below what a healthy Bedrock call costs (18.2s
    // average on the first dev shadow), so the deadline is a cap now: the
    // default is 60s and this source asked for 20ms, which it gets.
    invoke.mockImplementation(async (_messages: unknown, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const aborted = new Error('The operation was aborted due to timeout');
          aborted.name = 'TimeoutError';
          reject(aborted);
        }, { once: true });
      }));

    const result = await call({ budget: createSyncBudget({ limits: { modelTimeoutMs: 20 } }) });

    expect(result).toMatchObject({ status: 'skipped', reason: 'model_timeout', calls: 1 });
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

  it('truncates an over-long series note instead of failing the answer', async () => {
    // `notes` is a hard `.max(2000)`, so an over-long value there costs the
    // corrective retry and can cost the document. A 141-character aside must
    // never cost a card, so this one transforms rather than rejects.
    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{ fields: { title: 'Open Mic' }, confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: 'Fits the operator rules.', seriesOf: 41, seriesNote: 'x'.repeat(400) }],
      }),
    });

    const result = await call();

    expect(result.status).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.status === 'ok' && result.records[0]?.seriesNote).toHaveLength(140);
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
