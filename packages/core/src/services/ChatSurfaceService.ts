import type { ChatInbound, ChatJoin, ChatPostRef, ChatReplyTarget, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import type { SlackThreadContext } from '@/services/chat/slackThread';
import process from 'node:process';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { chatPermalink } from '@/libs/surfaces/slackRead';
import { agentSchema, chatChannelBindingSchema, projectSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { preflightCheck } from '@/services/BudgetService';
import { classifyFeedback, feedbackNote } from '@/services/chat/feedbackSignal';
import { withPageContext } from '@/services/chat/pageContext';
import { recordSlackPost, threadAlreadyNoticed } from '@/services/chat/slackPosts';
import { buildSlackThreadContext, scopeGapSentence, threadPageContext } from '@/services/chat/slackThread';
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

/** A name and an avatar to post under. Never an identity — presentation only. */
export type ChatPersona = { displayName?: string | null; iconUrl?: string | null };

/**
 * Which face a reply wears: the binding's persona if the channel sets one,
 * else the answering agent's own persona, else nothing — the app's name and
 * icon, exactly as before personas existed.
 *
 * A persona resolves as a unit rather than field by field: a binding that
 * sets only a name keeps the app's icon rather than borrowing the agent's,
 * because half of one face on half of another is a third person nobody
 * configured.
 * @param binding - Persona fields from the resolved channel binding.
 * @param agent - Persona from the agent that is answering, if it has one.
 */
export function resolvePersona(binding: ChatPersona, agent?: ChatPersona | null): ChatPersona {
  if (binding.displayName || binding.iconUrl) {
    return binding;
  }
  if (agent && (agent.displayName || agent.iconUrl)) {
    return agent;
  }
  return {};
}

/**
 * The channel + thread a reply goes to, wearing the resolved persona. Absent
 * persona fields are left off the object rather than set to null, so an
 * adapter — and the payload it builds — is unchanged for the bindings and
 * agents that carry no persona.
 * @param binding - The resolved binding.
 * @param inbound - The message being answered.
 * @param agentPersona - The answering agent's persona, if it has one.
 */
export function replyTargetFor(binding: Pick<ChatChannelBinding, 'displayName' | 'iconUrl'>, inbound: Pick<ChatInbound, 'channelId' | 'threadRef'>, agentPersona?: ChatPersona | null): ChatReplyTarget {
  const persona = resolvePersona(binding, agentPersona);
  return {
    channelId: inbound.channelId,
    threadRef: inbound.threadRef,
    ...(persona.displayName ? { displayName: persona.displayName } : {}),
    ...(persona.iconUrl ? { iconUrl: persona.iconUrl } : {}),
  };
}

/**
 * The persona of the agent that will answer, if it has one. One narrow read:
 * the chat surface needs the face, not the agent row.
 * @param orgId - Tenant.
 * @param agentSlug - The answering agent.
 */
export async function agentPersona(orgId: string, agentSlug: string): Promise<ChatPersona | null> {
  const [row] = await db.select({ persona: agentSchema.persona })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, agentSlug)))
    .limit(1);
  return row?.persona ?? null;
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
  const persona = resolvePersona(binding, await agentPersona(orgId, agentSlug));
  const target: ChatReplyTarget = {
    channelId: join.channelId,
    ...(persona.displayName ? { displayName: persona.displayName } : {}),
    ...(persona.iconUrl ? { iconUrl: persona.iconUrl } : {}),
  };
  const text = introductionText({ agentSlug, displayName: persona.displayName ?? null });
  try {
    const posted = await adapter.reply(target, text);
    await recordSlackPost({ orgId, projectId: orgId, teamId: join.teamId, channelId: join.channelId, ts: posted?.ts ?? '', kind: 'introduction', agentSlug, text });
    return { outcome: 'introduced', orgId, agentSlug, text };
  } catch (error) {
    return { outcome: 'failed', orgId, agentSlug, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Dependency seam so the handler is testable without a model or a network. */
export type ChatHandlerDeps = {
  runAgent: typeof runAgentDeep;
  preflight: typeof preflightCheck;
  /** Builds the thread context. Injected so the tests need no Slack. */
  buildThreadContext: typeof buildSlackThreadContext;
  /** Permalink to the message being answered, for feedback provenance. */
  permalink: (opts: { channelId: string; messageTs: string }) => Promise<string | null>;
};

const defaultDeps: ChatHandlerDeps = {
  runAgent: runAgentDeep,
  preflight: preflightCheck,
  buildThreadContext: buildSlackThreadContext,
  permalink: opts => chatPermalink(opts, process.env.SLACK_BOT_TOKEN),
};

/**
 * The workspace a channel answers for — part of the context, and the scope of the reply.
 * @param orgId
 */
async function workspaceFor(orgId: string): Promise<{ orgId: string; name?: string; slug?: string }> {
  const [row] = await db.select({ name: projectSchema.name, slug: projectSchema.slug })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return { orgId, ...(row?.name ? { name: row.name } : {}), ...(row?.slug ? { slug: row.slug } : {}) };
}

/**
 * The whole phase-1 slice, end to end: bind → budget → conversation → run → reply.
 * Returns what happened so the route and the tests can see it; never throws on
 * the agent path — a failure becomes a short reply and a return value.
 * @param adapter - The surface the message came from.
 * @param inbound - The normalised message.
 * @param overrides - Injectable collaborators; anything omitted uses the default.
 */
export async function handleInbound(adapter: ChatSurfaceAdapter, inbound: ChatInbound, overrides: Partial<ChatHandlerDeps> = {}): Promise<
  | { outcome: 'unbound' }
  | { outcome: 'over_budget'; agentSlug: string }
  | { outcome: 'replied'; orgId: string; agentSlug: string; conversationId: number; text: string; thread?: SlackThreadContext }
  | { outcome: 'failed'; orgId: string; agentSlug: string; error: string }
> {
  const deps: ChatHandlerDeps = { ...defaultDeps, ...overrides };
  const binding = await resolveBinding(inbound.surface, inbound.teamId, inbound.channelId);
  if (!binding) {
    return { outcome: 'unbound' };
  }
  const { orgId, agentSlug } = binding;
  const target = replyTargetFor(binding, inbound, await agentPersona(orgId, agentSlug));

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
  // The thread's own sender is the one asking — a Slack thread is already
  // per-sender (`latestConversationForScope` keys on `created_by`).
  const history = toHistoryTurns(await listMessages({ orgId, conversationId, requestedBy: createdBy }));
  await appendMessage({ orgId, conversationId, role: 'user', content: inbound.text, userId: createdBy });

  // Where the person is, on this surface: the channel, the post they replied
  // to, who else is in the thread, and the workspace we answer for. Built
  // BEFORE the turn and handed over as `pageContext`, which is the same slot a
  // dashboard page fills — so "this", "here" and "that" resolve the same way
  // on both surfaces, and the `page_context` tool answers instead of saying
  // there is none.
  const workspace = await workspaceFor(orgId);
  const thread = await deps.buildThreadContext(inbound, workspace, { token: process.env.SLACK_BOT_TOKEN }).catch(() => null);
  const permalink = await deps.permalink({ channelId: inbound.channelId, messageTs: inbound.messageRef }).catch(() => null);
  const pageContext = thread ? threadPageContext(thread) : null;

  // Is this feedback about the product? Decided by a cheap pure function; the
  // model is asked only when that is genuinely unsure. Carried as a note under
  // the message rather than as prompt wording, so the rule holds for every
  // agent that answers on this surface.
  const signal = classifyFeedback(inbound.text);
  const message = [
    withPageContext(inbound.text, pageContext),
    feedbackNote(signal),
    permalink ? `\n\nPermalink to this message, for anything you file: ${permalink}` : '',
  ].filter(Boolean).join('');

  try {
    const result = await deps.runAgent({
      orgId,
      agentSlug,
      message,
      userId: createdBy,
      conversationId,
      conversationHistory: history,
      ...(pageContext ? { pageContext } : {}),
    });
    let text = result.response.trim() || '(no reply)';

    // Something was missing, and the channel has not been told yet. The
    // sentence names the scope and what it would have bought — the whole
    // reason it lives here rather than in a prompt, which produced "no page
    // context here".
    const threadTs = inbound.threadRef;
    const gapSentence = thread ? scopeGapSentence(thread) : '';
    const alreadySaid = gapSentence ? await threadAlreadyNoticed(inbound.channelId, threadTs).catch(() => true) : true;
    const sayGap = Boolean(gapSentence) && !alreadySaid;
    if (sayGap) {
      text = `${text}\n\n${gapSentence}`;
    }

    await appendMessage({ orgId, conversationId, role: 'assistant', content: text });
    const posted = await adapter.reply(target, text);
    await recordSlackPost({
      orgId,
      projectId: orgId,
      teamId: inbound.teamId,
      channelId: inbound.channelId,
      ts: posted?.ts ?? '',
      threadTs,
      kind: 'reply',
      agentSlug,
      text,
      degradedNotice: sayGap,
      createdBy,
    });
    return { outcome: 'replied', orgId, agentSlug, conversationId, text, ...(thread ? { thread } : {}) };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await adapter.reply(target, 'Something went wrong on my side; a person can see the details in Vocion.').catch(() => {});
    return { outcome: 'failed', orgId, agentSlug, error: failure };
  }
}

export type AnnouncementInput = {
  orgId: string;
  channelId: string;
  teamId?: string | null;
  text: string;
  /** Images the post carries. The original post is where screenshots belong. */
  images?: { url: string; caption: string }[];
  /** What this post is announcing — a release, a report. Makes "this" resolvable in replies. */
  announcedLabel?: string | null;
  announcedUrl?: string | null;
  /** Post into an existing thread instead of starting one. */
  threadTs?: string | null;
  agentSlug?: string | null;
  createdBy?: string | null;
};

export type AnnouncementResult
  = | { outcome: 'unbound' }
    | { outcome: 'posted'; ts: string; media: string; recorded: boolean }
    | { outcome: 'failed'; error: string };

/**
 * Post an announcement — release notes, a report — into a bound channel, with
 * its screenshots, and remember that we did.
 *
 * Both halves matter and both were missing. The images belong in the ORIGINAL
 * post, not in an answer to "any screenshots to go with this?"; and the record
 * is what lets a reply to this post resolve "this" without a history scope.
 * @param adapter - The surface to post through.
 * @param input - The announcement.
 */
export async function postAnnouncementToChannel(adapter: ChatSurfaceAdapter, input: AnnouncementInput): Promise<AnnouncementResult> {
  const binding = await resolveBinding(adapter.id, input.teamId ?? null, input.channelId);
  if (!binding || binding.orgId !== input.orgId) {
    return { outcome: 'unbound' };
  }
  const agentSlug = input.agentSlug ?? binding.agentSlug;
  const persona = resolvePersona(binding, await agentPersona(input.orgId, agentSlug));
  const target: ChatReplyTarget = {
    channelId: input.channelId,
    ...(input.threadTs ? { threadRef: input.threadTs } : {}),
    ...(persona.displayName ? { displayName: persona.displayName } : {}),
    ...(persona.iconUrl ? { iconUrl: persona.iconUrl } : {}),
  };
  let posted: ChatPostRef | null;
  try {
    posted = await adapter.reply(target, { text: input.text, ...(input.images?.length ? { images: input.images } : {}) });
  } catch (error) {
    return { outcome: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
  const row = await recordSlackPost({
    orgId: input.orgId,
    projectId: input.orgId,
    teamId: input.teamId ?? null,
    channelId: input.channelId,
    ts: posted?.ts ?? '',
    threadTs: input.threadTs ?? null,
    kind: 'announcement',
    agentSlug,
    text: input.text,
    announcedLabel: input.announcedLabel ?? null,
    announcedUrl: input.announcedUrl ?? null,
    images: input.images ?? [],
    createdBy: input.createdBy ?? null,
  });
  return { outcome: 'posted', ts: posted?.ts ?? '', media: posted?.media ?? 'none', recorded: Boolean(row) };
}
