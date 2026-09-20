/**
 * `sweep-idle-conversations` — the built-in automation job that decides a
 * conversation is over and raises `conversation.ended` for it.
 *
 *   automations/conversation-sweep.yaml
 *     when: { schedule: '*\/15 * * * *' }
 *     do:   { job: sweep-idle-conversations, input: { idleMinutes: 30 } }
 *
 * A chat has no "close" button, and a person rarely says goodbye; a
 * conversation is over when nobody has said anything for a while. The job
 * reads every open conversation (`ended_at` null, at least one message) whose
 * last message is older than the window, stamps `ended_at`, and raises one
 * `conversation.ended` per conversation, deduped on the id plus the last
 * message time — so a thread picked up again (which clears `ended_at`, see
 * `appendMessage`) ends again later under a new key, and a thread the sweep
 * already ended is never announced twice. A debrief automation subscribes to
 * the event; this job is the mechanism, the plugin says what to do with it.
 *
 * Idempotent and cheap: one indexed read, one update per ended thread. A
 * workspace that never schedules it simply never raises the event.
 */

import type { ConversationEndedPayload } from '@/services/EventService';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationSchema } from '@/models/Schema';

export const SWEEP_IDLE_CONVERSATIONS_JOB = 'sweep-idle-conversations';

/** The default window. Long enough that a person fetching coffee has not left; short enough that the debrief reads the thread the same hour. */
export const DEFAULT_IDLE_MINUTES = 30;

export type SweepIdleConversationsInput = {
  /** Minutes since the last message before a conversation counts as over. Default 30, minimum 5. */
  idleMinutes?: number;
  /** At most this many conversations per run. Default 200. */
  limit?: number;
};

export type SweepIdleConversationsResult = {
  idleMinutes: number;
  /** Conversations stamped `ended_at` this run. */
  ended: number;
  /** Of those, how many raised an event (the rest were deduped — already announced). */
  announced: number;
  conversationIds: number[];
};

/**
 * Read `idleMinutes` off the automation's input, clamped so a typo cannot end
 * every live thread.
 * @param raw
 */
export function readIdleMinutes(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 5 ? Math.floor(n) : DEFAULT_IDLE_MINUTES;
}

/**
 * @param orgId - The workspace to sweep.
 * @param rawInput - The automation's `do.input`.
 * @param now - Test seam.
 */
export async function runSweepIdleConversationsJob(orgId: string, rawInput: Record<string, unknown>, now: Date = new Date()): Promise<SweepIdleConversationsResult> {
  const input = rawInput as SweepIdleConversationsInput;
  const idleMinutes = readIdleMinutes(input.idleMinutes);
  const limit = typeof input.limit === 'number' && input.limit > 0 ? Math.min(Math.floor(input.limit), 1000) : 200;
  const cutoff = new Date(now.getTime() - idleMinutes * 60_000);

  const idle = await db
    .select({
      id: conversationSchema.id,
      agentSlug: conversationSchema.agentSlug,
      title: conversationSchema.title,
      surface: conversationSchema.surface,
      messageCount: conversationSchema.messageCount,
      updatedAt: conversationSchema.updatedAt,
    })
    .from(conversationSchema)
    .where(and(
      eq(conversationSchema.orgId, orgId),
      isNull(conversationSchema.endedAt),
      gt(conversationSchema.messageCount, 0),
      lt(conversationSchema.updatedAt, cutoff),
    ))
    .limit(limit);

  if (idle.length === 0) {
    return { idleMinutes, ended: 0, announced: 0, conversationIds: [] };
  }

  const { CONVERSATION_ENDED, emitEvent } = await import('@/services/EventService');
  let announced = 0;
  for (const conv of idle) {
    // `updated_at` is `$onUpdate`, so stamping `ended_at` moves it; the
    // payload and the key carry the last message time as it was.
    const lastMessageAt = conv.updatedAt;
    await db.update(conversationSchema).set({ endedAt: now }).where(and(eq(conversationSchema.id, conv.id), isNull(conversationSchema.endedAt)));
    const payload: ConversationEndedPayload = {
      conversationId: conv.id,
      agentSlug: conv.agentSlug,
      title: conv.title,
      surface: conv.surface,
      messageCount: conv.messageCount,
      lastMessageAt: lastMessageAt.toISOString(),
      endedBy: 'idle',
      summary: conv.title,
      endedAt: now.toISOString(),
    };
    const res = await emitEvent({
      orgId,
      type: CONVERSATION_ENDED,
      payload,
      dedupeKey: `${CONVERSATION_ENDED}:${conv.id}:${lastMessageAt.getTime()}`,
      invokedBy: `job:${SWEEP_IDLE_CONVERSATIONS_JOB}`,
    });
    if (!res.deduped) {
      announced += 1;
    }
  }
  return { idleMinutes, ended: idle.length, announced, conversationIds: idle.map(c => c.id) };
}
