/**
 * Mission roster resolution — F1 "consult the leads", mission path.
 *
 * Who works a mission when no explicit `{lead, members}` team is given?
 *  - the WORKSPACE LEAD (`project.lead_agent_slug`): its reports are
 *    TEAMS, so the roster is each team's lead from the `team` table.
 *    Lead-less teams can't be consulted; their names are returned so
 *    the caller surfaces them in the brief ("no lead yet") instead of
 *    silently omitting them (acceptance #5).
 *  - any other lead: the specialists reporting to it via
 *    `agent.parent_agent_slug` — unchanged pre-F1 behavior (see 0041).
 *  - a specialist: itself alone (empty members).
 * A workspace lead in a workspace with NO team rows falls back to the
 * parent lookup, so the deployed pre-teams shape keeps working even
 * once `lead:` is authored (acceptance #13).
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema, teamSchema } from '@/models/Schema';

export type MissionRoster = {
  team: { lead: string; members: string[] };
  /** Display names of teams with no lead — rendered "no lead yet" in the brief. */
  leadlessTeams: string[];
};

export async function resolveMissionRoster(orgId: string, leadSlug: string): Promise<MissionRoster> {
  const [project] = await db
    .select({ leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);

  if (project?.leadAgentSlug === leadSlug) {
    const teams = await db
      .select({ name: teamSchema.name, leadAgentSlug: teamSchema.leadAgentSlug })
      .from(teamSchema)
      .where(eq(teamSchema.orgId, orgId));
    if (teams.length > 0) {
      const members = [...new Set(
        teams
          .map(t => t.leadAgentSlug)
          .filter((slug): slug is string => slug !== null && slug !== leadSlug),
      )];
      return {
        team: { lead: leadSlug, members },
        leadlessTeams: teams.filter(t => t.leadAgentSlug === null).map(t => t.name),
      };
    }
  }

  const specialists = await db
    .select({ slug: agentSchema.slug })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.parentAgentSlug, leadSlug)));
  return { team: { lead: leadSlug, members: specialists.map(s => s.slug) }, leadlessTeams: [] };
}

/**
 * The brief addendum for lead-less teams. It rides on the mission brief
 * so BOTH the planner prompt and every task message — including the
 * lead's final synthesis (runtime.ts `taskMessage` embeds the brief) —
 * carry it: the quarter answer must say "no lead yet" per team, never
 * silently omit one (acceptance #5).
 * @param leadlessTeams
 */
export function leadlessTeamsNote(leadlessTeams: string[]): string | null {
  if (leadlessTeams.length === 0) {
    return null;
  }
  const plural = leadlessTeams.length > 1;
  return [
    `Note: ${leadlessTeams.map(name => `the ${name} team has no lead yet`).join('; ')}.`,
    `You cannot consult ${plural ? 'those teams' : 'that team'} — state this plainly per team in your final answer (e.g. "${leadlessTeams[0]} has no lead yet"), never silently omit ${plural ? 'them' : 'it'}.`,
  ].join(' ');
}
