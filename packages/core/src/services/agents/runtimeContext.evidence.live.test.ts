/**
 * LIVE: a consult over the fictional inbox on a real model, measuring what the
 * turn re-reads — input tokens, tool calls, repeats — for the evidence
 * hand-off, the search memo and compact results (`runtimeContext.ts`, turn evidence). Prints
 * one `EVIDENCE_LIVE` line. Opt-in, like every vendor-calling test:
 *
 *   LIVE_MODEL_E2E=1 LIVE_ANTHROPIC_API_KEY=… LIVE_OPENAI_API_KEY=… \
 *     npx vitest run --project unit src/services/agents/turnEvidence.live.test.ts
 */
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

const ORG = 'org-evidence-live';
const MODEL = process.env.OWED_LIVE_MODEL ?? 'claude-sonnet-5';
const QUESTION = 'Search the inbox yourself for every prospect who needs a follow-up, then have the Follow Up Coordinator double-check it and tell me what to do first.';
const LEAD_PROMPT = 'You are the RevOps Lead for a services firm. Your KPI is discovery calls booked. You decide what matters, consult a teammate when their work is needed, and answer the founder plainly.';
const TEAMMATE_PROMPT = 'You make sure no prospect waits on us: you triage inbound replies and chase follow-ups. Look things up, then report back concisely.';

/** Calls by model, tools, tokens. */
class Meter extends BaseCallbackHandler {
  name = 'evidence-meter';
  byModel: Record<string, number> = {};
  tools: string[] = [];
  outputTokens = 0;
  inputTokens = 0;
  repeats = 0;
  override async handleToolEnd(output: unknown) {
    const text = typeof output === 'string' ? output : JSON.stringify(output);
    if (text.includes('Already searched this turn')) {
      this.repeats += 1;
    }
  }

  override async handleChatModelStart(llm: Serialized) {
    const kwargs = (llm as { kwargs?: { model?: string; model_name?: string } }).kwargs;
    const id = kwargs?.model ?? kwargs?.model_name ?? 'unknown';
    this.byModel[id] = (this.byModel[id] ?? 0) + 1;
  }

  override async handleLLMEnd(output: LLMResult) {
    const usage = (output.generations?.[0]?.[0] as { message?: { usage_metadata?: { input_tokens?: number; output_tokens?: number } } } | undefined)?.message?.usage_metadata;
    this.outputTokens += usage?.output_tokens ?? 0;
    this.inputTokens += usage?.input_tokens ?? 0;
  }

  override async handleToolStart(tool: Serialized, _input: string, _runId: string, _parent?: string, _tags?: string[], _meta?: Record<string, unknown>, runName?: string) {
    this.tools.push(runName ?? (tool as { name?: string }).name ?? 'tool');
  }
}

describe.skipIf(!LIVE)('live: consult evidence', () => {
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const { db } = await import('@/libs/DB');
    const { agentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
    const { fixtureThreads, gmailApiStub } = await import('@/services/mail/testing/fixtureInbox');
    const { runSync } = await import('@/services/SourceSyncService');
    const threads = fixtureThreads(Date.now());
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith('https://gmail.googleapis.com/') ? gmailApiStub(threads, url) : realFetch(input, init);
    }) as typeof fetch;
    const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
    await runSync({ orgId: ORG, sourceId: row!.id });
    const harness = { model: MODEL, modelProvider: 'anthropic' as const };
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: 'revops-lead', name: 'RevOps Lead', systemPrompt: LEAD_PROMPT, connectorSources: ['gmail'], harnessConfig: harness },
      { orgId: ORG, slug: 'follow-up-coordinator', name: 'Follow Up Coordinator', parentAgentSlug: 'revops-lead', systemPrompt: TEAMMATE_PROMPT, connectorSources: ['gmail'], harnessConfig: harness },
    ]);
  }, 120_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  for (const lead of ['revops-lead']) {
    it(`${lead} answers with the owed threads`, async () => {
      const { compileAgentForRequest, buildInitialFiles } = await import('@/services/agents/harness');
      const { clockLine } = await import('@/libs/time/zone');
      const meter = new Meter();
      const { graph } = await compileAgentForRequest(ORG, lead, { emit: () => {}, turnMessage: QUESTION, timeZone: 'UTC' });
      const files = await buildInitialFiles(ORG, lead);
      const started = Date.now();
      const result = await graph.invoke(
        { messages: [{ role: 'user', content: `${clockLine(new Date(), 'UTC')}\n\n${QUESTION}` }], files } as never,
        { callbacks: [meter], recursionLimit: 200 },
      );
      const ms = Date.now() - started;
      const messages = (result as { messages: Array<{ content: unknown }> }).messages;
      const last = messages[messages.length - 1]!.content;
      const answer = typeof last === 'string' ? last : JSON.stringify(last);
      console.warn(`EVIDENCE_LIVE ${JSON.stringify({ lead, ms, byModel: meter.byModel, tools: meter.tools, repeatsAnsweredFromMemo: meter.repeats, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens })}`);
      console.warn(`EVIDENCE_ANSWER ${lead} ${answer.slice(0, 800)}`);

      expect(answer).toMatch(/Contoso|Jamie/);
    }, 400_000);
  }
});
