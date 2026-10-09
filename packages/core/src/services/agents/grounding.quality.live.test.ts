/**
 * LIVE: the source check (`answerBackstop.ts` `checkGrounding`) on a hard
 * question over the fictional inbox, at Standard and Deep: the answer as the
 * person sees it — its text plus the check's "unverified" step — judged
 * against the facts the inbox holds, with the check's time and size.
 *
 * Opt-in: `LIVE_MODEL_E2E=1` and `LIVE_ANTHROPIC_API_KEY` (plus
 * `LIVE_OPENAI_API_KEY` for real embeddings). `EFFORT_QUALITY_RUNS` repeats
 * each level (default 1). Prints one `GROUNDING_QUALITY` line per run.
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

const ORG = 'org-grounding-quality';
const LEAD = 'revops-lead';
const USER = 'usr-grounding-quality';
const MODEL = process.env.OWED_LIVE_MODEL ?? 'claude-sonnet-5';
const RUNS = Number(process.env.EFFORT_QUALITY_RUNS ?? 1);
const QUESTION = 'Go through every open thread in my inbox and rank them by revenue risk. For each one, tell me exactly what to say and by when, and flag anything I should not reply to at all. Be precise about dates and deadlines.';

/** What a right answer holds, from the fictional inbox (`services/mail/testing/fixtureInbox.ts`). */
const RUBRIC = [
  'Contoso (Jamie Smith) asked for pricing for 40 seats and decides on Friday, which is today: ranked first or flagged as the most urgent.',
  'Acme (Pat Lee) replied to outreach asking for a call next week and has waited about five days: a reply proposing times is owed.',
  'Northwind (an existing customer) asked why the October invoice doubled: treated as a reply owed with retention/revenue risk.',
  'Meridian Dental: the owner already replied last (asked "did these help?"), so nothing is owed now — at most a later nudge. Not presented as an unanswered email.',
  'Tideline (Rowan Pike) is a cold pitch: flagged as not to reply to.',
  'The Cobalt newsletter is not treated as something to answer.',
  'Kestrel Capital (Dana Reyes) closed with "Anytime, talk soon": no reply needed.',
  'No invented facts presented as established: no amounts, dates, names or commitments the threads do not contain — a specific the turn itself marks unverified (in the answer, or in its "unverified" source-check step) does not count against this.',
];

async function judge(answer: string): Promise<{ met: boolean[]; overall: number }> {
  const { buildChatModel } = await import('@/libs/llm/langchain');
  const model = buildChatModel('main', { provider: 'anthropic', model: 'claude-opus-5-5', streaming: false, maxTokens: 4000, apiKey: process.env.LIVE_ANTHROPIC_API_KEY });
  const prompt = [
    'You grade an assistant\'s answer against a rubric. For each numbered criterion say whether the answer meets it, then give an overall quality score from 1 to 10 for usefulness, accuracy and precision.',
    'Answer with JSON only: {"met": [true|false, …one per criterion…], "overall": <1-10>}.',
    '',
    'RUBRIC:',
    ...RUBRIC.map((r, i) => `${i + 1}. ${r}`),
    '',
    'ANSWER:',
    answer,
  ].join('\n');
  const res = await model.invoke([{ role: 'user', content: prompt }]);
  const text = typeof res.content === 'string' ? res.content : (res.content as Array<{ text?: string }>).map(c => c.text ?? '').join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { met: boolean[]; overall: number };
  return json;
}

describe.skipIf(!LIVE)('live: answer quality by effort level', () => {
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
    const harness = { model: MODEL, modelProvider: 'anthropic' as const, runsOn: 'in-process' as const };
    await db.insert(agentSchema).values([
      { orgId: ORG, slug: LEAD, name: 'RevOps Lead', systemPrompt: 'You are the RevOps Lead for a services firm. Your KPI is discovery calls booked. You decide what matters, consult a teammate when their work is needed, and answer the founder plainly.', connectorSources: ['gmail'], harnessConfig: harness },
      { orgId: ORG, slug: 'follow-up-coordinator', name: 'Follow Up Coordinator', parentAgentSlug: LEAD, systemPrompt: 'You make sure no prospect waits on us: you triage inbound replies and chase follow-ups.', connectorSources: ['gmail'], harnessConfig: harness },
    ]);
  }, 120_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  for (const level of ['standard', 'deep'] as const) {
    for (let run = 1; run <= RUNS; run++) {
      it(`${level} #${run}`, async () => {
        const { runAgentDeep } = await import('@/services/AgentService');
        const started = Date.now();
        const events: Array<Record<string, unknown>> = [];
        const out = await runAgentDeep({
          orgId: ORG,
          agentSlug: LEAD,
          message: QUESTION,
          userId: USER,
          timeZone: 'UTC',
          modelPrefs: { strength: 'balanced', effort: 'off', level },
          onEvent: e => events.push(e as unknown as Record<string, unknown>),
        });
        const check = events.find(e => e.type === 'trace_node' && e.tool === 'source_check') as { resultDetail?: string; startedAt?: number; endedAt?: number } | undefined;
        const seen = check?.resultDetail ? `${out.response}\n\n[Source check — shown on the turn]\n${check.resultDetail}` : out.response;
        const ms = Date.now() - started;
        const grade = await judge(seen);
        const met = grade.met.filter(Boolean).length;
        console.warn(`GROUNDING_QUALITY ${JSON.stringify({ level, run, ms, checkMs: check?.startedAt && check.endedAt ? check.endedAt - check.startedAt : null, flagged: check?.resultDetail ? check.resultDetail.split('\n').length : 0, met: `${met}/${RUBRIC.length}`, overall: grade.overall, missed: grade.met.map((m, i) => (m ? null : i + 1)).filter(Boolean), modelCalls: out.usage?.turns, outputTokens: out.usage?.outputTokens, tools: out.toolCalls.map(t => t.tool) })}`);

        console.warn(`GROUNDING_ANSWER ${level} ${run} ${out.response.replace(/\n/g, ' ').slice(0, 2500)}`);

        expect(out.response.length).toBeGreaterThan(0);
      }, 600_000);
    }
  }
});
