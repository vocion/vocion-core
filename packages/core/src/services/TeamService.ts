/**
 * TeamService — teams of AGENTS (the org chart), not the humans in the
 * tenant account (those live in MembersService). Read-side only in F1:
 * teams are authored as workspace YAML and written by workspace:apply;
 * this service resolves what the UI needs — the lead agent, the member
 * roster, and exactly one accountable human per team with its
 * provenance (set on the team vs inherited from the workspace default)
 * so the UI can label inheritance instead of silently flattening it.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema, teamSchema, userSchema } from '@/models/Schema';

export type TeamRow = typeof teamSchema.$inferSelect;

/** The slice of an agent row the teams surfaces need. Never a YAML path. */
export type TeamAgent = {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  teamSlug: string | null;
};

/** One resolved accountable human — never a bare id in the UI. */
export type AccountableUser = {
  userId: string;
  name: string | null;
  email: string;
  /** 'team' = set on the team itself; 'workspace' = inherited from the workspace default. */
  source: 'team' | 'workspace';
};

export type TeamView = {
  slug: string;
  name: string;
  description: string | null;
  /** Resolved lead agent; null when leadAgentSlug is unset or dangling ("no lead yet"). */
  lead: TeamAgent | null;
  leadAgentSlug: string | null;
  /** Agents on this team, lead first, then alphabetical. */
  members: TeamAgent[];
  /** Exactly one resolved owner, or null when neither the team nor the workspace names one. */
  accountable: AccountableUser | null;
};

export type WorkspaceLeadView = {
  /** Resolved workspace-lead agent; null when unconfigured or dangling. */
  lead: TeamAgent | null;
  leadAgentSlug: string | null;
  /** The workspace-default owner (source is always 'workspace'). */
  accountable: AccountableUser | null;
};

type UserLite = { id: string; name: string | null; email: string };

/**
 * Resolve team rows + agents + the workspace default into view models.
 * Pure (no DB) so accountability inheritance unit-tests directly;
 * `listTeams` / `getTeam` wrap it.
 * @param opts
 * @param opts.teams
 * @param opts.agents
 * @param opts.workspaceAccountableUserId
 * @param opts.usersById
 */
export function buildTeamViews(opts: {
  teams: TeamRow[];
  agents: TeamAgent[];
  workspaceAccountableUserId: string | null;
  usersById: Map<string, UserLite>;
}): TeamView[] {
  const agentsBySlug = new Map(opts.agents.map(a => [a.slug, a]));
  const byName = (a: TeamAgent, b: TeamAgent) => a.name.localeCompare(b.name);

  return opts.teams
    .map((team) => {
      const lead = team.leadAgentSlug !== null ? agentsBySlug.get(team.leadAgentSlug) ?? null : null;
      const members = opts.agents
        .filter(a => a.teamSlug === team.slug)
        .sort((a, b) => Number(b.slug === team.leadAgentSlug) - Number(a.slug === team.leadAgentSlug) || byName(a, b));
      return {
        slug: team.slug,
        name: team.name,
        description: team.description,
        lead,
        leadAgentSlug: team.leadAgentSlug,
        members,
        accountable: resolveAccountable(team.accountableUserId, opts.workspaceAccountableUserId, opts.usersById),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The inheritance rule (acceptance #6): a team's own owner wins; a team
 * without one shows the workspace default, labeled as inherited; when
 * neither exists the caller renders "no owner" guidance — never a blank.
 * @param teamUserId
 * @param workspaceUserId
 * @param usersById
 */
function resolveAccountable(
  teamUserId: string | null,
  workspaceUserId: string | null,
  usersById: Map<string, UserLite>,
): AccountableUser | null {
  const source: AccountableUser['source'] = teamUserId !== null ? 'team' : 'workspace';
  const userId = teamUserId ?? workspaceUserId;
  const user = userId !== null ? usersById.get(userId) : undefined;
  return user ? { userId: user.id, name: user.name, email: user.email, source } : null;
}

export async function listTeams(orgId: string): Promise<TeamView[]> {
  const [teams, agents, workspace] = await Promise.all([
    db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    listTeamAgents(orgId),
    workspaceDefaults(orgId),
  ]);
  const usersById = await loadUsers([
    ...teams.map(t => t.accountableUserId),
    workspace.accountableUserId,
  ]);
  return buildTeamViews({ teams, agents, workspaceAccountableUserId: workspace.accountableUserId, usersById });
}

export async function getTeam(orgId: string, slug: string): Promise<TeamView | null> {
  const [team] = await db
    .select()
    .from(teamSchema)
    .where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, slug)))
    .limit(1);
  if (!team) {
    return null;
  }
  const [agents, workspace] = await Promise.all([listTeamAgents(orgId), workspaceDefaults(orgId)]);
  const usersById = await loadUsers([team.accountableUserId, workspace.accountableUserId]);
  return buildTeamViews({ teams: [team], agents, workspaceAccountableUserId: workspace.accountableUserId, usersById })[0] ?? null;
}

/**
 * The workspace-lead band: the project-level lead agent + the
 * workspace-default owner. Distinct from any team.
 * @param orgId
 */
export async function getWorkspaceLead(orgId: string): Promise<WorkspaceLeadView> {
  const [workspace, agents] = await Promise.all([workspaceDefaults(orgId), listTeamAgents(orgId)]);
  const usersById = await loadUsers([workspace.accountableUserId]);
  const user = workspace.accountableUserId !== null ? usersById.get(workspace.accountableUserId) : undefined;
  return {
    lead: workspace.leadAgentSlug !== null ? agents.find(a => a.slug === workspace.leadAgentSlug) ?? null : null,
    leadAgentSlug: workspace.leadAgentSlug,
    accountable: user ? { userId: user.id, name: user.name, email: user.email, source: 'workspace' } : null,
  };
}

function listTeamAgents(orgId: string): Promise<TeamAgent[]> {
  return db
    .select({
      slug: agentSchema.slug,
      name: agentSchema.name,
      description: agentSchema.description,
      icon: agentSchema.icon,
      accent: agentSchema.accent,
      teamSlug: agentSchema.teamSlug,
    })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, orgId));
}

async function workspaceDefaults(orgId: string): Promise<{ leadAgentSlug: string | null; accountableUserId: string | null }> {
  const [project] = await db
    .select({ leadAgentSlug: projectSchema.leadAgentSlug, accountableUserId: projectSchema.accountableUserId })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return project ?? { leadAgentSlug: null, accountableUserId: null };
}

async function loadUsers(ids: Array<string | null>): Promise<Map<string, UserLite>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: userSchema.id, name: userSchema.name, email: userSchema.email })
    .from(userSchema)
    .where(inArray(userSchema.id, wanted));
  return new Map(rows.map(u => [u.id, u]));
}
