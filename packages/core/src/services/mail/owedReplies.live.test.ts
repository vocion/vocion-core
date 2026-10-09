/**
 * LIVE: "What sales emails do I need to answer", asked of a real agent on a
 * real model over the fictional inbox — the measurement behind the perf work
 * on trace c126f3ca (35 steps, 3m20s in production).
 *
 * Opt-in, like every test here that calls a vendor: it runs only with
 * `LIVE_MODEL_E2E=1` and `LIVE_ANTHROPIC_API_KEY` (and `LIVE_OPENAI_API_KEY`
 * for real embeddings; without it embeddings replay as pseudo-vectors, which
 * only weakens the semantic arm). The labeller runs on the real classifier too.
 *
 *   LIVE_MODEL_E2E=1 LIVE_ANTHROPIC_API_KEY=… LIVE_OPENAI_API_KEY=… \
 *     npx vitest run --project unit src/services/mail/owedReplies.live.test.ts
 *
 * It prints one JSON line (`OWED_REPLIES_LIVE {…}`): wall time to the answer,
 * model calls, tool calls by name, and tokens, so a before/after on the same
 * question is one command on each branch. It asserts the answer names the
 * owed sales threads and not the cold pitch, and holds the budget the work
 * is aiming at: under 20s, at most 3 tool calls.
 */
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The unit project pins fake vendor keys (vitest.config.mts), so the real
// ones arrive under their own names and are put in place only for this run.
const LIVE = process.env.LIVE_MODEL_E2E === '1' && !!process.env.LIVE_ANTHROPIC_API_KEY;
if (LIVE) {
  process.env.ANTHROPIC_API_KEY = process.env.LIVE_ANTHROPIC_API_KEY;
  if (process.env.LIVE_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.LIVE_OPENAI_API_KEY;
  } else {
    process.env.VOCION_LLM_MODE = 'replay';
  }
}

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/SourceCredentialService')>()),
  getCredentialsForConnector: vi.fn(async () => ({ token: 'fixture-token' })),
  getCredentialsForSource: vi.fn(async () => ({ token: 'fixture-token' })),
}));

const ORG = 'org-owed-live';
const LEAD = 'revops-lead';
const QUESTION = 'What sales emails do I need to answer';
const MODEL = process.env.OWED_LIVE_MODEL ?? 'claude-sonnet-5';

/** Counts every model and tool call in a run, subagents included. */
class Meter extends BaseCallbackHandler {
  name = 'owed-replies-meter';
  modelCalls = 0;
  tools: string[] = [];
  inputTokens = 0;
  outputTokens = 0;
  override async handleChatModelStart() {
    this.modelCalls += 1;
  }

  override async handleLLMEnd(output: LLMResult) {
    const usage = (output.generations?.[0]?.[0] as { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } } | undefined)?.message?.usage_metadata;
    this.inputTokens += usage?.input_tokens ?? 0;
    this.outputTokens += usage?.output_tokens ?? 0;
  }

  override async handleToolStart(tool: Serialized, _input: string, _runId: string, _parent?: string, _tags?: string[], _meta?: Record<string, unknown>, runName?: string) {
    this.tools.push(runName ?? (tool as { name?: string }).name ?? 'tool');
  }
}

describe.skipIf(!LIVE)('live: what sales emails do I need to answer', () => {
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const { db } = await import('@/libs/DB');
    const { agentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
    const { fixtureThreads, gmailApiStub } = await import('./testing/fixtureInbox');
    const { runSync } = await import('@/services/SourceSyncService');
    const threads = fixtureThreads(Date.now());
    // Gmail is the stub; every other host (the model vendors) is real.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith('https://gmail.googleapis.com/') ? gmailApiStub(threads, url) : realFetch(input, init);
    }) as typeof fetch;
    const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
    await runSync({ orgId: ORG, sourceId: row!.id });
    await db.insert(agentSchema).values([
      {
        orgId: ORG,
        slug: LEAD,
        name: 'RevOps Lead',
        systemPrompt: 'You are the RevOps Lead for a services firm. Your KPI is discovery calls booked. You decide what matters, consult a teammate when their work is needed, and answer the founder plainly.',
        connectorSources: ['gmail'],
        harnessConfig: { model: MODEL, modelProvider: 'anthropic' },
      },
      {
        orgId: ORG,
        slug: 'follow-up-coordinator',
        name: 'Follow Up Coordinator',
        parentAgentSlug: LEAD,
        systemPrompt: 'You make sure no prospect waits on us: you triage inbound replies and chase follow-ups.',
        connectorSources: ['gmail'],
        harnessConfig: { model: MODEL, modelProvider: 'anthropic' },
      },
    ]);
  }, 120_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('answers with the owed sales threads, fast', async () => {
    const { compileAgentForRequest, buildInitialFiles } = await import('@/services/agents/harness');
    const { clockLine } = await import('@/libs/time/zone');
    const meter = new Meter();
    const { graph } = await compileAgentForRequest(ORG, LEAD, { emit: () => {}, userId: undefined, turnMessage: QUESTION, timeZone: 'UTC' });
    const files = await buildInitialFiles(ORG, LEAD);
    const started = Date.now();
    const result = await graph.invoke(
      { messages: [{ role: 'user', content: `${clockLine(new Date(), 'UTC')}\n\n${QUESTION}` }], files } as never,
      { callbacks: [meter], recursionLimit: 200 },
    );
    const ms = Date.now() - started;
    const messages = (result as { messages: Array<{ content: unknown }> }).messages;
    const last = messages[messages.length - 1]!.content;
    const answer = typeof last === 'string' ? last : JSON.stringify(last);
    const tools = meter.tools.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t]: (acc[t] ?? 0) + 1 }), {});
    console.warn(`OWED_REPLIES_LIVE ${JSON.stringify({ model: MODEL, ms, modelCalls: meter.modelCalls, toolCalls: meter.tools.length, tools, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens })}`);
    console.warn(`OWED_REPLIES_ANSWER ${answer.slice(0, 1500)}`);

    expect(answer).toMatch(/Contoso|Jamie/);
    expect(answer).toMatch(/Acme|Pat/);
    expect(meter.tools.length).toBeLessThanOrEqual(3);
    expect(ms).toBeLessThan(20_000);
  }, 400_000);
});
