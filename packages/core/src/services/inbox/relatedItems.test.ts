/**
 * ONE VISIT SETTLES THEM ALL. A prospect's reply raised an ask, a reply draft
 * and a deal-stage change, each on its own page with no word of the others.
 * This pins the join: the open decisions about the same SUBJECT — the record
 * an action declares it is about, or the records an ask names — matched by
 * exact record key. A shared sequence or a sender is not a subject, and a
 * deal id inside a longer id is not the same deal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { proposalSubjectKeys, relatedOpenItems } = await import('./relatedItems');

const ORG = 'org_related_items';
const THREAD = '19a2b3c4d5e6f708';
const DEAL = '640012';

afterEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
});

describe('what a proposal is about', () => {
  it('is what its action declares: the thread a reply answers, the record an update writes, the contact an enrollment enrolls', () => {
    expect(proposalSubjectKeys({ actionId: 'gmail.send', input: { to: 'dana@kestrel.example', body: 'Hi', threadId: THREAD } })).toEqual([`gmail-thread:${THREAD}`]);
    expect(proposalSubjectKeys({ actionId: 'hubspot.update', input: { objectType: 'deals', objectId: DEAL, properties: {} } })).toEqual([`deals:${DEAL}`]);
    expect(proposalSubjectKeys({ actionId: 'personalization.enroll', input: { contactRef: 'contacts:9001', sequenceId: 'seq-1' } })).toEqual(['contacts:9001']);
    expect(proposalSubjectKeys({ actionId: 'no.such.action', input: { threadId: THREAD } })).toEqual([]);
  });
});

describe('the other open decisions about the same subject', () => {
  it('names the ask and the stage change beside the reply draft, and leaves out itself, decided ones and strangers', async () => {
    const [draft] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'gmail.send', status: 'pending', input: { to: 'Dana Reyes <dana@kestrel.example>', subject: 'Re: Phase 2', body: 'Hi Dana.', threadId: THREAD } }).returning();
    const [stage] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', status: 'pending', input: { objectType: 'deals', objectId: DEAL, properties: { dealstage: 'nurture' } } }).returning();
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', status: 'done', input: { objectType: 'deals', objectId: DEAL, properties: { amount: '1' } } });
    const [ask] = await db.insert(askSchema).values({ orgId: ORG, kind: 'input', title: 'Reply to Dana and decide where Phase 2 stands', status: 'open', objectRefs: [{ type: 'gmail_thread', id: THREAD }, { type: 'deal', id: DEAL }] }).returning();
    await db.insert(askSchema).values({ orgId: ORG, kind: 'input', title: 'Answered already', status: 'done', objectRefs: [{ type: 'deal', id: DEAL }] });

    const related = await relatedOpenItems(ORG, [`gmail-thread:${THREAD}`, `deals:${DEAL}`], { kind: 'proposal', id: draft!.id });

    expect(related.map(r => r.href)).toEqual([`/dashboard/inbox/${ask!.id}`, `/dashboard/inbox/proposal-${stage!.id}`]);
    expect(related[0]!.title).toBe('Reply to Dana and decide where Phase 2 stands');

    const fromAsk = await relatedOpenItems(ORG, [`gmail-thread:${THREAD}`], { kind: 'ask', id: ask!.id });

    expect(fromAsk.map(r => r.href)).toEqual([`/dashboard/inbox/proposal-${draft!.id}`]);
  });

  it('never relates on a substring of an id, a shared sequence or sender, or the input\'s text', async () => {
    // Deal 640012 sits inside 16400123; two enrollments share a sequence and
    // a sender; a reply mentions the deal id in its body.
    await db.insert(actionRunSchema).values([
      { orgId: ORG, actionId: 'hubspot.update', status: 'pending', input: { objectType: 'deals', objectId: '16400123', properties: {} } },
      { orgId: ORG, actionId: 'personalization.enroll', status: 'pending', input: { contactRef: 'contacts:9002', sequenceId: 'seq-1', senderEmail: 'rowan@northwind.example' } },
      { orgId: ORG, actionId: 'gmail.send', status: 'pending', input: { to: 'a@kestrel.example', body: `About deal ${DEAL}.` } },
    ]);
    await db.insert(askSchema).values({ orgId: ORG, kind: 'input', title: 'Another deal', status: 'open', objectRefs: [{ type: 'deal', id: '16400123' }] });

    await expect(relatedOpenItems(ORG, [`deals:${DEAL}`], { kind: 'ask', id: 0 })).resolves.toEqual([]);
    await expect(relatedOpenItems(ORG, proposalSubjectKeys({ actionId: 'personalization.enroll', input: { contactRef: 'contacts:9001', sequenceId: 'seq-1', senderEmail: 'rowan@northwind.example' } }), { kind: 'proposal', id: 0 })).resolves.toEqual([]);
  });
});
