/**
 * A PERSON IN A CONVERSATION IS ANSWERED, NOT ENROLLED.
 *
 * Proposal 8017 put a one-to-one reply in front of its reviewer shaped like a
 * HubSpot sequence ("Send 1"). The sequence kind is for multi-touch outbound
 * to prospects who are not in a thread; this pins the gate that refuses one
 * for a contact the mailbox shows in a live thread, and the reply it names
 * instead — against the real thread-state documents Gmail sync files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { threadFacts, threadStateDoc } from '@/libs/sources/mailThreadState';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { personalizationEnrollAction, activeConversationOf, conversationRefusal } = await import('./personalization-enroll');
const { findReplyThread } = await import('@/services/mail/replyThread');

const ORG = 'org_thread_gate';

async function seed(opts: { lastMessageAt: Date }) {
  const [crm] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot-contacts', kind: 'plugin', configJson: { _connector: 'hubspot' } }).returning();
  const [mail] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning();
  await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: crm!.id,
    externalId: 'contacts:9001',
    title: 'Dana Reyes',
    contentHash: 'c-9001',
    metadata: { objectType: 'contacts', primaryEmail: 'dana@kestrel.example' },
  });
  const facts = threadFacts('t-42', [
    { id: 'm1', from: 'Rowan Pike <rowan@northwind.example>', to: 'dana@kestrel.example', date: new Date(opts.lastMessageAt.getTime() - 86_400_000), subject: 'Phase 2 priorities', snippet: 'The two options.', bulk: false },
    { id: 'm2', from: 'Dana Reyes <dana@kestrel.example>', to: 'rowan@northwind.example', date: opts.lastMessageAt, subject: 'Re: Phase 2 priorities', snippet: 'Can we get everyone on a call?', bulk: false },
  ], 'rowan@northwind.example')!;
  const doc = threadStateDoc(facts, { state: 'needs_my_reply', category: 'customer', ask: 'A call next week', labelledBy: 'rule' }, { connector: 'gmail', uri: 'https://mail.google.com/mail/u/0/#all/t-42' });
  await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: mail!.id,
    externalId: doc.externalId,
    title: doc.title,
    uri: doc.uri,
    contentHash: 'thread-t-42',
    metadata: doc.metadata as Record<string, unknown>,
    lastModifiedAt: doc.lastModifiedAt,
  });
}

const input = {
  leadBriefId: 1,
  contactRef: 'contacts:9001',
  contactName: 'Dana Reyes',
  sequenceId: 'seq-1',
  sequenceName: 'Inbound ebook follow-up',
  senderEmail: 'rowan@northwind.example',
  sends: [{ step: 1, day: 0, subject: 'Hello', body: 'Hi Dana.' }, { step: 2, day: 3, subject: 'Following up', body: 'Any thoughts?' }],
};

afterEach(async () => {
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('the sequence gate', () => {
  it('refuses a sequence for a contact in an active thread, and names the reply to propose instead', async () => {
    await seed({ lastMessageAt: new Date(Date.now() - 2 * 86_400_000) });

    const refusal = await personalizationEnrollAction.precheck!({ orgId: ORG }, input);

    expect(refusal).toMatch(/^NOTHING WAS SAVED\. Dana Reyes is already in an active email thread, "Phase 2 priorities"/);
    expect(refusal).toContain('propose gmail.send with { threadId: "t-42", to: "Dana Reyes <dana@kestrel.example>", subject: "Re: Phase 2 priorities", draft: true }');
  });

  it('lets a sequence through for a prospect whose last thread went quiet more than 30 days ago', async () => {
    await seed({ lastMessageAt: new Date(Date.now() - 45 * 86_400_000) });

    await expect(activeConversationOf(ORG, 'contacts:9001')).resolves.toBeNull();
  });

  it('lets a sequence through for a contact the mailbox has never written with', async () => {
    await expect(activeConversationOf(ORG, 'contacts:404')).resolves.toBeNull();
  });

  it('describes the reply as the right kind for anyone in conversation', () => {
    expect(personalizationEnrollAction.description).toMatch(/NOT in an active email thread/);
    expect(conversationRefusal('Dana', { threadId: 't', subject: 'Re: Hi', counterpart: 'd@x.example', lastMessageAt: null })).toContain('subject: "Re: Hi"');
  });
});

describe('the thread a reply draft answers', () => {
  it('is found by the id the draft named, with its last messages oldest first', async () => {
    await seed({ lastMessageAt: new Date('2026-10-08T18:14:00.000Z') });

    const thread = await findReplyThread(ORG, { threadId: 't-42' });

    expect(thread).toMatchObject({ threadId: 't-42', subject: 'Phase 2 priorities', mailbox: 'rowan@northwind.example', href: 'https://mail.google.com/mail/u/0/#all/t-42', matchedBy: 'id' });
    expect(thread!.messages.map(m => m.snippet)).toEqual(['The two options.', 'Can we get everyone on a call?']);
  });

  it('is found by recipient and Re: subject when the draft named no id, and not for a new email', async () => {
    await seed({ lastMessageAt: new Date('2026-10-08T18:14:00.000Z') });

    await expect(findReplyThread(ORG, { to: 'Dana Reyes <dana@kestrel.example>', subject: 'RE: Phase 2 Priorities' })).resolves.toMatchObject({ threadId: 't-42', matchedBy: 'subject' });
    await expect(findReplyThread(ORG, { to: 'dana@kestrel.example', subject: 'Phase 2 priorities' })).resolves.toBeNull();
    await expect(findReplyThread(ORG, { to: 'dana@kestrel.example', subject: 'Re: Something else' })).resolves.toBeNull();
  });
});
