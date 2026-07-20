/**
 * Pure display logic for the teams org chart + team detail pages. No DB,
 * no React — everything here unit-tests in node, which is where the
 * F1 acceptance criteria about labels and degraded states get proven
 * (explicit vs inherited ownership #6, graceful states #10–12).
 */

import type { AccountableUser, TeamAgent, TeamView, WorkspaceLeadView } from '@/services/TeamService';

/** How a team's displayed owner was resolved — drives the label + tooltip. */
export type OwnerProvenance = 'explicit' | 'inherited' | 'missing';

/**
 * Classify a resolved owner for labeling. `explicit` renders the bare
 * name; `inherited` renders the mandated visible text "«Name»
 * (workspace default)" (mock-walkthrough fix: text, not a glyph);
 * `missing` renders the "no owner" warning — never a blank.
 * @param accountable - The resolved owner from TeamService, or null.
 */
export function ownerProvenance(accountable: Pick<AccountableUser, 'source'> | null): OwnerProvenance {
  if (accountable === null) {
    return 'missing';
  }
  return accountable.source === 'team' ? 'explicit' : 'inherited';
}

/**
 * A human's display name — name when set, email otherwise. Owners are
 * always shown by name (acceptance #6), never as a bare id.
 * @param accountable - The resolved owner.
 */
export function ownerDisplayName(accountable: Pick<AccountableUser, 'name' | 'email'>): string {
  return accountable.name?.trim() || accountable.email;
}

/**
 * Initials for the owner avatar chip ("Chris Fitkin" → "CF").
 * @param nameOrEmail - Display name or email fallback.
 */
export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail.trim().split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + (second ?? '')).toUpperCase();
}

/**
 * How many teams the workspace lead can actually consult — teams with a
 * resolved lead agent. Backs the band's "Consults N of M teams" line
 * when a team is lead-less (design §2a, acceptance #11).
 * @param teams - The org's team views.
 */
export function consultCoverage(teams: Array<Pick<TeamView, 'lead'>>): { consulted: number; total: number; partial: boolean } {
  const consulted = teams.filter(t => t.lead !== null).length;
  return { consulted, total: teams.length, partial: consulted < teams.length };
}

/**
 * Agents that belong to no team — rendered as the "not on a team yet"
 * strip so nothing vanishes from the org chart (prod has two parentless
 * agents today). The workspace lead is excluded: it has the band.
 * @param agents - All agents in the org (TeamAgent shape).
 * @param teams - The org's teams (for dangling teamSlug detection).
 * @param workspaceLeadSlug - The workspace lead's slug, if configured.
 */
export function ungroupedAgents(
  agents: TeamAgent[],
  teams: Array<Pick<TeamView, 'slug'>>,
  workspaceLeadSlug: string | null,
): TeamAgent[] {
  const teamSlugs = new Set(teams.map(t => t.slug));
  return agents
    .filter(a => a.slug !== workspaceLeadSlug)
    .filter(a => a.teamSlug === null || !teamSlugs.has(a.teamSlug))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The sample-seed button renders ONLY on a workspace with zero teams —
 * once anything real exists the one-click apply disappears (trio call:
 * gate it, plan §decision 2).
 * @param teamCount - Number of teams in the workspace.
 */
export function showSeedSampleButton(teamCount: number): boolean {
  return teamCount === 0;
}

/**
 * True when SOME accountable human exists — the workspace default or
 * any per-team owner. False triggers the page-level "set a workspace
 * owner" warning banner (acceptance #12): never silently ownerless.
 * @param workspace - The workspace-lead view (carries the default owner).
 * @param teams - The org's team views.
 */
export function hasOwnerAnywhere(
  workspace: Pick<WorkspaceLeadView, 'accountable'>,
  teams: Array<Pick<TeamView, 'accountable'>>,
): boolean {
  return workspace.accountable !== null || teams.some(t => t.accountable !== null);
}

/** Slim skill shape the approval boundary needs. */
export type BoundarySkill = { slug: string; category: string | null; requiresApproval: string | null };

/**
 * Derive the team's plain-language approval boundary from its members'
 * wired skills: reads run freely; mutations (or anything flagged
 * requiresApproval) are drafted for approval. Design §2b's "what runs
 * free / what waits" rail group.
 * @param memberSkillSlugs - Each member's `skillSlugs` list.
 * @param skills - The org's skills (slug, category, requiresApproval).
 */
export function approvalBoundary(
  memberSkillSlugs: Array<string[] | null | undefined>,
  skills: BoundarySkill[],
): { total: number; gated: number } {
  const bySlug = new Map(skills.map(s => [s.slug, s]));
  const wired = new Set(memberSkillSlugs.flatMap(list => list ?? []));
  let gated = 0;
  for (const slug of wired) {
    const skill = bySlug.get(slug);
    if (skill && (skill.category === 'mutation' || skill.requiresApproval === 'true')) {
      gated += 1;
    }
  }
  return { total: wired.size, gated };
}
