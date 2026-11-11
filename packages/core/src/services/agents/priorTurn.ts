/**
 * WHAT THE LAST TURN LEFT BEHIND, for sizing the next one (`effort.ts`, `contextFloor`).
 *
 * Read off the record, never off words: how many of the previous turn's tool
 * calls failed, and the last exchanges as the classifier reads them.
 */
import { and, desc, eq, gt, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationMessageSchema, toolCallSchema } from '@/models/Schema';

/**
 * The tool calls that failed in this conversation's previous turn: from the
 * person's message before this one onward. Zero for a new conversation, and
 * zero when it cannot be read (the floor only ever raises).
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function priorTurnErrors(orgId: string, conversationId: number | undefined): Promise<number> {
  if (typeof conversationId !== 'number') {
    return 0;
  }
  try {
    // This turn's message is usually stored already, so the previous turn starts at the second newest.
    const asked = await db.select({ at: conversationMessageSchema.createdAt })
      .from(conversationMessageSchema)
      .where(and(eq(conversationMessageSchema.conversationId, conversationId), eq(conversationMessageSchema.role, 'user')))
      .orderBy(desc(conversationMessageSchema.id))
      .limit(2);
    const since = asked[1]?.at;
    if (!since) {
      return 0;
    }
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), eq(toolCallSchema.conversationId, conversationId), gt(toolCallSchema.createdAt, since), isNotNull(toolCallSchema.error), ne(toolCallSchema.error, '')));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The last exchanges as the effort read sees them: who said what, newest last, so "try again"
 * is read as the work it continues.
 * @param history - The conversation so far, oldest first.
 * @param turns - How many messages to keep.
 */
export function recentExchange(history: ReadonlyArray<{ role: string; content: string }> | undefined, turns = 4): string | undefined {
  const recent = (history ?? []).filter(t => (t.role === 'user' || t.role === 'assistant') && t.content.trim()).slice(-turns);
  if (recent.length === 0) {
    return undefined;
  }
  return recent.map(t => `${t.role === 'user' ? 'Person' : 'Assistant'}: ${t.content.trim().slice(0, 450)}`).join('\n');
}
