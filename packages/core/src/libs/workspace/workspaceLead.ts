/**
 * The one shared definition of the agent core seeds into a new shared
 * workspace (`templates/workspace/agents/workspace-lead.yaml`) and the skill it
 * sets the workspace up with. Client-safe: the chat surface reads it to tell a
 * workspace that has only its first agent (and so wants the setup starters)
 * from one that has a team.
 *
 * The template file is the truth; `workspaceLead.test.ts` holds these two
 * strings to it, so a rename in one place fails a test instead of a workspace.
 */

/** The seeded workspace lead's slug. */
export const WORKSPACE_LEAD_SLUG = 'workspace-lead';

/** The setup skill the workspace lead mounts. */
export const WORKSPACE_SETUP_SKILL = 'workspace-setup';

/**
 * Whether this roster is a workspace's first day: the seeded lead and nobody
 * else (a virtual entry such as search-only is not a teammate).
 * @param slugs - The real agents' slugs, without virtual entries.
 */
export function onlyTheSeededLead(slugs: readonly string[]): boolean {
  return slugs.length === 1 && slugs[0] === WORKSPACE_LEAD_SLUG;
}

/**
 * Whether the seeded lead outlives an apply of this workspace. It does until
 * the workspace names a lead of its own in `workspace.yaml` (`lead:`): then
 * that agent is the front door, and the seeded one retires like any agent the
 * YAML no longer names. A workspace that names no lead — a fresh folder, or
 * one a plugin or an app just switched on — keeps it.
 * @param authoredLead - `workspace.yaml`'s `lead:`, when it has one.
 */
export function seededLeadSurvives(authoredLead: string | null | undefined): boolean {
  return !authoredLead || authoredLead === WORKSPACE_LEAD_SLUG;
}
