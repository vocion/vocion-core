/**
 * "What sales emails do I need to answer" — end to end through sync, state and
 * the one query that answers it.
 *
 * Regression for 2026-10-09 (trace c126f3ca): the question took 35 steps and
 * 3m20s of phrase searches, because the index held content and no state. Here
 * a fictional inbox is synced through the real Gmail connector (its API
 * stubbed), the real ingestion (embeddings in replay mode) and the real
 * labeller (its model stubbed with the verdicts a classifier gives), and then:
 *
 *   - `mail_owed_replies` with category sales returns exactly the two threads
 *     the owner owes, in one call;
 *   - `search_knowledge` with the same facets ranks only those two;
 *   - a second sync with nothing new spends no model call;
 *   - the owner replying moves a thread to `waiting_on_them` without one.
 */
import type { RuntimeContext } from '@/services/agents/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.VOCION_LLM_MODE = 'replay';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/SourceCredentialService')>()),
  getCredentialsForConnector: vi.fn(async () => ({ token: 'fixture-token' })),
}));

const modelCalls: string[] = [];
vi.mock('@/services/mail/threadLabeller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/mail/threadLabeller')>();
  return {
    ...actual,
    labelThreads: (opts: Parameters<typeof actual.labelThreads>[0]) => actual.labelThreads({
      ...opts,
      model: async (_system, user) => {
        const { FIXTURE_VERDICTS } = await import('./testing/fixtureInbox');
        const subject = /^Subject: (.*)$/m.exec(user)?.[1] ?? '';
        modelCalls.push(subject);
        return { text: JSON.stringify(FIXTURE_VERDICTS[subject] ?? { state: 'fyi', category: 'other', ask: '' }), model: 'claude-haiku-4-5-20251001' };
      },
    }),
  };
});

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, sourceSyncCheckpointSchema } = await import('@/models/Schema');
const { runSync } = await import('@/services/SourceSyncService');
const { readOwedReplies } = await import('./owedReplies');
const { mailOwedRepliesTool } = await import('@/services/agents/tools/mailOwedReplies');
const { search } = await import('@/services/RetrievalService');
const { FIXTURE_OWNER: OWNER, fixtureThreads, gmailApiStub } = await import('./testing/fixtureInbox');

const ORG = 'org-owed-pipeline';

const threads = fixtureThreads(Date.now());

let sourceId: number;
const realFetch = globalThis.fetch;

function ctx(): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'usr-owed-owner',
    agentSlug: 'revenue-lead',
    connectorSources: ['gmail'],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    timeZone: 'UTC',
    emit: () => {},
  } as unknown as RuntimeContext;
}

beforeAll(async () => {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => gmailApiStub(threads, typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)) as typeof fetch;
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
  sourceId = row!.id;
  await runSync({ orgId: ORG, sourceId });
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(sourceSyncCheckpointSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('what sales emails do I need to answer', () => {
  it('files one state document per recent thread, and labels only what the headers cannot settle', async () => {
    const docs = await db.select({ externalId: knowledgeDocumentSchema.externalId, metadata: knowledgeDocumentSchema.metadata }).from(knowledgeDocumentSchema);
    const states = Object.fromEntries(docs
      .filter(d => d.externalId.startsWith('gmail-thread-state:'))
      .map(d => [d.externalId.slice('gmail-thread-state:'.length), (d.metadata.facets as Record<string, unknown>).reply_state]));

    expect(states).toEqual({
      't-contoso': 'needs_my_reply',
      't-acme': 'needs_my_reply',
      't-meridian': 'waiting_on_them',
      't-northwind': 'needs_my_reply',
      't-tideline': 'outbound_spam',
      't-cobalt': 'fyi',
      't-kestrel': 'fyi',
    });
    // Meridian (owner wrote last) and Cobalt (bulk) never reached the model; Atlas is outside the window.
    expect([...modelCalls].sort()).toEqual(['Agents for your field team', 'Intro', 'Invoice question', 'Pricing for the managed service', 'Triple your pipeline in 30 days']);
  });

  it('answers in one call with exactly the owed sales threads', async () => {
    const read = await readOwedReplies({ orgId: ORG, category: ['sales'] });

    expect(read.items.map(i => i.threadId)).toEqual(['t-acme', 't-contoso']);
    expect(read.items[1]).toMatchObject({ counterpart: 'Jamie Smith <jamie@contoso.example>', ask: 'Wants pricing for 40 seats before Friday', from: 'index' });

    const out = await mailOwedRepliesTool(ctx()).invoke({ category: ['sales'] });

    expect(out).toContain('Pricing for the managed service');
    expect(out).toContain('Agents for your field team');
    expect(out).not.toContain('Triple your pipeline');
    expect(out).not.toContain('Questions on the proposal');
    expect(out).toContain('From the synced index');
  });

  it('without a category, every owed thread and nothing else', async () => {
    const read = await readOwedReplies({ orgId: ORG });

    expect(read.items.map(i => i.threadId).sort()).toEqual(['t-acme', 't-contoso', 't-northwind']);
  });

  it('a facet-filtered search ranks only the matching threads', async () => {
    const hits = await search('sales', { orgId: ORG, k: 10, facets: { reply_state: 'needs_my_reply', category: 'sales' } });
    const ids = new Set(hits.map(h => String(h.metadata.threadId)));

    expect([...ids].sort()).toEqual(['t-acme', 't-contoso']);
  });

  it('a second sync with nothing new spends no model call', async () => {
    const before = modelCalls.length;
    await runSync({ orgId: ORG, sourceId, incremental: true });
    await runSync({ orgId: ORG, sourceId });

    expect(modelCalls.length).toBe(before);
  });

  it('the owner replying moves the thread to waiting, by the headers alone', async () => {
    const before = modelCalls.length;
    threads[0]!.messages.push({ id: 'm12', from: OWNER, to: 'jamie@contoso.example', subject: 'Re: Pricing for the managed service', snippet: 'Pricing attached.', at: Date.now() });
    await runSync({ orgId: ORG, sourceId, incremental: true });
    const read = await readOwedReplies({ orgId: ORG, category: ['sales'] });

    expect(read.items.map(i => i.threadId)).toEqual(['t-acme']);

    const waiting = await readOwedReplies({ orgId: ORG, states: ['waiting_on_them'] });

    expect(waiting.items.map(i => i.threadId).sort()).toEqual(['t-contoso', 't-meridian']);
    expect(modelCalls.length).toBe(before);
  });
});
