/**
 * A CONVERSATION'S OBJECTIVE — started, read, stopped and resumed.
 *
 * The row keeps which objective and whether the person stopped it
 * (`conversation.objective`); what is done is read live from the plugin's
 * setup every time (`setupStateForOrg`), so the strip a reload draws, the one
 * another device draws and the opening hint of the next visit agree, and a
 * step done anywhere (the Connectors page, another conversation) is done here.
 * See `libs/objectives/objective.ts`.
 *
 * Tenant scoping: every read and write is keyed on the workspace (`org_id`)
 * and the conversation's id; the resumable one is also the person's own.
 */

import type { ConversationObjective, ObjectiveView } from '@/libs/objectives/objective';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { objectiveView, readObjective, setupObjectiveFor } from '@/libs/objectives/objective';
import { conversationSchema } from '@/models/Schema';
import { setupStateForOrg } from '@/services/plugins/setupState';

/**
 * The objective a conversation carries, as the person sees it now; null when
 * it carries none, or its plugin is no longer on.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function currentObjective(orgId: string, conversationId: number): Promise<ObjectiveView | null> {
  const [row] = await db
    .select({ objective: conversationSchema.objective })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId)))
    .limit(1);
  const objective = readObjective(row?.objective);
  if (!objective) {
    return null;
  }
  return viewOf(orgId, conversationId, objective);
}

async function viewOf(orgId: string, conversationId: number, objective: ConversationObjective, setups?: Awaited<ReturnType<typeof setupStateForOrg>>): Promise<ObjectiveView | null> {
  const all = setups ?? await setupStateForOrg(orgId);
  const setup = all.find(s => s.plugin === objective.plugin) ?? null;
  return objectiveView(conversationId, objective, setup ? { name: setup.name, steps: setup.steps } : null);
}

/**
 * Start setting up a plugin in this conversation — when a turn there reads
 * the setup (`describe_setup`). The plugin is the one the agent named, or the
 * only one left to set up; with two left and none named nothing starts, so a
 * strip never names the wrong one. Starting again is a no-op that keeps when
 * it began, and resumes a stopped one: the person asked again.
 * @param opts - What started it.
 * @param opts.orgId - The workspace.
 * @param opts.conversationId - The conversation.
 * @param opts.plugin - The plugin the agent said the person is setting up.
 * @returns The plugin now being set up, or null.
 */
export async function startSetupObjective(opts: { orgId: string; conversationId: number; plugin?: string | null }): Promise<string | null> {
  const setups = await setupStateForOrg(opts.orgId);
  const plugin = setupObjectiveFor(setups, opts.plugin);
  if (!plugin) {
    return null;
  }
  const [row] = await db
    .select({ objective: conversationSchema.objective })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.conversationId)))
    .limit(1);
  if (!row) {
    return null;
  }
  const was = readObjective(row.objective);
  const now = new Date().toISOString();
  const next: ConversationObjective = was && was.plugin === plugin
    ? { ...was, state: 'running', ...(was.state === 'stopped' ? { changedAt: now } : {}) }
    : { kind: 'setup', plugin, state: 'running', startedAt: now };
  if (was && JSON.stringify(was) === JSON.stringify(next)) {
    return plugin;
  }
  await db
    .update(conversationSchema)
    .set({ objective: next })
    .where(and(eq(conversationSchema.orgId, opts.orgId), eq(conversationSchema.id, opts.conversationId)));
  return plugin;
}

/**
 * Stop it, or take it back up: the person's Stop and Resume on the strip.
 * Nothing else changes — the steps done stay done, an open Decision stays
 * open — and Resume undoes Stop.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 * @param state - `stopped` or `running`.
 */
export async function setObjectiveState(orgId: string, conversationId: number, state: ConversationObjective['state']): Promise<ObjectiveView | null> {
  const [row] = await db
    .select({ objective: conversationSchema.objective })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId)))
    .limit(1);
  const was = readObjective(row?.objective);
  if (!was) {
    return null;
  }
  const next: ConversationObjective = { ...was, state, changedAt: new Date().toISOString() };
  await db
    .update(conversationSchema)
    .set({ objective: next })
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId)));
  return viewOf(orgId, conversationId, next);
}

/**
 * The setups this person started in a conversation here, by plugin: the most
 * recent conversation for each. The opening hint (`services/chat/openingHints.ts`)
 * reads it to offer "Resume setting up … →" for any that is still unfinished.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
export async function startedSetups(orgId: string, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: conversationSchema.id, objective: conversationSchema.objective })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, orgId), isNotNull(conversationSchema.objective), eq(conversationSchema.createdBy, userId)))
    .orderBy(desc(conversationSchema.updatedAt))
    .limit(20);
  const out = new Map<string, number>();
  for (const row of rows) {
    const o = readObjective(row.objective);
    if (o && !out.has(o.plugin)) {
      out.set(o.plugin, row.id);
    }
  }
  return out;
}
