/**
 * get_gmail_thread suite — the TTL read-through cache properties:
 *
 *   - Source-gated: absent without a gmail source in ctx.connectorSources.
 *   - A copy fetched within max_age_minutes answers with ZERO API calls.
 *   - A stale copy re-fetches live and UPSERTS through ingestion.
 *   - message_id resolves to its thread from the synced mirror first,
 *     only hitting the API when the mirror doesn't know it.
 *   - Without credentials, a stale cache is returned honestly marked stale.
 */
import type { RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/sources/gmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/sources/gmail')>();
  return { ...actual, fetchGmailThreadDoc: vi.fn(), resolveThreadIdForMessage: vi.fn() };
});
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));
vi.mock('@/libs/retrieval/embedder', () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0))),
}));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { fetchGmailThreadDoc, resolveThreadIdForMessage } = await import('@/libs/sources/gmail');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { gmailTools } = await import('./gmailThread');

const ORG = 'org_gmail_tool';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);
const CREDS = { refreshToken: 'r', clientId: 'c', clientSecret: 's' };

function ctxFor(sources: string[] = ['gmail']): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: sources,
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function theTool(sources?: string[]): Invokable {
  const [t] = gmailTools(ctxFor(sources));
  return t as unknown as Invokable;
}

async function seedSource(slug = 'gmail'): Promise<number> {
  const [row] = await db
    .insert(knowledgeSourceSchema)
    .values({ orgId: ORG, slug, kind: 'plugin', configJson: { _connector: 'gmail' } })
    .returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedThreadDoc(sourceId: number, threadId: string, fetchedAt: string): Promise<number> {
  const [doc] = await db
    .insert(knowledgeDocumentSchema)
    .values({
      orgId: ORG,
      sourceId,
      externalId: `gmail-thread:${threadId}`,
      title: 'Proposal follow-up (2 messages)',
      contentHash: `hash-${threadId}-${fetchedAt}`,
      metadata: { kind: 'gmail-thread', threadId, messageCount: 2, fetchedAt },
    })
    .returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values([
    { documentId: doc!.id, orgId: ORG, chunkIdx: 0, content: 'From: client@x.com\nSubject: Proposal follow-up', contentTokens: 8, embedding: ZERO_VEC },
    { documentId: doc!.id, orgId: ORG, chunkIdx: 1, content: 'Sounds good, send the SOW.', contentTokens: 6, embedding: ZERO_VEC },
  ]);
  return doc!.id;
}

function liveThreadDoc(threadId: string) {
  return {
    externalId: `gmail-thread:${threadId}`,
    title: 'Proposal follow-up (3 messages)',
    content: 'From: client@x.com\n\nSounds good, send the SOW.\n\n---\n\nHere is the SOW.',
    lastModifiedAt: null,
    metadata: {
      kind: 'gmail-thread',
      threadId,
      messageCount: 3,
      latestMessageId: 'm3',
      historyId: 'h9',
      fetchedAt: new Date().toISOString(),
      from: 'client@x.com',
    },
  };
}

beforeEach(async () => {
  vi.mocked(fetchGmailThreadDoc).mockReset();
  vi.mocked(resolveThreadIdForMessage).mockReset();
  vi.mocked(getCredentialsForSource).mockReset();
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterAll(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('gating + input', () => {
  it('is absent without a gmail source, present with one', () => {
    expect(gmailTools(ctxFor(['zoom', 'hubspot']))).toHaveLength(0);
    expect(gmailTools(ctxFor(['gmail-founder'])).map(t => t.name)).toEqual(['get_gmail_thread']);
  });

  it('requires thread_id or message_id', async () => {
    await seedSource();

    expect(await theTool().invoke({})).toMatch(/thread_id or message_id/);
  });
});

describe('cache path', () => {
  it('answers from a fresh copy with zero API calls', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date().toISOString());

    const out = JSON.parse(await theTool().invoke({ thread_id: 't1' }));

    expect(out.source).toBe('cache');
    expect(out.messageCount).toBe(2);
    expect(out.content).toContain('Sounds good, send the SOW.');
    expect(fetchGmailThreadDoc).not.toHaveBeenCalled();
    expect(getCredentialsForSource).not.toHaveBeenCalled();
  });

  it('re-fetches past the TTL and upserts the grown thread', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date(Date.now() - 60 * 60_000).toISOString());
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchGmailThreadDoc).mockResolvedValue(liveThreadDoc('t1'));

    const out = JSON.parse(await theTool().invoke({ thread_id: 't1' }));

    expect(out.source).toBe('live');
    expect(out.upserted).toBe('updated');
    expect(out.messageCount).toBe(3);

    const [doc] = await db.select().from(knowledgeDocumentSchema);

    expect(doc!.metadata.messageCount).toBe(3);
  });

  it('honors a custom max_age_minutes and force_refresh', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date(Date.now() - 10 * 60_000).toISOString());
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchGmailThreadDoc).mockResolvedValue(liveThreadDoc('t1'));

    // 10-minute-old copy is fresh under the default 15 but stale under 5.
    const fresh = JSON.parse(await theTool().invoke({ thread_id: 't1' }));

    expect(fresh.source).toBe('cache');

    const stale = JSON.parse(await theTool().invoke({ thread_id: 't1', max_age_minutes: 5 }));

    expect(stale.source).toBe('live');

    const forced = JSON.parse(await theTool().invoke({ thread_id: 't1', force_refresh: true }));

    expect(forced.source).toBe('live');
  });
});

describe('message → thread resolution', () => {
  it('resolves from the synced message metadata without an API call', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date().toISOString());
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      sourceId,
      externalId: 'gmail:m2',
      title: 'Proposal follow-up',
      contentHash: 'hash-m2',
      metadata: { kind: 'gmail-message', from: 'client@x.com', threadId: 't1' },
    });

    const out = JSON.parse(await theTool().invoke({ message_id: 'm2' }));

    expect(out.source).toBe('cache');
    expect(resolveThreadIdForMessage).not.toHaveBeenCalled();
  });

  it('falls back to the live lookup when the mirror does not know the message', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date().toISOString());
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(resolveThreadIdForMessage).mockResolvedValue('t1');

    const out = JSON.parse(await theTool().invoke({ message_id: 'm-unknown' }));

    expect(out.source).toBe('cache');
    expect(resolveThreadIdForMessage).toHaveBeenCalledOnce();
  });
});

describe('degradation', () => {
  it('returns a stale copy honestly marked when credentials are missing', async () => {
    const sourceId = await seedSource();
    await seedThreadDoc(sourceId, 't1', new Date(Date.now() - 60 * 60_000).toISOString());
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);

    const out = JSON.parse(await theTool().invoke({ thread_id: 't1' }));

    expect(out.source).toBe('cache');
    expect(out.stale).toBe(true);
    expect(out.note).toMatch(/newer replies may be missing/);
  });

  it('says so when nothing is connected or the thread does not exist', async () => {
    expect(await theTool().invoke({ thread_id: 't1' })).toMatch(/No gmail source is connected/);

    await seedSource();
    vi.mocked(getCredentialsForSource).mockResolvedValue(CREDS);
    vi.mocked(fetchGmailThreadDoc).mockResolvedValue(null);

    expect(await theTool().invoke({ thread_id: 'ghost' })).toMatch(/no thread with id "ghost"/);
  });
});
