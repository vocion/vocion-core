/**
 * WHICH WORKSPACE A SLACK MENTION IS FOR (Chris, 2026-10-05: "you'll probably need to have a very
 * quick routing step to be dynamic"). One Slack team is bound to one account, which holds several
 * workspaces (Squatch Factory, the workforce, Revenue …). A channel bound exactly answers as it
 * always has. A mention that only matched the team's `*` catch-all is read once by a small model
 * against the account's workspaces — their names, what they say they are, and the agents a person
 * can talk to there — and goes to the one it is about; within it, the workspace's own first-turn
 * router (`routeMessage`) picks the agent. The thread then belongs to that workspace: every later
 * message in it goes where the first one went.
 *
 * Tenancy stays with the binding: only workspaces in the catch-all's own account are candidates.
 * A read that is unsure, fails or picks something not offered keeps the catch-all's workspace, so
 * routing can only ever move a mention between workspaces its team already reaches.
 */
import { z } from 'zod';

/** One workspace as the read sees it. */
export type WorkspaceCandidate = { orgId: string; name: string; description: string | null; agents: Array<{ slug: string; name: string; description: string | null }> };

export const WorkspaceRouteSchema = z.object({
  workspace: z.string().describe('The id of the workspace the message is for, exactly as listed.'),
  confidence: z.number().min(0).max(1).describe('How sure: 0.9 when the message names the product or work it is about; under 0.5 when it could be any of them.'),
  reason: z.string().max(200).describe('One short sentence: what in the message points there.'),
});
export type WorkspaceRoute = z.infer<typeof WorkspaceRouteSchema>;

/** Below this the read is guessing, and the catch-all's workspace answers. */
export const WORKSPACE_ROUTE_BAR = 0.6;

/**
 * The human message the read gets: the person's words and the workspaces, one block each.
 * @param message - What they wrote.
 * @param candidates - The account's workspaces.
 */
export function routePrompt(message: string, candidates: readonly WorkspaceCandidate[]): string {
  const blocks = candidates.map(c => [
    `- id: ${c.orgId}`,
    `  name: ${c.name}`,
    ...(c.description ? [`  about: ${c.description.slice(0, 300)}`] : []),
    `  agents: ${c.agents.slice(0, 12).map(a => `${a.name}${a.description ? ` (${a.description.slice(0, 80)})` : ''}`).join('; ') || 'none'}`,
  ].join('\n'));
  return `The message, sent by mentioning Vocion in Slack:\n"""${message.slice(0, 2_000)}"""\n\nThe workspaces it could be for:\n${blocks.join('\n')}`;
}

export type WorkspaceRouteDeps = {
  /** The thread's workspace and agent, when an earlier message in it already went somewhere. */
  threadOwner: (scopeRef: string, orgIds: readonly string[]) => Promise<{ orgId: string; agentSlug: string } | null>;
  /** The workspaces in the binding's account, with the agents a person can talk to. */
  candidates: (bindingOrgId: string) => Promise<WorkspaceCandidate[]>;
  /** The model read. */
  read: (orgId: string, message: string, candidates: readonly WorkspaceCandidate[]) => Promise<WorkspaceRoute | null>;
  /** The agent that answers in a workspace, by its own first-turn router. */
  agentIn: (orgId: string, message: string) => Promise<string | null>;
};

export type RoutedWorkspace = { orgId: string; agentSlug: string; routed: 'binding' | 'thread' | 'model'; reason: string };

/**
 * Where a mention that matched a binding goes. An exact channel binding answers as bound; a
 * catch-all match goes to the thread's workspace, else the one a model reads it as being for.
 * Never throws; anything unclear keeps the binding.
 * @param binding - The resolved binding.
 * @param binding.orgId - Its workspace.
 * @param binding.agentSlug - Its agent.
 * @param binding.channelId - `*` for the team's catch-all.
 * @param inbound - The mention: its words and the thread's scope.
 * @param inbound.text - What they wrote.
 * @param inbound.scopeRef - `slack:<channel>:<thread>`.
 * @param seams - Seams for tests.
 */
export async function routeToWorkspace(binding: { orgId: string; agentSlug: string; channelId: string }, inbound: { text: string; scopeRef: string }, seams?: WorkspaceRouteDeps): Promise<RoutedWorkspace> {
  // eslint-disable-next-line ts/no-use-before-define -- read at call time, after the module has loaded
  const deps = seams ?? defaultDeps;
  const asBound: RoutedWorkspace = { orgId: binding.orgId, agentSlug: binding.agentSlug, routed: 'binding', reason: binding.channelId === '*' ? 'the team catch-all' : 'the channel is bound' };
  if (binding.channelId !== '*') {
    return asBound;
  }
  try {
    const candidates = await deps.candidates(binding.orgId);
    if (candidates.length < 2) {
      return asBound;
    }
    const owner = await deps.threadOwner(inbound.scopeRef, candidates.map(c => c.orgId));
    if (owner) {
      return { ...owner, routed: 'thread', reason: 'the thread already went there' };
    }
    const read = await deps.read(binding.orgId, inbound.text, candidates);
    const picked = read ? candidates.find(c => c.orgId === read.workspace.trim()) : null;
    if (!read || !picked || read.confidence < WORKSPACE_ROUTE_BAR || picked.orgId === binding.orgId) {
      return asBound;
    }
    const agentSlug = await deps.agentIn(picked.orgId, inbound.text);
    if (!agentSlug) {
      return asBound;
    }
    return { orgId: picked.orgId, agentSlug, routed: 'model', reason: read.reason };
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
  async candidates(bindingOrgId) {
    const { db } = await import('@/libs/DB');
    const { eq } = await import('drizzle-orm');
    const { projectSchema } = await import('@/models/Schema');
    const [own] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, bindingOrgId)).limit(1);
    if (!own) {
      return [];
    }
    const projects = await db.select({ id: projectSchema.id, name: projectSchema.name, description: projectSchema.description }).from(projectSchema).where(eq(projectSchema.accountId, own.accountId));
    const { listAgents } = await import('@/services/AgentService');
    const { routableFromRow } = await import('@/services/agents/router');
    const out: WorkspaceCandidate[] = [];
    for (const p of projects) {
      const agents = (await listAgents(p.id).catch(() => [])).map(routableFromRow).filter(a => a.active !== false && !a.queued);
      if (agents.length > 0) {
        out.push({ orgId: p.id, name: p.name, description: p.description ?? null, agents: agents.map(a => ({ slug: a.slug, name: a.name, description: a.description ?? null })) });
      }
    }
    return out;
  },
  async read(orgId, message, candidates) {
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 300 }) as { bindTools: (t: unknown[], o: unknown) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: Array<{ name: string; args: unknown }> }> } };
    const report = tool(async () => 'recorded', { name: 'report_workspace', description: 'Report which workspace the message is for.', schema: WorkspaceRouteSchema as never });
    const res = await model.bindTools([report], { tool_choice: 'report_workspace' }).invoke([
      new SystemMessage('A person mentioned Vocion in their company\'s Slack. The company has several Vocion workspaces, each for a different product or team. Decide which one the message is for, from what it is about: the product, the work, the people or the agents it names. If nothing in it points to one, say so with a low confidence. Answer only through the tool.'),
      new HumanMessage(routePrompt(message, candidates)),
    ]);
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_workspace');
    const parsed = call ? WorkspaceRouteSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  },
  async agentIn(orgId, message) {
    const { routeMessage } = await import('@/services/agents/router');
    const decision = await routeMessage({ orgId, message, surface: 'slack' }).catch(() => null);
    return decision?.chosen ?? null;
  },
};
