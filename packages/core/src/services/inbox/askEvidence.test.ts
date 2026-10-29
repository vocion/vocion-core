/**
 * AN ASK ABOUT AN EMAIL CARRIES THE EMAIL.
 *
 * A Review input said a prospect's reply was "unreadable" and offered three
 * options; the thread held thirteen readable messages, and the person could
 * not check from the item. This pins what the ask's page reads for a thread
 * the ask names — against the real thread-state and thread-copy documents
 * Gmail sync and `get_gmail_thread` file: the other side's latest message in
 * full, quoted history cut, the rest of the thread as lines, the link, the
 * pending reply, and the CRM records by name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { threadFacts, threadStateDoc } from '@/libs/sources/mailThreadState';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: vi.fn(async () => null) }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { crmKeysOf, loadAskEvidence, threadPointerOf } = await import('./askEvidence');
const { parseThreadText, rejoinChunks, splitThread } = await import('@/services/mail/threadEvidence');
const { idsIn } = await import('@/services/inbox/pendingAction');
const { threadIdOfCitation } = await import('@/services/preview/evidenceLabels');

const ORG = 'org_ask_evidence';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);
const ROWAN = 'Rowan Pike <rowan@northwind.example>';
const DANA = 'Dana Reyes <dana@kestrel.example>';

/**
 * A message as `fetchGmailThreadDoc` writes it into the thread copy.
 * @param m - The message.
 * @param m.from - From.
 * @param m.to - To.
 * @param m.date - Date header.
 * @param m.body - Body.
 */
function section(m: { from: string; to: string; date: string; body: string }): string {
  return [`From: ${m.from}`, `To: ${m.to}`, `Date: ${m.date}`, 'Subject: Phase 2 priorities', m.body].join('\n');
}

const MESSAGES = [
  { from: ROWAN, to: DANA, date: 'Fri, 28 Aug 2026 09:00:00 -0700', body: 'Here are the two options for phase 2.\nHappy to walk through them.' },
  { from: DANA, to: ROWAN, date: 'Tue, 08 Sep 2026 11:00:00 -0700', body: 'Thanks, reviewing with the board.' },
  { from: DANA, to: ROWAN, date: 'Wed, 28 Oct 2026 16:20:00 -0700', body: 'Slow going on the editing pilot.\nA referral call on Friday may open a licensing deal.\n\nDana\n\nOn Tue, Sep 8, 2026 at 11:00 AM Dana Reyes <dana@kestrel.example> wrote:\n> Thanks, reviewing with the board.' },
];

async function seed(opts: { cacheEndsAt?: string } = {}) {
  const [crm] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot-deals', kind: 'plugin', configJson: { _connector: 'hubspot' } }).returning();
  const [mail] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning();
  await db.insert(knowledgeDocumentSchema).values([
    { orgId: ORG, sourceId: crm!.id, externalId: 'deals:7001', title: 'Kestrel Capital — Phase 2', contentHash: 'd-7001', metadata: { objectType: 'deals' } },
    { orgId: ORG, sourceId: crm!.id, externalId: 'contacts:9001', title: 'Dana Reyes', contentHash: 'c-9001', metadata: { objectType: 'contacts', primaryEmail: 'dana@kestrel.example' } },
  ]);
  const facts = threadFacts('t-42', MESSAGES.map((m, i) => ({ id: `m${i + 1}`, from: m.from, to: m.to, date: new Date(m.date), subject: 'Phase 2 priorities', snippet: m.body.split('\n')[0]!, bulk: false })), 'rowan@northwind.example')!;
  const state = threadStateDoc(facts, { state: 'needs_my_reply', category: 'sales', ask: 'A licensing call', labelledBy: 'rule' }, { connector: 'gmail', uri: 'https://mail.google.com/mail/u/rowan%40northwind.example/#all/t-42' });
  await db.insert(knowledgeDocumentSchema).values({ orgId: ORG, sourceId: mail!.id, externalId: state.externalId, title: state.title, uri: state.uri, contentHash: 'state-t-42', metadata: state.metadata as Record<string, unknown>, lastModifiedAt: state.lastModifiedAt });
  // The read-through copy, stored as overlapping chunks the way ingestion stores it.
  const content = MESSAGES.map(section).join('\n\n---\n\n');
  const cut = content.indexOf('Thanks, reviewing');
  const [copy] = await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: mail!.id,
    externalId: 'gmail-thread:t-42',
    title: 'Phase 2 priorities (3 messages)',
    contentHash: 'copy-t-42',
    metadata: { kind: 'gmail-thread', threadId: 't-42', messageCount: 3, latestMessageId: opts.cacheEndsAt ?? 'm3', fetchedAt: '2026-10-01T00:00:00.000Z' },
  }).returning();
  await db.insert(knowledgeChunkSchema).values([
    { documentId: copy!.id, orgId: ORG, chunkIdx: 0, content: content.slice(0, cut + 20), contentTokens: 100, embedding: ZERO_VEC },
    { documentId: copy!.id, orgId: ORG, chunkIdx: 1, content: content.slice(cut), contentTokens: 100, embedding: ZERO_VEC },
  ]);
}

afterEach(async () => {
  vi.useRealTimers();
  await db.delete(actionRunSchema);
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('what an ask says it is about', () => {
  it('reads a thread from a thread ref, a message ref or a Gmail link', () => {
    expect(threadPointerOf({ objectRefs: [{ type: 'deal', id: '7001' }, { type: 'gmail_thread', id: 't-42' }], contextUrl: null })).toEqual({ threadId: 't-42' });
    expect(threadPointerOf({ objectRefs: [{ type: 'gmail-thread', id: 'gmail-thread:t-42' }], contextUrl: null })).toEqual({ threadId: 't-42' });
    expect(threadPointerOf({ objectRefs: [{ type: 'gmail_message', id: 'm3' }], contextUrl: null })).toEqual({ messageId: 'm3' });
    expect(threadPointerOf({ objectRefs: [], contextUrl: 'https://mail.google.com/mail/u/0/#inbox/19a2b3c4d5e6f708' })).toEqual({ threadId: '19a2b3c4d5e6f708' });
    expect(threadPointerOf({ objectRefs: [{ type: 'deal', id: '7001' }], contextUrl: 'https://example.com/run/4' })).toBeNull();
  });

  it('reads CRM records in either spelling, once each', () => {
    expect(crmKeysOf([{ type: 'deal', id: '7001' }, { type: 'deals', id: 'deals:7001' }, { type: 'Contact', id: '9001' }, { type: 'hubspot_company', id: 'hubspot:companies:5' }, { type: 'gmail_thread', id: 't-42' }]))
      .toEqual(['deals:7001', 'contacts:9001', 'companies:5']);
  });
});

describe('reading a thread copy back', () => {
  it('drops the overlap the chunker repeats at a boundary', () => {
    expect(rejoinChunks(['The two options for', 'options for phase 2.'])).toBe('The two options for phase 2.');
    expect(rejoinChunks(['abc', 'def'])).toBe('abcdef');
  });

  it('shows the other side\'s latest message whole, quoted history cut, and the rest as lines', () => {
    const messages = parseThreadText(MESSAGES.map(section).join('\n\n---\n\n'));

    expect(messages).toHaveLength(3);

    const { latest, history } = splitThread(messages, 'rowan@northwind.example');

    expect(latest).toEqual({ from: DANA, at: '2026-10-28T23:20:00.000Z', body: 'Slow going on the editing pilot.\nA referral call on Friday may open a licensing deal.\n\nDana' });
    expect(history).toEqual([
      { from: ROWAN, at: '2026-08-28T16:00:00.000Z', line: 'Here are the two options for phase 2.' },
      { from: DANA, at: '2026-09-08T18:00:00.000Z', line: 'Thanks, reviewing with the board.' },
    ]);
  });
});

describe('the evidence on an ask\'s page', () => {
  it('reads the named thread from the cached copy, with its link, the pending reply and the records by name', async () => {
    await seed();
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'gmail.send', status: 'pending', input: { to: DANA, subject: 'Re: Phase 2 priorities', body: 'Good to hear from you, Dana.', threadId: 't-42', draft: true } }).returning();

    const evidence = await loadAskEvidence(ORG, { id: 1, objectRefs: [{ type: 'gmail_thread', id: 't-42' }, { type: 'deal', id: '7001' }], contextUrl: null }, { userId: null });

    expect(evidence.records).toEqual([{ type: 'deal', id: 'deals:7001', label: 'Kestrel Capital — Phase 2', noun: 'Deal' }]);
    expect(evidence.thread).toMatchObject({
      threadId: 't-42',
      subject: 'Phase 2 priorities',
      // Filed in the form Gmail 404s on; read back in the one it opens.
      href: 'https://mail.google.com/mail/?authuser=rowan%40northwind.example#all/t-42',
      counterpart: DANA,
      draft: { href: `/dashboard/inbox/proposal-${run!.id}`, to: DANA, subject: 'Re: Phase 2 priorities', body: 'Good to hear from you, Dana.', mode: 'draft' },
    });
    expect(evidence.thread!.latest!.body).toContain('A referral call on Friday may open a licensing deal.');
    expect(evidence.thread!.latest!.body).not.toContain('reviewing with the board');
    expect(evidence.thread!.history.map(m => m.line)).toEqual(['Here are the two options for phase 2.', 'Thanks, reviewing with the board.']);
  });

  it('finds the thread through a contact the ask names, and shows no draft when none is pending', async () => {
    // A live thread is one touched in the last 30 days, counted from now.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
    await seed();

    const evidence = await loadAskEvidence(ORG, { id: 1, objectRefs: [{ type: 'contact', id: '9001' }], contextUrl: null }, { userId: null });

    expect(evidence.thread).toMatchObject({ threadId: 't-42', draft: null });
    expect(evidence.records).toEqual([{ type: 'object', id: 'contacts:9001', label: 'Dana Reyes', noun: 'Contact' }]);
  });

  it('shows the last copy when the thread has grown and Gmail cannot be asked', async () => {
    await seed({ cacheEndsAt: 'm2' });

    const evidence = await loadAskEvidence(ORG, { id: 1, objectRefs: [{ type: 'gmail_thread', id: 't-42' }], contextUrl: null }, { userId: null });

    expect(evidence.thread!.latest!.from).toBe(DANA);
  });

  it('shows no thread for an ask that names none, and nothing for a thread never synced', async () => {
    await seed();

    await expect(loadAskEvidence(ORG, { id: 1, objectRefs: [{ type: 'deal', id: '7001' }], contextUrl: null }, { userId: null })).resolves.toMatchObject({ thread: null });
    await expect(loadAskEvidence(ORG, { id: 1, objectRefs: [{ type: 'gmail_thread', id: 't-404' }], contextUrl: null }, { userId: null })).resolves.toEqual({ thread: null, records: [], related: [] });
  });
});

describe('what a proposal names, for its neighbours and its chips', () => {
  it('reads the ids a proposal\'s input names, and the thread a citation names', () => {
    expect(idsIn({ threadId: 't-42', objectId: 7001, objectType: 'deals', to: 'dana@kestrel.example', id: 'x-1' })).toEqual(['t-42', '7001', 'x-1']);
    expect(threadIdOfCitation('gmail:thread:19a2b3c4d5e6f708')).toBe('19a2b3c4d5e6f708');
    expect(threadIdOfCitation('gmail-thread:t-42')).toBe('t-42');
    expect(threadIdOfCitation('gmail:Re: Phase 2')).toBeNull();
  });
});
