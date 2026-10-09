/**
 * WHAT AGENTS TRIED AND FAILED, this week — the failed tool calls that needed
 * a connection, per connector (`agent.connection_needed` on the adoption
 * stream, `user_activity_event`; no table of its own).
 *
 * Read by the connect plan, as a fact under each system ("Agents tried to use
 * it 3 times this week and couldn't"), and by the opening hint's connector
 * boost. Written from the agent loop as calls fail (`noteConnectionNeeded`).
 */

import { and, eq, gte } from 'drizzle-orm';
import { connectorNeededBy, saysConnectionMissing } from '@/libs/connect/connectionNeeded';
import { db } from '@/libs/DB';
import { userActivityEventSchema } from '@/models/Schema';

/** How far back "this week" reaches. */
export const TRIED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const CONNECTION_NEEDED_EVENT = 'agent.connection_needed';

/** One connector's failed attempts in the window. */
export type TriedAndFailed = { times: number; agents: string[]; tools: string[]; lastAt: Date };

/**
 * Failed calls that needed a connection, per connector slug, in this workspace.
 * @param orgId - The workspace.
 * @param now - Now (tests).
 */
export async function triedAndFailed(orgId: string, now: Date = new Date()): Promise<Map<string, TriedAndFailed>> {
  const rows = await db
    .select({ agentSlug: userActivityEventSchema.agentSlug, metadata: userActivityEventSchema.metadata, at: userActivityEventSchema.createdAt })
    .from(userActivityEventSchema)
    .where(and(eq(userActivityEventSchema.orgId, orgId), eq(userActivityEventSchema.eventType, CONNECTION_NEEDED_EVENT), gte(userActivityEventSchema.createdAt, new Date(now.getTime() - TRIED_WINDOW_MS))));
  const out = new Map<string, TriedAndFailed>();
  for (const row of rows) {
    const meta = row.metadata as { connector?: unknown; tool?: unknown } | null;
    if (typeof meta?.connector !== 'string') {
      continue;
    }
    const entry = out.get(meta.connector) ?? { times: 0, agents: [], tools: [], lastAt: row.at };
    entry.times += 1;
    if (row.agentSlug && !entry.agents.includes(row.agentSlug)) {
      entry.agents.push(row.agentSlug);
    }
    if (typeof meta.tool === 'string' && !entry.tools.includes(meta.tool)) {
      entry.tools.push(meta.tool);
    }
    if (row.at > entry.lastAt) {
      entry.lastAt = row.at;
    }
    out.set(meta.connector, entry);
  }
  return out;
}

/**
 * Record a tool call that could not run for want of a connection. Fire and
 * forget: it never slows or fails the turn it rides on.
 * @param who - Whose turn, where.
 * @param who.orgId - The workspace.
 * @param who.userId - The person (or the schedule) the turn ran for.
 * @param who.agentSlug - The agent that tried.
 * @param tool - The tool's name.
 * @param text - What it returned, or the error it threw.
 * @returns The connector it needed, or null when it did not fail for that.
 */
export async function noteConnectionNeeded(who: { orgId: string; userId?: string | null; agentSlug: string }, tool: string, text: string): Promise<string | null> {
  if (!saysConnectionMissing(text)) {
    return null;
  }
  try {
    // Only a system a person can connect: the web reader or a file import is never "needed".
    const { connectableConnectors } = await import('./recommendations');
    const connector = connectorNeededBy(tool, text, connectableConnectors());
    if (!connector) {
      return null;
    }
    const { track } = await import('@/services/adoption/track');
    await track({ orgId: who.orgId, userId: who.userId || 'system' }, CONNECTION_NEEDED_EVENT, { agentSlug: who.agentSlug, meta: { connector, tool } });
    return connector;
  } catch {
    return null;
  }
}
