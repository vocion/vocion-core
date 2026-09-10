import type { ChatInbound, ChatJoin, ChatReplyTarget, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { chatChannelBindingSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { preflightCheck } from '@/services/BudgetService';
import { appendMessage, createConversation, latestConversationForScope, listMessages, toHistoryTurns } from '@/services/ConversationService';

/**
 * ChatSurfaceService — from a normalised inbound chat message to an agent reply
 * (approval item 025, phase 1: mention or DM in, reply out, one bound channel,
 * NO approve/reject buttons in the chat client).
 *
 * Tenancy is derived from the channel binding, never from the sender: a Slack
 * user id is an external identity that authorises nothing. Anything the agent
 * proposes lands in the review queue for a human to approve in Vocion, where
 * the identity is already known — which is exactly why this slice needs no new
 * authorisation semantics.
 */

export type ChatChannelBinding = typeof chatChannelBindingSchema.$inferSelect;

/** Feature flag — the webhook 501s without it. */
export function slackEventsEnabled(): boolean {
  return process.env.VOCION_SLACK_EVENTS === '1';
}

/**
 * Exact channel first, then the team's `*` catch-all (how DMs find an agent).
 * @param surface - Adapter id.
 * @param teamId - Platform workspace id, if any.
 * @param channelId - Platform channel id.
 */
export async function resolveBinding(surface: string, teamId: string | null, channelId: string): Promise<ChatChannelBinding | null> {
  const teamMatch = teamId ? or(eq(chatChannelBindingSchema.teamId, teamId), isNull(chatChannelBindingSchema.teamId)) : isNull(chatChannelBindingSchema.teamId);
  const [exact] = await db.select().from(chatChannelBindingSchema).where(and(eq(chatChannelBindingSchema.surface, surface), eq(chatChannelBindingSchema.channelId, channelId), teamMatch)).orderBy(desc(chatChannelBindingSchema.teamId)).limit(1);
  if (exact) {
    return exact;
  }
  if (!teamId) {
    return null;
  }
  const [catchAll] = await db.select().from(chatChannelBindingSchema).where(and(eq(chatChannelBindingSchema.surface, surface), eq(chatChannelBindingSchema.channelId, '*'), eq(chatChannelBindingSchema.teamId, teamId))).limit(1);
  return catchAll ?? null;
}

/**
 * Bindings for an org.
 * @param orgId - Tenant.
 */
export async function listBindings(orgId: string): Promise<ChatChannelBinding[]> {
  return db.select().from(chatChannelBindingSchema).where(eq(chatChannelBindingSchema.orgId, orgId)).orderBy(desc(chatChannelBindingSchema.createdAt));
}

/**
 * Bind a channel to an agent. The (surface, channel, team) key is unique across
 * orgs — a channel cannot answer for two tenants.
 * @param opts - Binding.
 * @param opts.orgId
 * @param opts.surface
 * @param opts.teamId
 * @param opts.channelId
 * @param opts.agentSlug
 * @param opts.displayName
 * @param opts.iconUrl
 * @param opts.createdBy
 */
export async function createBinding(opts: { orgId: string; surface: string; teamId?: string | null; channelId: string; agentSlug: string; displayName?: string | null; iconUrl?: string | null; createdBy?: string }): Promise<ChatChannelBinding> {
  const [row] = await db.insert(chatChannelBindingSchema).values({
    orgId: opts.orgId,
    surface: opts.surface,
    teamId: opts.teamId ?? null,
    channelId: opts.channelId,
    agentSlug: opts.agentSlug,
    displayName: opts.displayName ?? null,
    iconUrl: opts.iconUrl ?? null,
    createdBy: opts.createdBy ?? null,
  }).returning();
  return row!;
}

/**
 * The channel + thread a reply goes to, wearing the binding's persona if it has
 * one. Absent persona fields are left off the object rather than set to null,
 * so an adapter — and the payload it builds — is unchanged for the bindings
 * that predate personas.
 * @param binding - The resolved binding.
 * @param inbound - The message being answered.
 */
export function replyTargetFor(binding: Pick<ChatChannelBinding, 'displayName' | 'iconUrl'>, inbound: Pick<ChatInbound, 'channelId' | 'threadRef'>): ChatReplyTarget {
  return {
    channelId: inbound.channelId,
    threadRef: inbound.threadRef,
    ...(binding.displayName ? { displayName: binding.displayName } : {}),
    ...(binding.iconUrl ? { iconUrl: binding.iconUrl } : {}),
  };
}

/**
 * Remove a binding. Org-scoped.
 * @param orgId - Tenant.
 * @param id - Binding id.
 * @returns Whether a row was removed.
 */
export async function deleteBinding(orgId: string, id: number): Promise<boolean> {
  const rows = await db.delete(chatChannelBindingSchema)
    .where(and(eq(chatChannelBindingSchema.orgId, orgId), eq(chatChannelBindingSchema.id, id)))
    .returning({ id: chatChannelBindingSchema.id });
  return rows.length > 0;
}

/**
 * The one line a channel hears when the bot is invited. Short on purpose: who
 * answers here, and how to ask. It names the agent, never claims to be a
 * person, and starts no thread.
 * @param binding - The binding that will answer this channel.
 */
function introductionText(binding: Pick<ChatChannelBinding, 'agentSlug' | 'displayName'>): string {
  const name = binding.displayName ?? binding.agentSlug;
  return `I'm ${name}, a Vocion agent. I answer here as \`${binding.agentSlug}\` — mention me and I'll reply in the thread.`;
}

/**
 * The bot was added to a channel. Introduce whoever answers there so a fresh
 * channel is never met with silence — the workspace catch-all binding is what
 * answers a channel nobody has bound, so this is the same resolution the first
 * mention would get, said out loud one message early.
 *
 * Nothing is created and nothing runs: no agent turn, no conversation, no
 * budget spend. An unbound channel (no exact binding, no catch-all) stays
 * silent rather than advertising an install that cannot answer.
 * @param adapter - The surface the join came from.
 * @param join - The normalised join event.
 */
export async function handleJoined(adapter: ChatSurfaceAdapter, join: ChatJoin): Promise<
  | { outcome: 'unbound' }
  | { outcome: 'introduced'; orgId: string; agentSlug: string; text: string }
  | { outcome: 'failed'; orgId: string; agentSlug: string; error: string }
> {
  const binding = await resolveBinding(join.surface, join.teamId, join.channelId);
  if (!binding) {
    return { outcome: 'unbound' };
  }
  const { orgId, agentSlug } = binding;
  const target: ChatReplyTarget = {
    channelId: join.channelId,
    ...(binding.displayName ? { displayName: binding.displayName } : {}),
    ...(binding.iconUrl ? { iconUrl: binding.iconUrl } : {}),
  };
  const text = introductionText(binding);
  try {
    await adapter.reply(target, text);
    return { outcome: 'introduced', orgId, agentSlug, text };
  } catch (error) {
    return { outcome: 'failed', orgId, agentSlug, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Dependency seam so the handler is testable without a model or a network. */
export type ChatHandlerDeps = {
  runAgent: typeof runAgentDeep;
  preflight: typeof preflightCheck;
};

const defaultDeps: ChatHandlerDeps = { runAgent: runAgentDeep, preflight: preflightCheck };

/**
 * The whole phase-1 slice, end to end: bind → budget → conversation → run → reply.
 * Returns what happened so the route and the tests can see it; never throws on
 * the agent path — a failure becomes a short reply and a return value.
 * @param adapter - The surface the message came from.
 * @param inbound - The normalised message.
 * @param deps - Injectable collaborators.
 */
export async function handleInbound(adapter: ChatSurfaceAdapter, inbound: ChatInbound, deps: ChatHandlerDeps = defaultDeps): Promise<
  | { outcome: 'unbound' }
  | { outcome: 'over_budget'; agentSlug: string }
  | { outcome: 'replied'; orgId: string; agentSlug: string; conversationId: number; text: string }
  | { outcome: 'failed'; orgId: string; agentSlug: string; error: string }
> {
  const binding = await resolveBinding(inbound.surface, inbound.teamId, inbound.channelId);
  if (!binding) {
    return { outcome: 'unbound' };
  }
  const { orgId, agentSlug } = binding;
  const target = replyTargetFor(binding, inbound);

  const budget = await deps.preflight({ orgId, agentSlug });
  if (!budget.ok) {
    await adapter.reply(target, `This agent is over its ${budget.reason.replace('hard_', '').replace('_exceeded', '')} budget for the period. A workspace admin can raise the cap in Vocion.`).catch(() => {});
    return { outcome: 'over_budget', agentSlug };
  }

  // One conversation per thread, per sender. The external id is the sender's
  // Slack user id — an actor label for the record, not an authorised identity.
  const scopeRef = `${inbound.surface}:${inbound.channelId}:${inbound.threadRef}`;
  const createdBy = `${inbound.surface}:${inbound.externalUserId}`;
  let conversation = await latestConversationForScope({ orgId, scopeRef, createdBy });
  if (!conversation) {
    conversation = await createConversation({ orgId, agentSlug, createdBy, scopeRef, initialTitle: inbound.text.slice(0, 80) });
  }
  const conversationId = conversation.id;
  const history = toHistoryTurns(await listMessages({ orgId, conversationId }));
  await appendMessage({ orgId, conversationId, role: 'user', content: inbound.text, userId: createdBy });

  try {
    const result = await deps.runAgent({
      orgId,
      agentSlug,
      message: inbound.text,
      userId: createdBy,
      conversationId,
      conversationHistory: history,
    });
    const text = result.response.trim() || '(no reply)';
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text });
    await adapter.reply(target, text);
    return { outcome: 'replied', orgId, agentSlug, conversationId, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await adapter.reply(target, 'Something went wrong on my side; a person can see the details in Vocion.').catch(() => {});
    return { outcome: 'failed', orgId, agentSlug, error: message };
  }
}
