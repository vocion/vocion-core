import type { AgentOption, ContextRef } from './types';

/**
 * One conversation, one lead, routing is delegation (agent-chat-surface.md
 * §9). The person talks to the workspace lead; the lead hands work to
 * specialists through delegation, which the rail shows as live rows. Two
 * explicit overrides exist and both are per turn or per conversation, never
 * a sticky preference:
 *
 *   - `@agent` / `@team` in the composer routes THAT turn to the specialist
 *     (a team tag routes to the team's lead). The conversation stays with the
 *     lead; the reply is rendered under the specialist's name.
 *   - "Talk directly to a specialist…" in the ⋯ menu starts a conversation
 *     WITH that specialist; "Back to <lead>" returns.
 */

/**
 * The agent a fresh conversation opens with: the workspace lead, which `loadChatAgentContext` orders first.
 * @param agents
 */
export function defaultAgentSlug(agents: AgentOption[]): string {
  const lead = agents.find(a => a.role === 'lead' && !a.parentSlug && a.slug !== '__search__') ?? agents.find(a => a.slug !== '__search__') ?? agents[0];
  return lead?.slug ?? '__search__';
}

/**
 * Who answers THIS turn, given the composer's tags: the first `@agent`, or
 * the lead of the first `@team` that names one. Null = the conversation's
 * own agent.
 * @param refs - The turn's context refs (composer tags).
 * @param agents - The agents this surface knows.
 */
export function routeTurn(refs: ContextRef[], agents: AgentOption[]): AgentOption | null {
  for (const ref of refs) {
    if (ref.type === 'agent') {
      const hit = agents.find(a => a.slug === ref.id);
      if (hit) {
        return hit;
      }
    }
    if (ref.type === 'team' && ref.routeTo) {
      const hit = agents.find(a => a.slug === ref.routeTo);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}
