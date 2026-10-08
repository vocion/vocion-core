import type { StructuredToolInterface } from '@langchain/core/tools';
/**
 * The tools that hand an agent a client's records each leave an access-log
 * row — as the agent, on its run, for whom it was serving — once they have
 * actually read something: a Gmail thread, a Zoom transcript, a HubSpot
 * contact and its emails, a wiki page, the record the person is looking at,
 * and the calendar. Run through the tool-call recorder, the one seam every
 * harness shares, against PGlite.
 */
import type { RuntimeContext } from '../types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: vi.fn() }));
vi.mock('@/libs/retrieval/embedder', () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => Array.from({ length: 1536 }, () => 0))),
}));
vi.mock('@/libs/sources/gmail', async importOriginal => ({ ...(await importOriginal<object>()), fetchGmailThreadDoc: vi.fn() }));
vi.mock('@/libs/sources/googleAuth', () => ({ resolveGoogleAccessToken: vi.fn(async () => 'google-token') }));
vi.mock('./hubspotDirect', async importOriginal => ({ ...(await importOriginal<object>()), hubspotClientForCtx: vi.fn() }));
vi.mock('@/services/wiki/WikiService', async importOriginal => ({
  ...(await importOriginal<object>()),
  getWikiPage: vi.fn(),
  listWikiPages: vi.fn(async () => []),
}));

const { db } = await import('@/libs/DB');
const { accessEventSchema, knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { fetchGmailThreadDoc } = await import('@/libs/sources/gmail');
const { hubspotClientForCtx } = await import('./hubspotDirect');
const { getWikiPage } = await import('@/services/wiki/WikiService');
const { flushAccessLog, resetAccessLogForTests } = await import('@/services/access/accessLog');
const { withToolCallRecord } = await import('../toolCallRecord');
const { gmailTools } = await import('./gmailThread');
const { zoomTools } = await import('./zoomTranscript');
const { hubspotLeadsTools } = await import('./hubspotLeads');
const { readWikiPageTool } = await import('./wiki');
const { pageContextTool } = await import('./pageContext');
const { calendarTools } = await import('./calendarEvents');
const { declareReads } = await import('../toolReads');

const ORG = 'org_tool_reads_northwind';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);

function ctxFor(extra: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'usr-dana',
    agentSlug: 'revenue-lead',
    connectorSources: ['gmail', 'zoom', 'hubspot', 'google-calendar'],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
    conversationId: 77,
    ...extra,
  } as RuntimeContext;
}

/**
 * The tool as every harness runs it: wrapped by the recorder.
 * @param t - The tool.
 * @param ctx - The turn it runs in.
 */
function wrapped(t: unknown, ctx = ctxFor()) {
  return withToolCallRecord(t as StructuredToolInterface, ctx) as unknown as { invoke: (input: Record<string, unknown>) => Promise<string> };
}

function named(tools: unknown[], name: string): unknown {
  return (tools as Array<{ name: string }>).find(t => t.name === name);
}

async function reads() {
  await flushAccessLog();
  return db.select().from(accessEventSchema).where(eq(accessEventSchema.orgId, ORG));
}

async function seedSource(connector: string): Promise<number> {
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: connector, kind: 'plugin', configJson: { _connector: connector } }).returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function seedDoc(sourceId: number, externalId: string, metadata: Record<string, unknown>): Promise<number> {
  const [doc] = await db.insert(knowledgeDocumentSchema).values({ orgId: ORG, sourceId, externalId, title: 'Northwind renewal call', contentHash: `hash-${externalId}`, metadata }).returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values({ documentId: doc!.id, orgId: ORG, chunkIdx: 0, content: 'Renewal terms agreed.', contentTokens: 4, embedding: ZERO_VEC });
  return doc!.id;
}

beforeEach(async () => {
  resetAccessLogForTests();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(fetchGmailThreadDoc).mockReset();
  await db.delete(accessEventSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const AS_THE_AGENT = { actorKind: 'agent', actorId: 'revenue-lead', onBehalfOf: 'usr-dana', runKind: 'conversation', runId: '77' };

describe('get_gmail_thread', () => {
  it('a thread read from the mirror is a view of its document', async () => {
    const sourceId = await seedSource('gmail');
    const docId = await seedDoc(sourceId, 'gmail-thread:t1', { kind: 'gmail-thread', threadId: 't1', messageCount: 2, fetchedAt: new Date().toISOString() });
    await wrapped(named(gmailTools(ctxFor()), 'get_gmail_thread')).invoke({ thread_id: 't1' });

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'document', recordId: String(docId), via: 'tool:get_gmail_thread' })]);
  });

  it('a thread fetched live is a view of the document it was indexed as', async () => {
    await seedSource('gmail');
    vi.mocked(getCredentialsForSource).mockResolvedValue({ refreshToken: 'r', clientId: 'c', clientSecret: 's' });
    vi.mocked(fetchGmailThreadDoc).mockResolvedValue({
      externalId: 'gmail-thread:t2',
      title: 'Proposal follow-up',
      content: 'From: buyer@northwind.example\n\nSend the SOW.',
      lastModifiedAt: null,
      metadata: { kind: 'gmail-thread', threadId: 't2', messageCount: 1, fetchedAt: new Date().toISOString() },
    } as never);
    await wrapped(named(gmailTools(ctxFor()), 'get_gmail_thread')).invoke({ thread_id: 't2' });
    const [doc] = await db.select({ id: knowledgeDocumentSchema.id }).from(knowledgeDocumentSchema).where(eq(knowledgeDocumentSchema.externalId, 'gmail-thread:t2'));

    expect((await reads()).map(r => [r.recordKind, r.recordId])).toEqual([['document', String(doc!.id)]]);
  });

  it('a thread nobody has writes no row', async () => {
    await seedSource('gmail');
    await wrapped(named(gmailTools(ctxFor()), 'get_gmail_thread')).invoke({ thread_id: 'missing' });

    expect(await reads()).toHaveLength(0);
  });
});

describe('get_zoom_transcript', () => {
  it('a transcript from the mirror is a view of its document', async () => {
    const sourceId = await seedSource('zoom');
    const docId = await seedDoc(sourceId, 'zoom:uuid-1', { kind: 'zoom-recording', meetingId: 12345, hasTranscript: true });
    await wrapped(named(zoomTools(ctxFor()), 'get_zoom_transcript')).invoke({ meeting: 'uuid-1' });

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'document', recordId: String(docId), via: 'tool:get_zoom_transcript' })]);
  });
});

describe('HubSpot contact reads', () => {
  function hubspotAnswers() {
    const client = {
      get: vi.fn(async (path: string) => path.includes('/associations/emails')
        ? { ok: true, data: { results: [{ toObjectId: 'e1' }] } }
        : { ok: true, data: { results: [] } }),
      post: vi.fn(async (path: string) => path.includes('/emails/batch/read')
        ? { ok: true, data: { results: [{ id: 'e1', properties: { hs_email_subject: 'Renewal terms', hs_email_text: 'Here are the terms.', hs_timestamp: '2026-10-01T10:00:00Z', hs_email_direction: 'INCOMING_EMAIL' } }] } }
        : { ok: true, data: { results: [{ id: '501', properties: { email: 'buyer@northwind.example', firstname: 'Avery' } }] } }),
    };
    vi.mocked(hubspotClientForCtx).mockResolvedValue({ ok: true, client } as never);
  }

  it('hubspot_get_contact is a view of the contact HubSpot answered with, by its id, however it was asked for', async () => {
    hubspotAnswers();
    await wrapped(named(hubspotLeadsTools(ctxFor()), 'hubspot_get_contact')).invoke({ identifier: 'buyer@northwind.example' });

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'hubspot_contact', recordId: '501', via: 'tool:hubspot_get_contact' })]);
  });

  it('hubspot_contact_emails is a view of that contact, saying how many emails it handed over', async () => {
    hubspotAnswers();
    await wrapped(named(hubspotLeadsTools(ctxFor()), 'hubspot_contact_emails')).invoke({ identifier: '501' });

    expect(await reads()).toEqual([expect.objectContaining({ recordKind: 'hubspot_contact', recordId: '501', detail: { emails: 1 }, via: 'tool:hubspot_contact_emails' })]);
  });

  it('a contact HubSpot does not have writes no row', async () => {
    vi.mocked(hubspotClientForCtx).mockResolvedValue({ ok: true, client: { get: vi.fn(async () => ({ ok: true, data: { results: [] } })), post: vi.fn(async () => ({ ok: true, data: { results: [] } })) } } as never);
    await wrapped(named(hubspotLeadsTools(ctxFor()), 'hubspot_get_contact')).invoke({ identifier: 'nobody@northwind.example' });

    expect(await reads()).toHaveLength(0);
  });
});

describe('read_wiki_page', () => {
  it('is a view of the page\'s artifact', async () => {
    vi.mocked(getWikiPage).mockResolvedValue({ id: 31, slug: 'founder-voice', title: 'Founder voice', md: 'Plain words.', summary: '', version: 2, updatedAt: new Date(), createdAt: new Date(), lastAuthorKind: 'human', href: '/dashboard/wiki/founder-voice', tags: [] } as never);
    await wrapped(readWikiPageTool(ctxFor())).invoke({ slug: 'founder-voice' });

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'artifact', recordId: '31', via: 'tool:read_wiki_page' })]);
  });

  it('a page that does not exist writes no row', async () => {
    vi.mocked(getWikiPage).mockResolvedValue(null);
    await wrapped(readWikiPageTool(ctxFor())).invoke({ slug: 'nothing-here' });

    expect(await reads()).toHaveLength(0);
  });
});

describe('page_context', () => {
  it('is a view of the record the person is looking at', async () => {
    const ctx = ctxFor({ pageContext: { path: '/dashboard/objects/12', record: { type: 'object', id: '12', label: 'Northwind renewal' } } as never });
    await wrapped(pageContextTool(ctx), ctx).invoke({});

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'object', recordId: '12', via: 'tool:page_context' })]);
  });

  it('a page about no record writes no row', async () => {
    const ctx = ctxFor({ pageContext: { path: '/dashboard' } as never });
    await wrapped(pageContextTool(ctx), ctx).invoke({});

    expect(await reads()).toHaveLength(0);
  });
});

describe('calendar_events', () => {
  it('a window read live is a search of the calendar, with how many events came back', async () => {
    await seedSource('google-calendar');
    vi.mocked(getCredentialsForSource).mockResolvedValue({ refreshToken: 'r' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [
      { id: 'a', summary: 'Northwind renewal', start: { dateTime: '2026-10-07T16:00:00Z' }, end: { dateTime: '2026-10-07T16:30:00Z' } },
      { id: 'b', summary: 'Kestrel intro', start: { dateTime: '2026-10-07T18:00:00Z' }, end: { dateTime: '2026-10-07T18:30:00Z' } },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await wrapped(calendarTools(ctxFor())[0]).invoke({});

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'search', recordKind: 'calendar_event', recordId: null, detail: { hits: 2 }, via: 'tool:calendar_events' })]);
  });

  it('a calendar that could not be read writes no row', async () => {
    await seedSource('google-calendar');
    vi.mocked(getCredentialsForSource).mockResolvedValue({ refreshToken: 'r' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await wrapped(calendarTools(ctxFor())[0]).invoke({});

    expect(await reads()).toHaveLength(0);
  });
});

describe('a declared default', () => {
  it('is written by the recorder for a declared tool, without the tool noting anything', async () => {
    const { tool } = await import('@langchain/core/tools');
    const { z } = await import('zod');
    const t = declareReads(tool(async () => 'the issue', { name: 'tracker_read_issue', schema: z.object({ key: z.string() }) }), { kind: 'tracker_issue', idArg: 'key' });
    await wrapped(t).invoke({ key: 'NW-123' });

    expect(await reads()).toEqual([expect.objectContaining({ ...AS_THE_AGENT, action: 'view', recordKind: 'tracker_issue', recordId: 'NW-123', via: 'tool:tracker_read_issue' })]);
  });
});
