import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { listSurfaces } from '@/libs/surfaces/registry';
import { agentSchema, projectSchema } from '@/models/Schema';
import { createBinding, resolveBinding } from '@/services/ChatSurfaceService';

/**
 * Connect a chat channel to one of the caller's workspaces, from the link an
 * unbound channel posts (`ChatSurfaceService.promptUnbound`). The channel then
 * answers as that workspace's lead. Only an Org admin connects, and only to a
 * workspace of their own Org.
 */

export type ConnectChannelInput = {
  surface: string;
  teamId: string | null;
  channelId: string;
  projectId: string;
};

export type ConnectChannelCaller = {
  userId: string | null;
  accountId: string | null;
  role: 'admin' | 'member' | null;
};

export type ConnectChannelResult
  = | { ok: true; projectId: string; agentSlug: string }
    | { ok: false; reason: 'not_admin' | 'bad_request' | 'not_your_workspace' | 'other_team' | 'already_connected' | 'no_agent' };

/**
 * The workspaces an admin may connect a channel to: every workspace of their Org.
 * @param accountId - The caller's Org.
 */
export async function connectableWorkspaces(accountId: string): Promise<Array<{ id: string; name: string; slug: string }>> {
  return db.select({ id: projectSchema.id, name: projectSchema.name, slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.accountId, accountId)).orderBy(projectSchema.name);
}

/**
 * The agent a newly connected channel answers as: the workspace lead, else its first active agent.
 * @param projectId - The workspace.
 * @param leadAgentSlug - Its configured lead, if any.
 */
async function answeringAgent(projectId: string, leadAgentSlug: string | null): Promise<string | null> {
  if (leadAgentSlug) {
    return leadAgentSlug;
  }
  const [agent] = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(and(eq(agentSchema.orgId, projectId), eq(agentSchema.active, 'true'))).orderBy(agentSchema.id).limit(1);
  return agent?.slug ?? null;
}

/**
 * Bind the channel. Refuses rather than guesses: a member, another Org's
 * workspace, a Slack team this installation does not serve, or a channel that
 * already answers somewhere are each said as they are.
 * @param caller - Who is connecting.
 * @param input - The channel and the workspace it should answer for.
 */
export async function connectChannel(caller: ConnectChannelCaller, input: ConnectChannelInput): Promise<ConnectChannelResult> {
  if (caller.role !== 'admin' || !caller.accountId) {
    return { ok: false, reason: 'not_admin' };
  }
  const channelId = input.channelId.trim();
  if (!channelId || channelId === '*' || !listSurfaces().some(s => s.id === input.surface)) {
    return { ok: false, reason: 'bad_request' };
  }
  // A single-team installation names its Slack team; a link for another team is not ours to bind.
  const servedTeam = input.surface === 'slack' ? process.env.SLACK_TEAM_ID : undefined;
  if (servedTeam && input.teamId && input.teamId !== servedTeam) {
    return { ok: false, reason: 'other_team' };
  }
  const [project] = await db.select({ id: projectSchema.id, accountId: projectSchema.accountId, leadAgentSlug: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, input.projectId)).limit(1);
  if (!project || project.accountId !== caller.accountId) {
    return { ok: false, reason: 'not_your_workspace' };
  }
  const existing = await resolveBinding(input.surface, input.teamId, channelId);
  if (existing && existing.channelId === channelId) {
    return { ok: false, reason: 'already_connected' };
  }
  const agentSlug = await answeringAgent(project.id, project.leadAgentSlug);
  if (!agentSlug) {
    return { ok: false, reason: 'no_agent' };
  }
  await createBinding({ orgId: project.id, surface: input.surface, teamId: input.teamId, channelId, agentSlug, ...(caller.userId ? { createdBy: caller.userId } : {}) });
  return { ok: true, projectId: project.id, agentSlug };
}
