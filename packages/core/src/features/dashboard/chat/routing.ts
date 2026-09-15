import type { AgentOption, ContextRef } from './types';

/**
 * One conversational identity per workspace (agent-chat-surface.md §9.10):
 * the WORKSPACE AGENT — shown by the workspace's name ("Ask Revenue"),
 * implemented as the workspace lead's config plus the delegation roster. The
 * person never picks an agent; the lead routes to specialists through
 * delegation, which the rail shows as live rows and a "via <specialist>"
 * eyebrow on a routed reply. Two explicit power paths, both per turn:
 *
 *   - `@agent` / `@team` in the composer routes THAT turn to the specialist
 *     (a team tag routes to the team's lead).
 *   - `/search <query>` runs the retrieval-only path (no model in the loop).
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

/**
 * The empty state's chips for the workspace agent: the lead's own
 * suggestions first, then one from each team lead, capped — no agent names,
 * one workspace voice. Used when the server sent no workspace chips.
 * @param agents - The agents this surface knows (lead first).
 * @param cap - Maximum chips.
 */
export function workspaceChips(agents: AgentOption[], cap = 4): Array<{ label: string; prompt: string }> {
  const leadSlug = defaultAgentSlug(agents);
  const lead = agents.find(a => a.slug === leadSlug);
  const out: Array<{ label: string; prompt: string }> = [...(lead?.suggestions ?? [])];
  const teamLeads = agents.filter(a => a.slug !== leadSlug && a.slug !== '__search__' && a.role === 'lead');
  for (const tl of teamLeads) {
    const first = tl.suggestions?.[0];
    if (first && !out.some(c => c.prompt === first.prompt)) {
      out.push(first);
    }
  }
  return out.slice(0, cap);
}

/** The retrieval-only path as a slash command: `/search <query>`. */
export const SEARCH_COMMAND = /^\/search\s([\s\S]*)$/i;

/**
 * Split a `/search …` command off the message. Returns `searchOnly: true`
 * with the bare query when the person asked for retrieval only.
 * @param text - What the person typed.
 */
export function parseSearchCommand(text: string): { text: string; searchOnly: boolean } {
  const m = SEARCH_COMMAND.exec(text.trim());
  const query = m?.[1]?.trim() ?? '';
  return m && query ? { text: query, searchOnly: true } : { text, searchOnly: false };
}
