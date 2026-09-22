/**
 * The idle sweep: a quiet conversation ends once, raises `conversation.ended`
 * once, and a thread picked up again ends again under a new key.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { conversationMessageSchema, conversationSchema, eventLogSchema } = await import('@/models/Schema');
const { appendMessage, createConversation } = await import('@/services/ConversationService');
const { readIdleMinutes, runSweepIdleConversationsJob } = await import('./sweepIdleConversations');

const ORG = 'org_sweep';
const NOW = new Date('2026-09-20T12:00:00.000Z');

async function conversationLastTouched(minutesAgo: number, title = 'How do we price onboarding?'): Promise<number> {
  const conv = await createConversation({ orgId: ORG, agentSlug: 'wiki-researcher', initialTitle: title, createdBy: 'user:1' });
  await appendMessage({ orgId: ORG, conversationId: conv.id, role: 'user', content: 'hello', userId: 'user:1' });
  await db.update(conversationSchema).set({ updatedAt: new Date(NOW.getTime() - minutesAgo * 60_000) }).where(eq(conversationSchema.id, conv.id));
  return conv.id;
}

beforeEach(async () => {
  await db.delete(eventLogSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

afterAll(async () => {
  await db.delete(eventLogSchema);
  await db.delete(conversationMessageSchema);
  await db.delete(conversationSchema);
});

describe('readIdleMinutes', () => {
  it('defaults to 30 and refuses a window under five minutes', () => {
    expect(readIdleMinutes(undefined)).toBe(30);
    expect(readIdleMinutes(2)).toBe(30);
    expect(readIdleMinutes('45')).toBe(45);
  });
});

describe('sweep-idle-conversations', () => {
  it('ends the quiet threads, leaves the live ones, and raises one event each', async () => {
    const quiet = await conversationLastTouched(45);
    const live = await conversationLastTouched(5, 'Still talking');
    // An empty conversation (opened, nothing said) is not a thread to debrief.
    const empty = await createConversation({ orgId: ORG, agentSlug: 'wiki-researcher' });
    await db.update(conversationSchema).set({ updatedAt: new Date(NOW.getTime() - 90 * 60_000) }).where(eq(conversationSchema.id, empty.id));

    const out = await runSweepIdleConversationsJob(ORG, { idleMinutes: 30 }, NOW);

    expect(out).toMatchObject({ idleMinutes: 30, ended: 1, announced: 1, conversationIds: [quiet] });

    const [ended] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, quiet));
    const [still] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, live));

    expect(ended!.endedAt).toEqual(NOW);
    expect(still!.endedAt).toBeNull();

    const events = await db.select().from(eventLogSchema);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'conversation.ended', invokedBy: 'job:sweep-idle-conversations' });
    expect(events[0]!.payload).toMatchObject({
      conversationId: quiet,
      agentSlug: 'wiki-researcher',
      title: 'How do we price onboarding?',
      summary: 'How do we price onboarding?',
      messageCount: 1,
      endedBy: 'idle',
      endedAt: NOW.toISOString(),
    });
  });

  it('is idempotent, and a thread picked up again ends again later under a new key', async () => {
    const id = await conversationLastTouched(45);

    await runSweepIdleConversationsJob(ORG, {}, NOW);
    const second = await runSweepIdleConversationsJob(ORG, {}, NOW);

    expect(second.ended).toBe(0);
    expect(await db.select().from(eventLogSchema)).toHaveLength(1);

    // A new message reopens it (`appendMessage` clears `ended_at`) …
    await appendMessage({ orgId: ORG, conversationId: id, role: 'user', content: 'one more thing', userId: 'user:1' });
    const [reopened] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, id));

    expect(reopened!.endedAt).toBeNull();

    // … and an hour later it ends again, as a second event.
    await db.update(conversationSchema).set({ updatedAt: new Date(NOW.getTime() + 10 * 60_000) }).where(eq(conversationSchema.id, id));
    const later = await runSweepIdleConversationsJob(ORG, {}, new Date(NOW.getTime() + 60 * 60_000));

    expect(later).toMatchObject({ ended: 1, announced: 1 });
    expect(await db.select().from(eventLogSchema)).toHaveLength(2);
  });

  it('is org-scoped', async () => {
    await conversationLastTouched(45);

    const out = await runSweepIdleConversationsJob('org_other', {}, NOW);

    expect(out.ended).toBe(0);
  });
});
