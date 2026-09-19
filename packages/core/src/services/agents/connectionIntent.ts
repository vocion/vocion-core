/**
 * The intent a connect card leaves behind.
 *
 * Resume v1 re-sent the question and let the model ask again. It works,
 * because the tool surface is rebuilt per turn — but it costs a second model
 * turn and trusts the model to ask itself the same thing twice, and a slightly
 * different question gets a slightly different answer with nothing on screen
 * saying why.
 *
 * It never needed to guess. At the moment the stub fired, the model had
 * already decided exactly what to call and with what: `list_events` with the
 * window it had worked out. That IS the intent. Saved here and replayed once
 * the grant lands, no re-asking happens at all — and the consent stays minimal
 * for the same reason, because the scopes asked for came from that one tool
 * rather than from a fixed per-connector list.
 */

import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { connectionIntentSchema } from '@/models/Schema';

/** How long an intent stays replayable. An intent is about a conversation in progress. */
const INTENT_TTL_MS = 30 * 60 * 1000;

export type ConnectionIntent = {
  id: number;
  connectorSlug: string;
  tool: string;
  args: Record<string, unknown>;
  scopes: string[];
  message: string | null;
  conversationId: number | null;
};

/**
 * Remember what the model was about to do.
 *
 * Failure here must not fail the turn: the card is the point, and an intent is
 * an optimisation over re-asking. So this returns null rather than throwing —
 * the worst case is resume v1's behaviour, which is still correct.
 * @param input - The call the stub intercepted.
 * @param input.orgId - Tenant.
 * @param input.userId - Who the replay runs as.
 * @param input.conversationId - The thread, when there is one.
 * @param input.connectorSlug - The connector that was missing.
 * @param input.tool - The tool the model chose.
 * @param input.args - What it chose to call it with.
 * @param input.scopes - What the card asked consent for.
 * @param input.message - The question behind the turn, as a fallback.
 */
export async function saveIntent(input: {
  orgId: string;
  userId: string;
  conversationId?: number | null;
  connectorSlug: string;
  tool: string;
  args: Record<string, unknown>;
  scopes: string[];
  message?: string | null;
}): Promise<number | null> {
  try {
    const [row] = await db
      .insert(connectionIntentSchema)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        connectorSlug: input.connectorSlug,
        tool: input.tool,
        args: input.args,
        scopes: input.scopes.join(' '),
        message: input.message ?? null,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS),
      })
      .returning({ id: connectionIntentSchema.id });
    return row?.id ?? null;
  } catch (err) {
    console.error('[connectionIntent] could not save the intent; resume falls back to re-asking', {
      connectorSlug: input.connectorSlug,
      tool: input.tool,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The live intent this person left in this thread for this connector, if any.
 *
 * Scoped to the user as well as the org, because the replay runs a tool that
 * resolves a personal credential: an intent another member left is not this
 * person's to resume, even in a thread they can both see.
 * @param input - Which intent to look for.
 * @param input.orgId - Tenant.
 * @param input.userId - Who is resuming.
 * @param input.conversationId - The thread.
 * @param input.connectorSlug - The connector that was just connected.
 */
export async function pendingIntent(input: {
  orgId: string;
  userId: string;
  conversationId?: number | null;
  connectorSlug?: string;
}): Promise<ConnectionIntent | null> {
  const where = [
    eq(connectionIntentSchema.orgId, input.orgId),
    eq(connectionIntentSchema.userId, input.userId),
    isNull(connectionIntentSchema.consumedAt),
  ];
  if (input.conversationId !== undefined && input.conversationId !== null) {
    where.push(eq(connectionIntentSchema.conversationId, input.conversationId));
  }
  if (input.connectorSlug) {
    where.push(eq(connectionIntentSchema.connectorSlug, input.connectorSlug));
  }
  const [row] = await db
    .select()
    .from(connectionIntentSchema)
    .where(and(...where))
    .orderBy(desc(connectionIntentSchema.createdAt), desc(connectionIntentSchema.id))
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    id: row.id,
    connectorSlug: row.connectorSlug,
    tool: row.tool,
    args: row.args,
    scopes: row.scopes === '' ? [] : row.scopes.split(' '),
    message: row.message,
    conversationId: row.conversationId,
  };
}

/**
 * Claim an intent so it is replayed once and not twice.
 *
 * Returns whether this caller got it. Two tabs finishing the same consent, or
 * a callback the browser retried, would otherwise each run the read.
 * @param id - The intent to claim.
 */
export async function claimIntent(id: number): Promise<boolean> {
  const claimed = await db
    .update(connectionIntentSchema)
    .set({ consumedAt: new Date() })
    .where(and(eq(connectionIntentSchema.id, id), isNull(connectionIntentSchema.consumedAt)))
    .returning({ id: connectionIntentSchema.id });
  return claimed.length > 0;
}

/** Drop intents nobody came back for. */
export async function sweepExpiredIntents(): Promise<void> {
  await db.delete(connectionIntentSchema).where(lt(connectionIntentSchema.expiresAt, new Date(Date.now() - INTENT_TTL_MS)));
}
