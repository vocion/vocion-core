import type { ChatImageFetcher, ChatInbound, ChatInboundFile, ChatJoin, ChatPostRef, ChatReplyTarget, ChatStop, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import type { LoadedAttachment } from '@/services/chat/attachments';
import type { ThreadApproval } from '@/services/chat/slackApproval';
import type { SlackThreadContext } from '@/services/chat/slackThread';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { absoluteAppLinks } from '@/libs/links';
import { fetchSlackFile } from '@/libs/surfaces/slack';
import { chatPermalink, conversationReplies } from '@/libs/surfaces/slackRead';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { agentSchema, chatChannelBindingSchema, projectSchema } from '@/models/Schema';
import { TurnStopped } from '@/services/agents/turnGate';
import { runAgentDeep } from '@/services/AgentService';
import { claimAttachments, createArtifact } from '@/services/ArtifactService';
import { withRunCost } from '@/services/budget/runCost';
import { preflightCheck } from '@/services/BudgetService';
import { acceptUpload, loadedFromArtifact, MAX_IMAGE_BYTES, uploadSpec } from '@/services/chat/attachments';
import { classifyFeedback, feedbackNote } from '@/services/chat/feedbackSignal';
import { withPageContext } from '@/services/chat/pageContext';
import { approvalFromThread, defaultThreadApprovalDeps } from '@/services/chat/slackApproval';
import { ourPostsInThread, recordSlackPost, threadAlreadyNoticed, tsOf } from '@/services/chat/slackPosts';
import { buildSlackThreadContext, scopeGapSentence, threadPageContext } from '@/services/chat/slackThread';
import { tellImages } from '@/services/chat/tellConversation';
import { followTurn } from '@/services/chat/workingLine';
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

/** What Vocion says the moment a mention is heard, taken back when the answer lands. */
export const WORKING_LINE = 'Looking into it…';

/** Dependency seam so the handler is testable without a model or a network. */
export type ChatHandlerDeps = {
  /** Which workspace a catch-all mention is for (`chat/workspaceRoute.ts`). */
  route: (binding: ChatChannelBinding, inbound: { text: string; scopeRef: string; channelId?: string; pictures?: readonly import('./chat/workspaceRoute').RoutePicture[] }) => Promise<import('./chat/workspaceRoute').RoutedWorkspace>;
  runAgent: typeof runAgentDeep;
  preflight: typeof preflightCheck;
  /** Builds the thread context. Injected so the tests need no Slack. */
  buildThreadContext: typeof buildSlackThreadContext;
  /** Permalink to the message being answered, for feedback provenance. */
  permalink: (opts: { channelId: string; messageTs: string }) => Promise<string | null>;
  /** The bytes of a picture on the message, behind the bot's token. Null when it cannot be read. */
  fetchFile: (url: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
  /** A reply that decides a card waiting in this thread (`slackApproval.ts`), or null to answer as a turn. */
  approval: (orgId: string, inbound: ChatInbound, conversationId: number) => Promise<ThreadApproval>;
  /** The pictures people posted earlier in the thread, for a mention that brought none. */
  threadPictures: (inbound: ChatInbound) => Promise<ChatInboundFile[]>;
  /** Whether Vocion has posted in this thread (the parent or a reply), so a reply with no mention is for it. */
  inThread: (channelId: string, threadRef: string) => Promise<boolean>;
  /** The cards waiting on a person whose origin is this conversation, newest first. */
  cardsWaiting: (orgId: string, conversationId: number) => Promise<Array<{ runId: number; input: Record<string, unknown> }>>;
  /** What a card's request was drawn as: its mockups, to go up with the ask. */
  cardPictures: (orgId: string, input: Record<string, unknown>) => Promise<import('./chat/tellConversation').TellFile[]>;
};

/** Picture types read from a thread; the same set the adapter reads off a mention. */
const THREAD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * THE PICTURE ABOVE THE MENTION (Chris, 2026-10-05): a person posts a screenshot, then says
 * "@Vocion" in its thread. The ask is the picture, so the pictures people (not bots) posted
 * before this message are read, at most five, newest kept.
 * @param inbound - The mention.
 * @param token - The bot token.
 */
export async function slackThreadPictures(inbound: Pick<ChatInbound, 'channelId' | 'threadRef' | 'messageRef'>, token: string | undefined): Promise<ChatInboundFile[]> {
  const replies = await conversationReplies({ channelId: inbound.channelId, threadTs: inbound.threadRef }, token);
  if (!replies.ok) {
    return [];
  }
  const files = replies.value
    .filter(m => !m.botId && m.ts !== inbound.messageRef && Number(m.ts) < Number(inbound.messageRef))
    .flatMap(m => m.files ?? [])
    .filter(f => THREAD_IMAGE_TYPES.has(f.mimeType) && typeof f.url === 'string')
    .map(f => ({ id: f.id, name: f.name.slice(0, 120), contentType: f.mimeType, bytes: f.size ?? 0, url: f.url! }));
  return files.slice(-5);
}

const defaultDeps: ChatHandlerDeps = {
  route: async (binding, inbound) => (await import('./chat/workspaceRoute')).routeToWorkspace(binding, inbound),
  runAgent: runAgentDeep,
  preflight: preflightCheck,
  buildThreadContext: buildSlackThreadContext,
  permalink: opts => chatPermalink(opts, process.env.SLACK_BOT_TOKEN),
  fetchFile: url => fetchSlackFile(url, process.env.SLACK_BOT_TOKEN),
  approval: (orgId, inbound, conversationId) => approvalFromThread(orgId, inbound, conversationId, defaultThreadApprovalDeps),
  threadPictures: inbound => slackThreadPictures(inbound, process.env.SLACK_BOT_TOKEN),
  inThread: async (channelId, threadRef) => (await ourPostsInThread(channelId, threadRef)).length > 0,
  cardsWaiting: (orgId, conversationId) => defaultThreadApprovalDeps.pending(orgId, conversationId),
  cardPictures: async (orgId, input) => (await import('./chat/cardPictures')).cardMockups(orgId, input),
};

/** A picture on the ask with its bytes, or null bytes when it could not be read. */
type FetchedPicture = { file: ChatInboundFile; got: { bytes: Uint8Array; contentType: string } | null };

/**
 * The bytes of each picture, read once: the router looks at them and the turn keeps them.
 * @param files - The pictures on the ask.
 * @param fetchFile - How bytes are fetched.
 */
async function fetchPictures(files: readonly ChatInboundFile[], fetchFile: ChatHandlerDeps['fetchFile']): Promise<FetchedPicture[]> {
  return Promise.all(files.map(async file => ({ file, got: await fetchFile(file.url).catch(() => null) })));
}

/**
 * THE PICTURE ON THE MENTION (backlog 057): a bug the Slate team reports is
 * the screenshot. Each image on the message is fetched with the bot's token,
 * kept as the same `file` artifact an upload in the composer becomes, and
 * handed to the turn as an attachment, so the agent sees what the person saw
 * and what it files carries it. A picture that could not be read is said in
 * the message in one line, never dropped in silence.
 * @param orgId - The workspace.
 * @param inbound - The message.
 * @param createdBy - Who sent it, as the record names them.
 * @param fetched - The pictures, already read.
 */
async function pictureAttachments(orgId: string, inbound: ChatInbound, createdBy: string, fetched: readonly FetchedPicture[]): Promise<{ attachments: LoadedAttachment[]; unread: string[] }> {
  const attachments: LoadedAttachment[] = [];
  const unread: string[] = [];
  for (const { file: f, got } of fetched) {
    if (!got || got.bytes.byteLength === 0 || got.bytes.byteLength > MAX_IMAGE_BYTES) {
      unread.push(f.name);
      continue;
    }
    const verdict = acceptUpload({ name: f.name, type: got.contentType, size: got.bytes.byteLength });
    if (!verdict.ok) {
      unread.push(f.name);
      continue;
    }
    const data = Buffer.from(got.bytes);
    const saved = await saveArtifact({ orgId, data, ext: verdict.accepted.ext, contentType: verdict.accepted.contentType });
    const { artifact } = await createArtifact({
      orgId,
      kind: 'file',
      title: f.name,
      spec: uploadSpec({ filename: saved.filename, originalName: f.name, contentType: verdict.accepted.contentType, bytes: saved.bytes, url: saved.url }),
      author: { kind: 'human', id: createdBy },
      changeSummary: `Attached in ${inbound.surface}`,
      visibility: 'user',
    });
    attachments.push(loadedFromArtifact(artifact));
  }
  return { attachments, unread };
}

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

/** The turns working in a thread now, by `surface:channel:thread`, so a person's stop can end one. */
const runningTurns = new Map<string, AbortController>();

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
  | { outcome: 'not_ours' }
  | { outcome: 'over_budget'; agentSlug: string }
  | { outcome: 'replied'; orgId: string; agentSlug: string; conversationId: number; text: string; thread?: SlackThreadContext }
  | { outcome: 'failed'; orgId: string; agentSlug: string; error: string }
> {
  const deps: ChatHandlerDeps = { ...defaultDeps, ...overrides };
  const bound = await resolveBinding(inbound.surface, inbound.teamId, inbound.channelId);
  if (!bound) {
    return { outcome: 'unbound' };
  }
  // A reply with no mention is answered only in a thread Vocion is already in; people talking
  // among themselves in any other thread are left alone.
  if (inbound.followUp && !(await deps.inThread(inbound.channelId, inbound.threadRef).catch(() => false))) {
    return { outcome: 'not_ours' };
  }
  // WHICH WORKSPACE (Chris, 2026-10-05): a mention that only matched the team's catch-all goes to
  // the workspace it is about, and the rest of its thread follows (`chat/workspaceRoute.ts`).
  // The pictures are read first, because a screenshot often says which product it is before any
  // word does. A mention that brought none, in a thread, brings the thread's (Chris, 2026-10-05).
  const inThread = inbound.threadRef !== inbound.messageRef;
  const threadFiles = (inbound.files?.length ?? 0) === 0 && inThread ? await deps.threadPictures(inbound).catch(() => []) : [];
  const fetched = await fetchPictures(inbound.files?.length ? inbound.files : threadFiles, deps.fetchFile);
  const routePictures = fetched.flatMap(p => p.got && p.got.bytes.byteLength <= MAX_IMAGE_BYTES ? [{ contentType: p.got.contentType, base64: Buffer.from(p.got.bytes).toString('base64') }] : []);
  const route = await deps.route(bound, { text: inbound.text, scopeRef: `${inbound.surface}:${inbound.channelId}:${inbound.threadRef}`, channelId: inbound.channelId, ...(routePictures.length > 0 ? { pictures: routePictures } : {}) });
  const binding = route.routed === 'model' || route.routed === 'thread'
    ? { ...bound, orgId: route.orgId, agentSlug: route.agentSlug, displayName: null, iconUrl: null }
    : bound;
  const { orgId, agentSlug } = binding;
  const target = replyTargetFor(binding, inbound, await agentPersona(orgId, agentSlug));

  // Something shows straight away that the mention was heard (Chris, 2026-10-05: "there was no
  // thinking indicator"). Where the platform has its own working state (Slack's agent session:
  // "Working…" and a stop button) that is it, and the steps go up as a line once there is one;
  // elsewhere a working line goes up at once. Either is taken back when the answer is posted.
  const native = adapter.session ? await adapter.session(target, 'working').catch(() => false) : false;
  let working = native ? null : await adapter.reply(target, WORKING_LINE).catch(() => null);
  // The line names the turn's steps as they happen (`chat/workingLine.ts`), then goes when the answer lands.
  const progress = followTurn(native ? '' : WORKING_LINE, async (text) => {
    if (working) {
      await adapter.edit?.(working, text);
    } else if (native) {
      working = await adapter.reply(target, text).catch(() => null);
    }
  });
  const doneWorking = async () => {
    await progress.stop();
    if (working && adapter.retract) {
      await adapter.retract(working).catch(() => undefined);
    }
    if (native) {
      await adapter.session?.(target, 'idle').catch(() => false);
    }
  };
  // A person can stop this turn from the thread (`stopThreadTurn`).
  const turnKey = `${inbound.surface}:${inbound.channelId}:${inbound.threadRef}`;
  const stopper = new AbortController();
  runningTurns.set(turnKey, stopper);

  const budget = await deps.preflight({ orgId, agentSlug });
  if (!budget.ok) {
    await doneWorking();
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
  // The cards already waiting here, so the reply carries pictures only for a card this turn put up.
  const cardsBefore = new Set((await deps.cardsWaiting(orgId, conversationId).catch(() => [])).map(c => c.runId));
  // The thread's pictures join the turn only the first time Vocion is called into it; later turns
  // already have them in the conversation.
  const pictures = await pictureAttachments(orgId, inbound, createdBy, inbound.files?.length || history.length === 0 ? fetched : []);
  const userMsg = await appendMessage({ orgId, conversationId, role: 'user', content: inbound.text, userId: createdBy });
  if (pictures.attachments.length > 0 && userMsg?.id) {
    await claimAttachments({ orgId, artifactIds: pictures.attachments.map(a => a.id), conversationId, messageId: userMsg.id }).catch(() => {});
  }

  // A REPLY THAT DECIDES (backlog 057): a card waiting on this thread, and
  // words a model reads as the decision, from a Slack user Vocion knows as a
  // member — decided here, said back, no agent turn. Anything else is a turn.
  const approval = await deps.approval(orgId, inbound, conversationId).catch(() => null);
  if (approval) {
    await appendMessage({ orgId, conversationId, role: 'assistant', content: approval.reply, status: 'complete' });
    await doneWorking();
    const posted = await adapter.reply(target, absoluteAppLinks(approval.reply));
    await recordSlackPost({ orgId, teamId: inbound.teamId, channelId: inbound.channelId, ts: tsOf(posted), threadTs: inbound.threadRef, kind: 'reply', agentSlug, text: approval.reply, createdBy: approval.decided ? `decision:${approval.verb}:${approval.runId}` : 'system:slack-approval' }).catch(() => {});
    return { outcome: 'replied', orgId, agentSlug, conversationId, text: approval.reply };
  }

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
    pictures.unread.length > 0 ? `\n\nA picture was attached that could not be read (${pictures.unread.join(', ')}); say so if it matters to the ask.` : '',
  ].filter(Boolean).join('');

  try {
    // What the turn spent is counted while it runs and written with the
    // answer (`services/budget/runCost.ts`).
    const { cost, result } = await withRunCost({ conversationId }, async scope => ({ cost: scope, result: await deps.runAgent({
      orgId,
      agentSlug,
      message,
      userId: createdBy,
      conversationId,
      conversationHistory: history,
      ...(pageContext ? { pageContext } : {}),
      ...(pictures.attachments.length > 0 ? { attachments: pictures.attachments } : {}),
      onEvent: progress.onEvent,
      signal: stopper.signal,
    }) }));
    // Slack shows no trace, so it gets the answer after the turn's last tool call; the steps
    // before it ("I'll check the rollup first") stay on the run in Vocion (`lastAnswerOf`).
    let text = (result.lastAnswer ?? result.response).trim() || '(no reply)';

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

    // The reply went out, so the turn finished: say so rather than leaving a
    // NULL that a reader has to guess at (#114).
    await appendMessage({ orgId, conversationId, role: 'assistant', content: text, status: 'complete', cost: { tokens: cost.tokens, microCents: cost.microCents } });
    await doneWorking();
    // The app's chat renders its own relative links; in a thread they are dead, so they leave absolute.
    const out = absoluteAppLinks(text);
    // A card this turn put up for the person goes up with its request's mockups (Chris, 2026-10-06:
    // "put mocks in Slack when asking for review").
    const asked = (await deps.cardsWaiting(orgId, conversationId).catch(() => [])).find(c => !cardsBefore.has(c.runId));
    const mockups = asked ? await deps.cardPictures(orgId, asked.input).catch(() => []) : [];
    const pictured = mockups.length > 0 ? tellImages(orgId, mockups) : null;
    const posted = await adapter.reply(target, pictured ? { text: out, images: pictured.images } : out, pictured ? { fetchImage: pictured.fetchImage } : undefined);
    await recordSlackPost({
      orgId,
      projectId: orgId,
      teamId: inbound.teamId,
      channelId: inbound.channelId,
      ts: posted?.ts ?? '',
      threadTs,
      kind: 'reply',
      agentSlug,
      text: out,
      degradedNotice: sayGap,
      createdBy,
    });
    return { outcome: 'replied', orgId, agentSlug, conversationId, text, ...(thread ? { thread } : {}) };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    await doneWorking();
    const stopped = error instanceof TurnStopped;
    await adapter.reply(target, stopped ? 'Stopped, as you asked.' : 'Something went wrong on my side; a person can see the details in Vocion.').catch(() => {});
    return { outcome: 'failed', orgId, agentSlug, error: failure };
  } finally {
    if (runningTurns.get(turnKey) === stopper) {
      runningTurns.delete(turnKey);
    }
  }
}

/**
 * A PERSON PRESSED STOP (Slack's agent session). The turn working in that thread ends, says it
 * stopped, and the thread's working state goes back to idle; with no turn there, only the state.
 * @param adapter - The surface.
 * @param stop - Where.
 * @returns Whether a turn was running there.
 */
export async function stopThreadTurn(adapter: ChatSurfaceAdapter, stop: ChatStop): Promise<boolean> {
  const turn = runningTurns.get(`${stop.surface}:${stop.channelId}:${stop.threadRef}`);
  if (turn) {
    turn.abort();
    return true;
  }
  await adapter.session?.({ channelId: stop.channelId, threadRef: stop.threadRef }, 'idle').catch(() => false);
  return false;
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
  /**
   * Reads the bytes behind an image that sits behind our sign-in, so the
   * post can upload it rather than link to a page Slack cannot open. Scoped
   * to the caller's org by whoever builds it.
   */
  fetchImage?: ChatImageFetcher;
};

export type AnnouncementResult
  = | { outcome: 'unbound' }
    | { outcome: 'posted'; channelId: string; ts: string; media: string; recorded: boolean; fileIds: string[] }
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
    posted = await adapter.reply(target, { text: input.text, ...(input.images?.length ? { images: input.images } : {}) }, input.fetchImage ? { fetchImage: input.fetchImage } : undefined);
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
  return { outcome: 'posted', channelId: posted?.channelId ?? input.channelId, ts: posted?.ts ?? '', media: posted?.media ?? 'none', recorded: Boolean(row), fileIds: posted?.fileIds ?? [] };
}
