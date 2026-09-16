/**
 * The rail's server half (0094): thread search over titles + message content,
 * a thumb + note on one assistant turn that reaches the feedback queue, the
 * per-thread autonomy rung, the tail read that hands the client its message
 * ids, and the rail state row that must not clobber the last-viewed pointer.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { chatWidgetStateSchema, conversationMessageSchema, conversationSchema, feedbackJobSchema, userActivityEventSchema } = await import('@/models/Schema');
const svc = await import('@/services/ConversationService');
const widget = await import('@/services/ChatWidgetStateService');

const ORG = 'org_rail_test';
const USER = 'usr-rail-1';

beforeEach(async () => {
  await db.delete(feedbackJobSchema);
  await db.delete(userActivityEventSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
  await db.delete(chatWidgetStateSchema);
});

async function seedThread(title: string, turns: Array<[role: 'user' | 'assistant', content: string]>, opts: { scopeRef?: string } = {}) {
  const conv = await svc.createConversation({ orgId: ORG, agentSlug: 'revenue-lead', initialTitle: title, createdBy: USER, scopeRef: opts.scopeRef });
  const ids: number[] = [];
  for (const [role, content] of turns) {
    const m = await svc.appendMessage({ orgId: ORG, conversationId: conv.id, role, content });
    ids.push(m.id);
  }
  return { conv, ids };
}

describe('searchConversations', () => {
  it('finds threads by title and by message content, with a snippet for content hits', async () => {
    await seedThread('Northwind retainer', [['user', 'is northwind dead?'], ['assistant', 'The deal is Northwind – Continuous AI, $216K, Proposal Sent.']]);
    await seedThread('Lucent walkthrough', [['user', 'prep me for the walkthrough'], ['assistant', 'Peter Lutz confirmed; the MSA is still unsigned.']]);

    const byTitle = await svc.searchConversations({ orgId: ORG, q: 'northwind' });

    expect(byTitle.map(h => h.title)).toEqual(['Northwind retainer']);

    const byContent = await svc.searchConversations({ orgId: ORG, q: 'unsigned' });

    expect(byContent.map(h => h.title)).toEqual(['Lucent walkthrough']);
    expect(byContent[0]!.snippet).toContain('unsigned');
  });

  it('returns the most recent threads for a blank query and never a record-scoped thread', async () => {
    await seedThread('Everything thread', [['user', 'hello']]);
    await seedThread('Scoped thread', [['user', 'about this lead']], { scopeRef: 'contacts:1' });

    const hits = await svc.searchConversations({ orgId: ORG, q: '' });

    expect(hits.map(h => h.title)).toEqual(['Everything thread']);
  });

  it('is tenant-scoped', async () => {
    await seedThread('Ours', [['user', 'budget review']]);
    await svc.createConversation({ orgId: 'org_other', agentSlug: 'x', initialTitle: 'budget review theirs' });

    const hits = await svc.searchConversations({ orgId: ORG, q: 'budget' });

    expect(hits.map(h => h.title)).toEqual(['Ours']);
  });
});

describe('setMessageFeedback', () => {
  it('stores the thumb, queues a note for learning under source chat, and clears both on null', async () => {
    const { ids } = await seedThread('Feedback thread', [['user', 'q'], ['assistant', 'a']]);
    const assistantId = ids[1]!;

    const rated = await svc.setMessageFeedback({ orgId: ORG, messageId: assistantId, rating: 'down', note: 'the number was buried again', userId: USER });

    expect(rated?.feedbackRating).toBe('down');
    expect(rated?.feedbackNote).toBe('the number was buried again');
    expect(rated?.feedbackBy).toBe(USER);

    const jobs = await db.select().from(feedbackJobSchema).where(eq(feedbackJobSchema.orgId, ORG));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.source).toBe('chat');
    expect(jobs[0]!.externalId).toBe(`conversation_message:${assistantId}:feedback`);
    expect(jobs[0]!.payload).toMatchObject({ text: 'the number was buried again', agentSlug: 'revenue-lead', polarityHint: 'correct' });

    const cleared = await svc.setMessageFeedback({ orgId: ORG, messageId: assistantId, rating: null, userId: USER });

    expect(cleared?.feedbackRating).toBeNull();
    expect(cleared?.feedbackNote).toBeNull();
    expect(cleared?.feedbackAt).toBeNull();
  });

  it('a thumb without a note queues nothing, and re-rating updates rather than duplicating', async () => {
    const { ids } = await seedThread('Quiet thumb', [['user', 'q'], ['assistant', 'a']]);
    await svc.setMessageFeedback({ orgId: ORG, messageId: ids[1]!, rating: 'up', userId: USER });
    await svc.setMessageFeedback({ orgId: ORG, messageId: ids[1]!, rating: 'up', note: 'exactly right', userId: USER });
    await svc.setMessageFeedback({ orgId: ORG, messageId: ids[1]!, rating: 'up', note: 'exactly right, again', userId: USER });

    const jobs = await db.select().from(feedbackJobSchema).where(eq(feedbackJobSchema.orgId, ORG));

    expect(jobs).toHaveLength(1);
  });

  it('refuses a user turn and an unknown or foreign message', async () => {
    const { ids } = await seedThread('Roles', [['user', 'q'], ['assistant', 'a']]);

    await expect(svc.setMessageFeedback({ orgId: ORG, messageId: ids[0]!, rating: 'up' })).rejects.toThrow(/assistant turns only/);
    await expect(svc.setMessageFeedback({ orgId: 'org_other', messageId: ids[1]!, rating: 'up' })).resolves.toBeNull();
    await expect(svc.setMessageFeedback({ orgId: ORG, messageId: 999999, rating: 'up' })).resolves.toBeNull();
  });
});

describe('autonomy + tail', () => {
  it('defaults to ask, flips per thread, and tail returns the last rows oldest-first', async () => {
    const { conv, ids } = await seedThread('Autonomy', [['user', 'q'], ['assistant', 'a'], ['user', 'q2'], ['assistant', 'a2']]);

    expect(conv.autonomy).toBe('ask');

    const flipped = await svc.setConversationAutonomy({ orgId: ORG, id: conv.id, autonomy: 'act-within-bounds' });

    expect(flipped?.autonomy).toBe('act-within-bounds');
    await expect(svc.setConversationAutonomy({ orgId: 'org_other', id: conv.id, autonomy: 'ask' })).resolves.toBeNull();

    const tail = await svc.tailMessages({ orgId: ORG, conversationId: conv.id, limit: 2 });

    expect(tail.map(t => t.id)).toEqual([ids[2], ids[3]]);
    expect(tail.map(t => t.role)).toEqual(['user', 'assistant']);
  });
});

describe('rail state', () => {
  it('keeps the rail state and the last-viewed pointer from clobbering each other', async () => {
    const { conv } = await seedThread('Pointer target', [['user', 'hi']]);
    await widget.setWidgetState({ orgId: ORG, userId: USER, agentSlug: 'revenue-lead', conversationId: null });
    await widget.setRailState({ orgId: ORG, userId: USER, railWidth: 420, railOpen: true });
    await widget.setWidgetState({ orgId: ORG, userId: USER, agentSlug: 'pipeline-analyst', conversationId: conv.id });

    let row = await widget.getWidgetState({ orgId: ORG, userId: USER });

    expect(row).toMatchObject({ agentSlug: 'pipeline-analyst', conversationId: conv.id, railWidth: 420, railOpen: true });

    await widget.setRailState({ orgId: ORG, userId: USER, railOpen: false });
    row = await widget.getWidgetState({ orgId: ORG, userId: USER });

    expect(row).toMatchObject({ railWidth: 420, railOpen: false, agentSlug: 'pipeline-analyst' });
  });

  it('creates the row for a user who has never viewed a thread', async () => {
    const row = await widget.setRailState({ orgId: ORG, userId: 'usr-new', railWidth: 360 });

    expect(row.railWidth).toBe(360);
    expect(row.agentSlug).toBe('');
  });
});
