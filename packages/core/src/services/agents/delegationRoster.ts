/**
 * Who a lead can hand work to, derived from the registry — never from a
 * hand-written `subagents` list (agent-chat-surface.md §9: one conversation,
 * one lead, routing is delegation).
 *
 * One mechanism, three sources, in this order, de-duplicated by slug:
 *
 *   1. Registered children — agents that name this agent as their parent
 *      (`agent.parent_agent_slug`). Unchanged from before.
 *   2. The WORKSPACE lead (`project.lead_agent_slug`) also gets every team's
 *      lead from the `team` table — "how's the quarter?" consults every team,
 *      with the team named in each entry for provenance.
 *   3. Team members: the workspace lead gets every team's members too, and a
 *      TEAM lead gets its own team's members (`agent.team_slug`). deepagents
 *      subagents cannot delegate further, so a lead that could only reach the
 *      team leads could never reach the specialist who actually drafts the
 *      brief. Members carry their team's name in the description so the lead
 *      can route by team as well as by role.
 *
 * Lead-less teams are returned by name so the caller can say "no lead yet"
 * per team instead of silently omitting one.
 */

import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema, teamSchema } from '@/models/Schema';

export type DelegateEntry = {
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Where the entry came from — surfaced in the PR/debug, not the prompt. */
  source: 'child' | 'team-lead' | 'team-member';
};

export type DelegationRoster = {
  delegates: DelegateEntry[];
  /** Display names of teams with no lead — the caller renders "no lead yet". */
  leadlessTeams: string[];
  /** True when this agent is the workspace lead. */
  isWorkspaceLead: boolean;
};

type AgentRow = typeof agentSchema.$inferSelect;
type TeamRow = typeof teamSchema.$inferSelect;

/**
 * Pure fold over the rows, so the ordering and de-duplication rules unit-test
 * without a database. `deriveDelegationRoster` loads the rows and calls this.
 * @param opts
 * @param opts.lead - The agent being compiled.
 * @param opts.children - Agents whose `parentAgentSlug` is the lead.
 * @param opts.teams - Every team in the workspace.
 * @param opts.teamAgents - Every agent that has a `teamSlug`, plus every team lead.
 * @param opts.isWorkspaceLead - Whether the lead is `project.lead_agent_slug`.
 */
export function buildDelegationRoster(opts: {
  lead: Pick<AgentRow, 'slug'>;
  children: AgentRow[];
  teams: TeamRow[];
  teamAgents: AgentRow[];
  isWorkspaceLead: boolean;
}): DelegationRoster {
  const delegates: DelegateEntry[] = [];
  const taken = new Set<string>([opts.lead.slug]);
  const push = (a: AgentRow, description: string, source: DelegateEntry['source']) => {
    if (taken.has(a.slug)) {
      return;
    }
    taken.add(a.slug);
    delegates.push({ slug: a.slug, name: a.name, description, systemPrompt: a.systemPrompt ?? `You are ${a.name}.`, source });
  };

  for (const c of opts.children) {
    push(c, c.description ?? c.name, 'child');
  }

  const byTeam = (slug: string) => opts.teamAgents.filter(a => a.teamSlug === slug);
  const ownTeams = opts.isWorkspaceLead ? opts.teams : opts.teams.filter(t => t.leadAgentSlug === opts.lead.slug);

  if (opts.isWorkspaceLead) {
    for (const team of opts.teams) {
      const lead = opts.teamAgents.find(a => a.slug === team.leadAgentSlug);
      if (lead) {
        push(lead, `${lead.name} — lead of the ${team.name} team. Consult for: ${team.description ?? lead.description ?? `the ${team.name} team's status and work`}.`, 'team-lead');
      }
    }
  }
  for (const team of ownTeams) {
    for (const member of byTeam(team.slug)) {
      push(member, `${member.name} — ${team.name} team. ${member.description ?? ''}`.trim(), 'team-member');
    }
  }

  return {
    delegates,
    leadlessTeams: opts.isWorkspaceLead ? opts.teams.filter(t => t.leadAgentSlug === null).map(t => t.name) : [],
    isWorkspaceLead: opts.isWorkspaceLead,
  };
}

/**
 * Load the rows and derive the roster for one agent.
 * @param orgId
 * @param lead - The agent row being compiled.
 */
export async function deriveDelegationRoster(orgId: string, lead: AgentRow): Promise<DelegationRoster> {
  const [project] = await db
    .select({ leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  const isWorkspaceLead = project?.leadAgentSlug === lead.slug;

  const children = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.parentAgentSlug, lead.slug)));

  const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId));
  const relevantTeams = isWorkspaceLead ? teams : teams.filter(t => t.leadAgentSlug === lead.slug);
  const wanted = new Set<string>();
  for (const t of relevantTeams) {
    if (t.leadAgentSlug) {
      wanted.add(t.leadAgentSlug);
    }
  }
  const teamSlugs = relevantTeams.map(t => t.slug);
  const teamAgents = teamSlugs.length > 0 || wanted.size > 0
    ? await db
        .select()
        .from(agentSchema)
        .where(and(
          eq(agentSchema.orgId, orgId),
          teamSlugs.length > 0 && wanted.size > 0
            ? inArrayEither(teamSlugs, [...wanted])
            : teamSlugs.length > 0
              ? inArray(agentSchema.teamSlug, teamSlugs)
              : inArray(agentSchema.slug, [...wanted]),
        ))
    : [];

  return buildDelegationRoster({ lead, children, teams, teamAgents, isWorkspaceLead });
}

/**
 * `team_slug IN (…) OR slug IN (…)` — members of the relevant teams plus their
 * leads, which may sit outside those teams' `team_slug`.
 * @param teamSlugs
 * @param leadSlugs
 */
function inArrayEither(teamSlugs: string[], leadSlugs: string[]) {
  return or(inArray(agentSchema.teamSlug, teamSlugs), inArray(agentSchema.slug, leadSlugs));
}
