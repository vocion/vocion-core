/**
 * ONE VISIT SETTLES THEM ALL. A prospect's reply raised an ask, a reply draft
 * and a deal-stage change, each on its own page with no word of the others.
 * This pins the join: the open decisions naming the same thread or record,
 * by id only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { matchableIds, relatedOpenItems } = await import('./relatedItems');

const ORG = 'org_related_items';
const THREAD = '19a2b3c4d5e6f708';
const DEAL = '61000000001';

afterEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(askSchema);
});

describe('the ids worth matching', () => {
  it('reads bare ids out of record keys, and drops ones too short to mean one thing', () => {
    expect(matchableIds([THREAD, `deals:${DEAL}`, `hubspot:deals:${DEAL}`, 'contacts:42', 'gmail-thread:t-1'])).toEqual([THREAD, DEAL]);
  });
});

describe('the other open decisions about the same thread or record', () => {
  it('names the ask and the stage change beside the reply draft, and leaves out itself, decided ones and strangers', async () => {
    const [draft] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'gmail.send', status: 'pending', input: { to: 'Dana Reyes <dana@kestrel.example>', subject: 'Re: Phase 2', body: 'Hi Dana.', threadId: THREAD }, proposal: { evidence: [`gmail:thread:${THREAD}`, `hubspot:deals:${DEAL}`] } }).returning();
    const [stage] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', status: 'pending', input: { objectType: 'deals', objectId: DEAL, properties: { dealstage: 'nurture' } } }).returning();
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', status: 'done', input: { objectType: 'deals', objectId: DEAL, properties: { amount: '1' } } });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', status: 'pending', input: { objectType: 'deals', objectId: '62000000002', properties: {} } });
    const [ask] = await db.insert(askSchema).values({ orgId: ORG, kind: 'input', title: 'Reply to Dana and decide where Phase 2 stands', status: 'open', objectRefs: [{ type: 'gmail_thread', id: THREAD }] }).returning();
    await db.insert(askSchema).values({ orgId: ORG, kind: 'input', title: 'Answered already', status: 'done', objectRefs: [{ type: 'deal', id: DEAL }] });

    const related = await relatedOpenItems(ORG, [THREAD, `hubspot:deals:${DEAL}`], { kind: 'proposal', id: draft!.id });

    expect(related.map(r => r.href)).toEqual([`/dashboard/inbox/${ask!.id}`, `/dashboard/inbox/proposal-${stage!.id}`]);
    expect(related[0]!.title).toBe('Reply to Dana and decide where Phase 2 stands');

    const fromAsk = await relatedOpenItems(ORG, [THREAD], { kind: 'ask', id: ask!.id });

    expect(fromAsk.map(r => r.href)).toEqual([`/dashboard/inbox/proposal-${draft!.id}`]);
  });

  it('finds nothing for ids too short to match', async () => {
    await expect(relatedOpenItems(ORG, ['t-1', 'deals:42'], { kind: 'ask', id: 1 })).resolves.toEqual([]);
  });
});
