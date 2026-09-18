/**
 * What a briefing agent is told — and, deliberately, how little of it is about
 * content rules.
 *
 * "Structural over prompting" (CLAUDE.md). Everything the CEO's review asked
 * for — section order, omitting empty sections, the three-decision budget, the
 * delta-first framing, the on-track honesty, keeping system vocabulary off the
 * page — is enforced by `services/briefings/{document,budget,validate,compose}`
 * and cannot be reached from a tool call. These strings therefore ask only for
 * the two things the model is actually the right instrument for: what it
 * observed, and why it matters today. The last two sentences exist to save the
 * model a round trip, not to carry the rule.
 *
 * Read by `refresh_briefing` and by `briefings.regenerate`, so the scheduled
 * path and the button say the same thing.
 */

/** A team lead assembling its own team's brief. */
export const TEAM_BRIEF_INSTRUCTION = 'Assemble and publish your team\'s daily brief NOW. Read the tracker, your missions and fresh sources (freshen gmail first if relevant). Then call publish_briefing with what you OBSERVED: the metrics you read with their provenance, one clause per metric that moved, why each waiting decision matters TODAY, today\'s critical path, the real exceptions, and the detail tables. Do not write section headings, empty sections, deltas, an on-track status or a decision count — the briefing contract computes all of those and will overrule you. Do not ask for permission.';

/** The workspace lead composing across the teams. */
export const WORKSPACE_BRIEF_INSTRUCTION = 'Assemble and publish the WORKSPACE briefing NOW. Read each team\'s latest brief (get_briefing with team:"<slug>"), then call publish_briefing with rollup:true carrying the SYNTHESIS — not a list of what each team said. Duplicate claims are resolved for you; supply the metrics, the why-now for each waiting decision, today\'s critical path and the real exceptions. Never write "from the <team> briefing": the team briefs are listed as sources automatically. Do not ask for permission.';
