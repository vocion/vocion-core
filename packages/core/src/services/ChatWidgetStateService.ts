/**
 * ChatWidgetStateService — the shared "last viewed conversation" pointer
 * for a user within an org. One row per (orgId, userId): which agent +
 * conversation they last VIEWED, not necessarily messaged in. Both the
 * full-page chat and the floating chat bubble read/write this so either
 * surface resumes exactly where the other left off.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { chatWidgetStateSchema } from '@/models/Schema';

export async function getWidgetState(opts: { orgId: string; userId: string }) {
  const [row] = await db
    .select()
    .from(chatWidgetStateSchema)
    .where(and(eq(chatWidgetStateSchema.orgId, opts.orgId), eq(chatWidgetStateSchema.userId, opts.userId)));
  return row ?? null;
}

export async function setWidgetState(opts: {
  orgId: string;
  userId: string;
  agentSlug: string;
  conversationId: number | null;
}) {
  const [row] = await db
    .insert(chatWidgetStateSchema)
    .values({
      orgId: opts.orgId,
      userId: opts.userId,
      agentSlug: opts.agentSlug,
      conversationId: opts.conversationId,
    })
    .onConflictDoUpdate({
      target: [chatWidgetStateSchema.orgId, chatWidgetStateSchema.userId],
      set: { agentSlug: opts.agentSlug, conversationId: opts.conversationId },
    })
    .returning();
  return row!;
}

/**
 * Remember how the rail was left (0094): width in px and open/closed. Only
 * the fields given are written, so the last-viewed pointer and the rail
 * state never clobber each other. Creates the row with a placeholder agent
 * when the person has never viewed a thread — the pointer fills in later.
 * @param opts
 * @param opts.orgId
 * @param opts.userId
 * @param opts.railWidth
 * @param opts.railOpen
 */
export async function setRailState(opts: {
  orgId: string;
  userId: string;
  railWidth?: number | null;
  railOpen?: boolean | null;
}) {
  const set: { railWidth?: number | null; railOpen?: boolean | null } = {};
  if (opts.railWidth !== undefined) {
    set.railWidth = opts.railWidth;
  }
  if (opts.railOpen !== undefined) {
    set.railOpen = opts.railOpen;
  }
  const [row] = await db
    .insert(chatWidgetStateSchema)
    .values({
      orgId: opts.orgId,
      userId: opts.userId,
      agentSlug: '',
      conversationId: null,
      ...set,
    })
    .onConflictDoUpdate({
      target: [chatWidgetStateSchema.orgId, chatWidgetStateSchema.userId],
      set,
    })
    .returning();
  return row!;
}
