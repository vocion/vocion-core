/**
 * WHAT THIS TURN READ — the evidence a gate's `readThisTurn` checks.
 *
 * Request #226 (2026-09-29) was filed saying "today I have no way to revoke
 * access without deleting the file"; the product's capabilities page lists
 * link expiry and Kill. A filing may say it checked; it counts only when the
 * turn's own tool log shows the page was opened. Two readers agree:
 *
 *   - `ctx.turnReads`, appended by the tool-call recorder the moment a read
 *     returns (in-process: the same context lives for the whole turn);
 *   - the `tool_call` rows of this turn — its trace, its mission run, or its
 *     conversation since the person's last message — for a loop whose tools
 *     are called one request at a time (the container) or a row written a
 *     moment before this one.
 */

import type { RuntimeContext } from '@/services/agents/types';

/** The tools that read a source a gate can name, and the key each read carries. */
const READ_TOOLS = ['read_wiki_page', 'read_artifact'] as const;

/**
 * The key one successful read carries, or null for a call that read nothing.
 * @param tool - The tool's name.
 * @param input - Its arguments.
 * @param output - What it returned.
 */
export function readKeyOf(tool: string, input: Record<string, unknown> | null | undefined, output: string | null | undefined): string | null {
  const out = typeof output === 'string' ? output : '';
  if (tool === 'read_wiki_page') {
    // The page's own slug is on the receipt line; a miss says "No wiki page".
    if (!out || /^No wiki page/i.test(out)) {
      return null;
    }
    const slug = /\(slug ([^\s·)]+)/.exec(out)?.[1] ?? (typeof input?.slug === 'string' ? input.slug : null);
    return slug ? `wiki:${slug}` : null;
  }
  if (tool === 'read_artifact') {
    try {
      const id = Number((JSON.parse(out) as { id?: unknown }).id);
      return Number.isInteger(id) && id > 0 ? `artifact:${id}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Note a read on the turn, as it returns.
 * @param ctx - The turn.
 * @param tool - The tool.
 * @param input - Its arguments.
 * @param output - What it returned.
 */
export function noteTurnRead(ctx: RuntimeContext, tool: string, input: Record<string, unknown>, output: string): void {
  const key = readKeyOf(tool, input, output);
  if (key) {
    (ctx.turnReads ??= []).push(key);
  }
}

/**
 * Every source this turn has read: what the context noted, and what the
 * turn's tool_call rows say. Never throws; a log it cannot read adds nothing.
 * @param ctx - The turn.
 */
export async function readsThisTurn(ctx: RuntimeContext): Promise<string[]> {
  const reads = new Set(ctx.turnReads ?? []);
  try {
    const { and, desc, eq, gte, inArray, isNull } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { conversationMessageSchema, toolCallSchema } = await import('@/models/Schema');
    let scope;
    if (ctx.traceId) {
      scope = eq(toolCallSchema.langfuseTraceId, ctx.traceId);
    } else if (ctx.missionRunId) {
      scope = eq(toolCallSchema.missionRunId, ctx.missionRunId);
    } else if (ctx.conversationId) {
      const [last] = await db
        .select({ at: conversationMessageSchema.createdAt })
        .from(conversationMessageSchema)
        .where(and(eq(conversationMessageSchema.conversationId, ctx.conversationId), eq(conversationMessageSchema.role, 'user')))
        .orderBy(desc(conversationMessageSchema.id))
        .limit(1);
      scope = last ? and(eq(toolCallSchema.conversationId, ctx.conversationId), gte(toolCallSchema.createdAt, last.at)) : eq(toolCallSchema.conversationId, ctx.conversationId);
    }
    if (scope) {
      const rows = await db
        .select({ tool: toolCallSchema.tool, input: toolCallSchema.input, output: toolCallSchema.output })
        .from(toolCallSchema)
        .where(and(eq(toolCallSchema.orgId, ctx.orgId), inArray(toolCallSchema.tool, [...READ_TOOLS]), isNull(toolCallSchema.error), scope))
        .limit(200);
      for (const row of rows) {
        const key = readKeyOf(row.tool, row.input, row.output);
        if (key) {
          reads.add(key);
        }
      }
    }
  } catch {
    // The context's own notes still stand.
  }
  return [...reads];
}
