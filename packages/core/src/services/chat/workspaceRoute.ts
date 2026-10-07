/**
 * WHICH WORKSPACE A SLACK MENTION IS FOR (Chris, 2026-10-05: "you'll probably need to have a very
 * quick routing step to be dynamic … Specific channels should get (n) workspace associations to
 * help with faster routing, but allow addition if context is appropriate. Specific Slack threads
 * should get affixed to (1) specific workspace").
 *
 * - A THREAD has one workspace: every message after the first goes where the first one went.
 * - A CHANNEL has its workspaces: the binding's own and `workspaceIds`. A thread's first mention
 *   is read once by a small model against the account's workspaces, the channel's own offered
 *   first at the ordinary bar; another workspace of the account wins only on a high bar, and is
 *   then added to the channel so the next thread there routes faster.
 * - A mention that matched only the team's `*` catch-all has no channel workspaces yet; a confident
 *   route gives the channel its own binding.
 *
 * Within the chosen workspace the binding's agent answers when the workspace is the binding's,
 * else the workspace's own first-turn router (`routeMessage`) picks. Tenancy stays with the
 * binding: only workspaces in its own account are candidates. Anything unclear, or a failed read,
 * keeps the binding.
 *
 * WHO IS ASKING DECIDES WHERE IT MAY GO (2026-10-07). A candidate outside the channel's own
 * workspaces is offered only when the sender — the Vocion member behind the Slack user, by the
 * email on their profile — can act in it (`listProjectsForUser`, the rule `actAs` applies). A
 * sender Vocion does not know reaches the channel's own workspaces and nothing else. Nobody's
 * personal workspace is ever a candidate. Before this, a mention could be routed to any workspace
 * on the account, whoever wrote it.
 *
 * The same read serves a person's own assistant (`tools/assistant.ts`): when it asks without
 * naming a workspace, {@link readWorkspaceRoute} picks among the person's own, at the same bar.
 */
import { z } from 'zod';

/** One workspace as the read sees it. */
export type WorkspaceCandidate = { orgId: string; name: string; description: string | null; products: string[]; agents: Array<{ slug: string; name: string; description: string | null }> };

export const WorkspaceRouteSchema = z.object({
  workspace: z.string().describe('The id of the workspace the message is for, exactly as listed.'),
  confidence: z.number().min(0).max(1).describe('How sure: 0.9 when the message, the channel or the thread names the product or work; under 0.5 when it could be any of them.'),
  reason: z.string().max(200).describe('One short sentence: what points there.'),
});
export type WorkspaceRoute = z.infer<typeof WorkspaceRouteSchema>;

/** A pick among the channel's own workspaces needs this. */
export const WORKSPACE_ROUTE_BAR = 0.5;
/** A pick outside them needs this, and adds it to the channel. */
export const WORKSPACE_ADD_BAR = 0.8;

/** The binding as the router reads it. */
export type RouteBinding = { id?: number; orgId: string; agentSlug: string; channelId: string; teamId?: string | null; surface?: string; workspaceIds?: string[] | null };

/**
 * The human message the read gets: where it was said, the words, and the workspaces.
 * @param message - What they wrote.
 * @param candidates - The account's workspaces, the channel's own first.
 * @param where - The channel's name and its own workspace ids.
 * @param where.channel - The channel's name, when known.
 * @param where.own - The channel's own workspace ids.
 * @param where.via - How the message reached Vocion, for the read; a Slack mention when absent.
 */
export function routePrompt(message: string, candidates: readonly WorkspaceCandidate[], where: { channel: string | null; own: readonly string[]; via?: string }): string {
  const blocks = candidates.map(c => [
    `- id: ${c.orgId}${where.own.includes(c.orgId) ? '   (this channel is for it)' : ''}`,
    `  name: ${c.name}`,
    ...(c.description ? [`  about: ${c.description.slice(0, 300)}`] : []),
    ...(c.products.length > 0 ? [`  products: ${c.products.slice(0, 12).join(', ')}`] : []),
    `  agents: ${c.agents.slice(0, 12).map(a => `${a.name}${a.description ? ` (${a.description.slice(0, 80)})` : ''}`).join('; ') || 'none'}`,
  ].join('\n'));
  return `${where.channel ? `Said in the Slack channel #${where.channel}.\n` : ''}The message, ${where.via ?? 'sent by mentioning Vocion'}:\n"""${message.slice(0, 2_000)}"""\n\nThe workspaces it could be for:\n${blocks.join('\n')}`;
}

export type WorkspaceRouteDeps = {
  /** The thread's workspace and agent, when an earlier message in it already went somewhere. */
  threadOwner: (scopeRef: string, orgIds: readonly string[]) => Promise<{ orgId: string; agentSlug: string } | null>;
  /**
   * The workspaces in the binding's account a mention may go to, with their products and the
   * agents a person can talk to: `reach.keep` (the channel's own) always, any other only when
   * `reach.sender` can act in it.
   */
  candidates: (bindingOrgId: string, reach: CandidateReach) => Promise<WorkspaceCandidate[]>;
  /** The Vocion member behind the sender, or null when Vocion does not know them. Absent reads as unknown. */
  sender?: (binding: RouteBinding, externalUserId: string) => Promise<string | null>;
  /** The channel's name, when the platform says. */
  channelName: (binding: RouteBinding) => Promise<string | null>;
  /** The model read. */
  read: (orgId: string, prompt: string, pictures?: readonly RoutePicture[]) => Promise<WorkspaceRoute | null>;
  /** The agent that answers in a workspace, by its own first-turn router. */
  agentIn: (orgId: string, message: string) => Promise<string | null>;
  /** Remember the workspace on the channel: a new binding for a catch-all channel, or one more id. */
  remember: (binding: RouteBinding, orgId: string, agentSlug: string) => Promise<void>;
};

/** Who a mention is from, for the candidates it may reach. */
export type CandidateReach = {
  /**
   * The Vocion user id behind the sender; null when unknown. Asked only when a workspace beyond
   * `keep` could be offered, because finding out can cost a call to the platform.
   */
  sender: () => Promise<string | null>;
  /** Workspaces offered whoever asks: the binding's and the channel's own. */
  keep: readonly string[];
};

/** A picture on the ask, as bytes the model reads: a screenshot often names the product before any word does. */
export type RoutePicture = { contentType: string; base64: string };

export type RoutedWorkspace = { orgId: string; agentSlug: string; routed: 'binding' | 'thread' | 'model'; reason: string; added?: boolean };

/**
 * A direct message has no channel to remember workspaces on.
 * @param channelId
 */
function isChannel(channelId: string): boolean {
  return channelId !== '*' && !channelId.startsWith('D');
}

/**
 * Where a mention goes. Never throws; anything unclear keeps the binding.
 * @param binding - The resolved binding (`*` channel for the team's catch-all).
 * @param inbound - The mention.
 * @param inbound.text - What they wrote.
 * @param inbound.scopeRef - `slack:<channel>:<thread>`.
 * @param inbound.channelId - The channel it was said in.
 * @param inbound.pictures - The pictures on the ask, read with the words.
 * @param inbound.externalUserId - The sender's id on the platform: who it is decides where it may go.
 * @param seams - Seams for tests.
 */
export async function routeToWorkspace(binding: RouteBinding, inbound: { text: string; scopeRef: string; channelId?: string; pictures?: readonly RoutePicture[]; externalUserId?: string }, seams?: WorkspaceRouteDeps): Promise<RoutedWorkspace> {
  // eslint-disable-next-line ts/no-use-before-define -- read at call time, after the module has loaded
  const deps = seams ?? defaultDeps;
  const asBound: RoutedWorkspace = { orgId: binding.orgId, agentSlug: binding.agentSlug, routed: 'binding', reason: binding.channelId === '*' ? 'the team catch-all' : 'the channel is bound' };
  try {
    const own = binding.channelId === '*' ? [] : [binding.orgId, ...(binding.workspaceIds ?? [])].filter((id, i, a) => a.indexOf(id) === i);
    let senderRead: Promise<string | null> | null = null;
    const sender = () => {
      senderRead ??= inbound.externalUserId && deps.sender ? deps.sender(binding, inbound.externalUserId).catch(() => null) : Promise.resolve(null);
      return senderRead;
    };
    const candidates = await deps.candidates(binding.orgId, { sender, keep: [...new Set([binding.orgId, ...own])] });
    if (candidates.length < 2) {
      return asBound;
    }
    const owner = await deps.threadOwner(inbound.scopeRef, candidates.map(c => c.orgId));
    if (owner) {
      return { ...owner, routed: 'thread', reason: 'the thread is fixed to its workspace' };
    }
    const ordered = [...candidates.filter(c => own.includes(c.orgId)), ...candidates.filter(c => !own.includes(c.orgId))];
    const read = await deps.read(binding.orgId, routePrompt(inbound.text, ordered, { channel: await deps.channelName({ ...binding, channelId: inbound.channelId ?? binding.channelId }).catch(() => null), own }), inbound.pictures);
    const picked = read ? candidates.find(c => c.orgId === read.workspace.trim()) : null;
    if (!read || !picked) {
      return asBound;
    }
    const inChannel = own.includes(picked.orgId);
    if (read.confidence < (inChannel ? WORKSPACE_ROUTE_BAR : WORKSPACE_ADD_BAR)) {
      return asBound;
    }
    if (picked.orgId === binding.orgId && binding.channelId !== '*') {
      return { ...asBound, reason: read.reason };
    }
    const agentSlug = await deps.agentIn(picked.orgId, inbound.text);
    if (!agentSlug) {
      return asBound;
    }
    const channel = inbound.channelId ?? (binding.channelId === '*' ? null : binding.channelId);
    const added = !inChannel && channel !== null && isChannel(channel);
    if (added) {
      await deps.remember({ ...binding, channelId: channel }, picked.orgId, agentSlug).catch(() => undefined);
    }
    return { orgId: picked.orgId, agentSlug, routed: 'model', reason: read.reason, added };
  } catch {
    return asBound;
  }
}

const defaultDeps: WorkspaceRouteDeps = {
  async threadOwner(scopeRef, orgIds) {
    const { db } = await import('@/libs/DB');
    const { and, desc, eq, inArray } = await import('drizzle-orm');
    const { conversationSchema } = await import('@/models/Schema');
    const [row] = await db.select({ orgId: conversationSchema.orgId, agentSlug: conversationSchema.agentSlug }).from(conversationSchema).where(and(eq(conversationSchema.scopeRef, scopeRef), inArray(conversationSchema.orgId, [...orgIds]))).orderBy(desc(conversationSchema.id)).limit(1);
    return row?.agentSlug ? { orgId: row.orgId, agentSlug: row.agentSlug } : null;
  },
  candidates: (bindingOrgId, reach) => accountCandidates(bindingOrgId, reach),
  async sender(binding, externalUserId) {
    const { channelBySurface } = await import('./channels');
    const channel = channelBySurface(binding.surface ?? 'slack');
    const member = channel ? await channel.memberOf(binding.orgId, externalUserId) : null;
    return member?.userId ?? null;
  },
  async channelName(binding) {
    if (binding.channelId === '*' || binding.surface !== 'slack') {
      return null;
    }
    const { slackApi } = await import('@/libs/surfaces/slack');
    const res = await slackApi<{ channel?: { name?: string } }>('conversations.info', { channel: binding.channelId }, process.env.SLACK_BOT_TOKEN);
    return res.ok ? res.body.channel?.name ?? null : null;
  },
  read: (orgId, prompt, pictures) => readWorkspaceRoute(orgId, prompt, { pictures }),
  async agentIn(orgId, message) {
    const { routeMessage } = await import('@/services/agents/router');
    const decision = await routeMessage({ orgId, message, surface: 'slack' }).catch(() => null);
    return decision?.chosen ?? null;
  },
  async remember(binding, orgId, agentSlug) {
    const { db } = await import('@/libs/DB');
    const { and, eq, sql } = await import('drizzle-orm');
    const { chatChannelBindingSchema } = await import('@/models/Schema');
    const surface = binding.surface ?? 'slack';
    const teamId = binding.teamId ?? null;
    const [row] = await db.select({ id: chatChannelBindingSchema.id, orgId: chatChannelBindingSchema.orgId }).from(chatChannelBindingSchema).where(and(eq(chatChannelBindingSchema.surface, surface), eq(chatChannelBindingSchema.channelId, binding.channelId), teamId ? eq(chatChannelBindingSchema.teamId, teamId) : sql`${chatChannelBindingSchema.teamId} is null`)).limit(1);
    if (!row) {
      await db.insert(chatChannelBindingSchema).values({ orgId, surface, teamId, channelId: binding.channelId, agentSlug, workspaceIds: [], createdBy: 'system:slack-route' }).onConflictDoNothing();
      return;
    }
    if (row.orgId !== orgId) {
      await db.update(chatChannelBindingSchema).set({ workspaceIds: sql`(select array_agg(distinct x) from unnest(array_append(${chatChannelBindingSchema.workspaceIds}, ${orgId}::text)) x)` }).where(eq(chatChannelBindingSchema.id, row.id));
    }
  },
};

/** What the Slack read is told about where the message came from. */
const SLACK_ROUTE_SYSTEM = 'A person mentioned Vocion in their company\'s Slack. The company has several Vocion workspaces, each for different products or teams. Decide which one the message is for, from what it is about — the product, the work, the people or the agents it names — and from the channel it was said in. Workspaces marked as this channel\'s are the usual ones here; choose another only when the message is clearly about it. If nothing points to one, say so with a low confidence. Answer only through the tool.';

/**
 * The model read: which workspace a message is for, as typed fields. A small model, forced through
 * one tool, so code routes on `workspace` and `confidence` and never on the words. Null when the
 * read failed or came back malformed — every caller then keeps what it had.
 * @param orgId - The workspace whose key and budget the read spends.
 * @param prompt - {@link routePrompt}'s message.
 * @param opts - The pictures on the ask, and the situation when it is not a Slack mention.
 * @param opts.pictures - Read with the words.
 * @param opts.system - Who is asking and how, for the system message.
 */
export async function readWorkspaceRoute(orgId: string, prompt: string, opts: { pictures?: readonly RoutePicture[]; system?: string } = {}): Promise<WorkspaceRoute | null> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { tool } = await import('@langchain/core/tools');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as { bindTools: (t: unknown[], o: unknown) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: Array<{ name: string; args: unknown }> }> } };
  const report = tool(async () => 'recorded', { name: 'report_workspace', description: 'Report which workspace the message is for.', schema: WorkspaceRouteSchema as never });
  const pictures = opts.pictures ?? [];
  const res = await model.bindTools([report], { tool_choice: 'report_workspace' }).invoke([
    new SystemMessage(opts.system ?? SLACK_ROUTE_SYSTEM),
    new HumanMessage(pictures.length > 0
      ? { content: [{ type: 'text', text: `${prompt}\n\nThe pictures on the message follow.` }, ...pictures.slice(0, 2).map(p => ({ type: 'image_url', image_url: { url: `data:${p.contentType};base64,${p.base64}` } }))] }
      : prompt),
  ]);
  // A paid call, so it charges (CLAUDE.md, "every paid model call charges").
  const [{ chargeModelCall }, { FEATURES }] = await Promise.all([import('@/services/budget/chargeModelCall'), import('@/libs/Langfuse/features')]);
  await chargeModelCall({ orgId, feature: FEATURES.CHAT_ROUTE, role: 'classifier', response: res });
  const call = (res.tool_calls ?? []).find(c => c.name === 'report_workspace');
  const parsed = call ? WorkspaceRouteSchema.safeParse(call.args) : null;
  return parsed?.success ? parsed.data : null;
}

/**
 * Workspaces as the read sees them: each with its products (the record titles of the type the
 * workspace calls `product`, if it has one — a mention names them, "on Slate …") and the active
 * agents a person can talk to. A workspace with no such agent is left out: nothing there can answer.
 * @param projects - The workspaces, in the order to offer them.
 */
export async function describeWorkspaces(projects: ReadonlyArray<{ id: string; name: string; description: string | null }>): Promise<WorkspaceCandidate[]> {
  if (projects.length === 0) {
    return [];
  }
  const { db } = await import('@/libs/DB');
  const { and, eq, inArray } = await import('drizzle-orm');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const products = await db.select({ orgId: businessObjectSchema.orgId, title: businessObjectSchema.title }).from(businessObjectSchema).innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId)).where(and(inArray(businessObjectSchema.orgId, projects.map(p => p.id)), eq(businessObjectTypeSchema.slug, 'product')));
  const { listAgents } = await import('@/services/AgentService');
  const { routableFromRow } = await import('@/services/agents/router');
  const out: WorkspaceCandidate[] = [];
  for (const p of projects) {
    const agents = (await listAgents(p.id).catch(() => [])).map(routableFromRow).filter(a => a.active !== false && !a.queued);
    if (agents.length > 0) {
      out.push({ orgId: p.id, name: p.name, description: p.description ?? null, products: products.filter(r => r.orgId === p.id).map(r => r.title), agents: agents.map(a => ({ slug: a.slug, name: a.name, description: a.description ?? null })) });
    }
  }
  return out;
}

/**
 * The shared workspaces on the binding's account that a mention from this sender may go to: the
 * ones in `reach.keep`, and any other the sender can act in. Personal workspaces never.
 * @param bindingOrgId - The binding's workspace; its account bounds the answer.
 * @param reach - Who is asking, and what is offered whoever asks.
 */
export async function accountCandidates(bindingOrgId: string, reach: CandidateReach): Promise<WorkspaceCandidate[]> {
  const { db } = await import('@/libs/DB');
  const { and, eq, ne } = await import('drizzle-orm');
  const { projectSchema } = await import('@/models/Schema');
  const [own] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, bindingOrgId)).limit(1);
  if (!own) {
    return [];
  }
  const projects = await db.select({ id: projectSchema.id, name: projectSchema.name, description: projectSchema.description }).from(projectSchema).where(and(eq(projectSchema.accountId, own.accountId), ne(projectSchema.kind, 'personal')));
  // The sender's reach is the switcher's: what they could open is what a mention of theirs may
  // reach (`listProjectsForUser` applies the same rule `actAs` does, enforced or not).
  const beyond = projects.some(p => !reach.keep.includes(p.id));
  const sender = beyond ? await reach.sender() : null;
  const { listProjectsForUser } = await import('@/services/ProjectService');
  const theirs = sender ? new Set((await listProjectsForUser(sender)).map(p => p.id)) : new Set<string>();
  return describeWorkspaces(projects.filter(p => reach.keep.includes(p.id) || theirs.has(p.id)));
}
