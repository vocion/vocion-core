/**
 * LIVE: effort levels on a real model — Auto's reading of three requests, and
 * "What sales emails do I need to answer" through the whole turn
 * (`runAgentDeep`) over the fictional inbox, printing what the level bought.
 *
 * Opt-in: `LIVE_MODEL_E2E=1` and `LIVE_ANTHROPIC_API_KEY` (the unit project
 * pins fake vendor keys, so the real one arrives under its own name), plus
 * `LIVE_OPENAI_API_KEY` for real embeddings.
 *
 *   LIVE_MODEL_E2E=1 LIVE_ANTHROPIC_API_KEY=… LIVE_OPENAI_API_KEY=… \
 *     npx vitest run --project unit src/services/agents/effort.live.test.ts
 */
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

const ORG = 'org-effort-live';
const LEAD = 'revops-lead';
const USER = 'usr-effort-live';
const MODEL = process.env.OWED_LIVE_MODEL ?? 'claude-sonnet-5';

describe.skipIf(!LIVE)('live: effort levels', () => {
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const { db } = await import('@/libs/DB');
    const { agentSchema, knowledgeSourceSchema, userSchema } = await import('@/models/Schema');
    const { fixtureThreads, gmailApiStub } = await import('@/services/mail/testing/fixtureInbox');
    const { runSync } = await import('@/services/SourceSyncService');
    const threads = fixtureThreads(Date.now());
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return url.startsWith('https://gmail.googleapis.com/') ? gmailApiStub(threads, url) : realFetch(input, init);
    }) as typeof fetch;
    await db.insert(userSchema).values({ id: USER, email: 'owner@metacto.example', name: 'Owner' });
    const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
    await runSync({ orgId: ORG, sourceId: row!.id });
    await db.insert(agentSchema).values([
      {
        orgId: ORG,
        slug: LEAD,
        name: 'RevOps Lead',
        systemPrompt: 'You are the RevOps Lead for a services firm. Your KPI is discovery calls booked. You decide what matters, consult a teammate when their work is needed, and answer the founder plainly.',
        connectorSources: ['gmail'],
        harnessConfig: { model: MODEL, modelProvider: 'anthropic', runsOn: 'in-process' },
      },
      {
        orgId: ORG,
        slug: 'follow-up-coordinator',
        name: 'Follow Up Coordinator',
        parentAgentSlug: LEAD,
        systemPrompt: 'You make sure no prospect waits on us: you triage inbound replies and chase follow-ups.',
        connectorSources: ['gmail'],
        harnessConfig: { model: MODEL, modelProvider: 'anthropic', runsOn: 'in-process' },
      },
    ]);
  }, 120_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('auto reads quick, standard and deep from the request', async () => {
    const { inferEffort } = await import('./effort');
    const levels = await Promise.all([
      'What is on my calendar today?',
      'What sales emails do I need to answer',
      'Research everything we know about Kestrel Capital since July and write me a plan for the renewal.',
    ].map(message => inferEffort({ orgId: ORG, message })));
    console.warn(`EFFORT_AUTO ${JSON.stringify(levels)}`);

    expect(levels.map(l => l.level)).toEqual(['quick', 'standard', 'deep']);
  }, 60_000);

  it('runs the sales-emails question inside its envelope and says what it took', async () => {
    const { runAgentDeep } = await import('@/services/AgentService');
    const events: Array<Record<string, unknown>> = [];
    const started = Date.now();
    const out = await runAgentDeep({
      orgId: ORG,
      agentSlug: LEAD,
      message: 'What sales emails do I need to answer',
      userId: USER,
      timeZone: 'UTC',
      onEvent: e => events.push(e as unknown as Record<string, unknown>),
    });
    const ms = Date.now() - started;
    const effort = events.find(e => e.type === 'effort_result');
    console.warn(`EFFORT_TURN ${JSON.stringify({ ms, effort, tools: out.toolCalls.map(t => t.tool), usage: out.usage && { turns: out.usage.turns, in: out.usage.inputTokens, out: out.usage.outputTokens, cents: out.usage.cents } })}`);
    console.warn(`EFFORT_ANSWER ${out.response.slice(0, 1200)}`);

    expect(effort).toMatchObject({ level: 'standard', chosenBy: 'auto' });
    expect(out.response).toMatch(/Contoso|Jamie/);
  }, 400_000);
});
