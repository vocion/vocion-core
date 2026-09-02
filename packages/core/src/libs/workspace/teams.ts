/**
 * Team validation (F1). Teams are authored as workspace/<org>/teams/
 * <slug>.yaml (slug from filename); agents join one via `team:`; the
 * workspace lead + default accountable human live in workspace.yaml.
 *
 * Everything here is opt-in: a workspace with no teams/ dir and no
 * `lead:`/`accountableUser:` keys skips every rule below, so deployed
 * workspaces keep applying byte-for-byte (acceptance #13).
 *
 * Flatness needs no validator — neither the manifest nor the table has
 * a parent field, so a team-inside-a-team is inexpressible.
 */

type TeamsAgent = {
  slug: string;
  team?: string;
  sourceFile: string;
};

type TeamsTeam = {
  slug: string;
  lead?: string;
  accountableUser?: string;
  sourceFile: string;
};

type TeamsManifest = {
  lead?: string;
  accountableUser?: string;
};

export function assertTeams(agents: TeamsAgent[], teams: TeamsTeam[], manifest: TeamsManifest): void {
  const errors: string[] = [];
  const agentSlugs = new Set(agents.map(a => a.slug));
  const teamSlugs = new Set(teams.map(t => t.slug));

  // A team's lead must be an agent in this workspace.
  for (const team of teams) {
    if (team.lead !== undefined && !agentSlugs.has(team.lead)) {
      errors.push(`${team.sourceFile}: team "${team.slug}" has unknown lead "${team.lead}" — no agent with that slug in this workspace`);
    }
  }

  // A lead's own `team:` (when authored) must be the team it leads.
  // When omitted, apply auto-assigns it — see effectiveTeamSlug().
  const teamsLedBy = new Map<string, string[]>();
  for (const team of teams) {
    if (team.lead !== undefined) {
      teamsLedBy.set(team.lead, [...(teamsLedBy.get(team.lead) ?? []), team.slug]);
    }
  }

  for (const agent of agents) {
    // `team:` refs are validated only when the workspace defines teams —
    // team-less workspaces keep the legacy free-text label behavior.
    if (teams.length > 0 && agent.team !== undefined && !teamSlugs.has(agent.team)) {
      errors.push(`${agent.sourceFile}: agent "${agent.slug}" references missing team "${agent.team}" — no teams/${agent.team}.yaml in this workspace (defined teams: ${[...teamSlugs].join(', ') || 'none'})`);
    }
    const leads = teamsLedBy.get(agent.slug) ?? [];
    if (agent.team !== undefined && leads.length > 0 && !leads.includes(agent.team)) {
      errors.push(`${agent.sourceFile}: agent "${agent.slug}" leads team "${leads.join('", "')}" but authors team "${agent.team}" — a lead belongs to the team it leads (or omit team: to auto-assign)`);
    }
  }

  // The workspace lead must resolve to an agent.
  if (manifest.lead !== undefined && !agentSlugs.has(manifest.lead)) {
    errors.push(`workspace.yaml: workspace lead "${manifest.lead}" is not an agent in this workspace`);
  }

  if (errors.length > 0) {
    throw new Error(`teams invalid:\n  ${errors.join('\n  ')}`);
  }

  // Accountability gaps are guidance, not failures (acceptance #12):
  // nothing crashes, nothing invents an owner — but check says so plainly.
  if (teams.length > 0 && manifest.accountableUser === undefined) {
    const uncovered = teams.filter(t => t.accountableUser === undefined).map(t => t.slug);
    if (uncovered.length > 0) {
      console.warn(`[workspace] no accountable owner for team(s) ${uncovered.join(', ')} and no workspace-level accountableUser to inherit — set \`accountableUser:\` in workspace.yaml so every team has an accountable person.`);
    }
  }
}

/**
 * The team an agent lands on at apply: its authored `team:` when the
 * workspace defines teams, else the ONE team it leads (a lead belongs
 * to its own team without re-stating it). Returns null for team-less
 * agents — and for the ambiguous multi-team-lead case, which authoring
 * an explicit `team:` resolves.
 * @param agent
 * @param agent.slug
 * @param agent.team
 * @param teams
 */
export function effectiveTeamSlug(agent: { slug: string; team?: string }, teams: Array<{ slug: string; lead?: string }>): string | null {
  if (teams.length === 0) {
    return null;
  }
  if (agent.team !== undefined) {
    return agent.team;
  }
  const led = teams.filter(t => t.lead === agent.slug);
  return led.length === 1 ? led[0]!.slug : null;
}
