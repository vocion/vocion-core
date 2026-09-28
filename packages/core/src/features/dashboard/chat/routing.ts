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
 * The built-in, virtual search-only entry. It is appended to every agent list
 * so retrieval works before any agent is authored — which means the list is
 * NEVER empty, which means "has this workspace got agents?" cannot be asked
 * by counting it. Ask `hasWorkspaceAgents` instead.
 */
export const SEARCH_ONLY_SLUG = '__search__';

/**
 * Whether this workspace has a real agent to answer with.
 *
 * A fresh database has none, and the everything conversation used to fall
 * back to `__search__` and send it — the server then answered
 * `agent __search__ not found in org proj-…`, which is a stack trace dressed
 * as a sentence (CEO's preview, 2026-09-16). An empty workspace is a STATE and
 * gets said as one; a double-underscore slug never reaches a person.
 * @param agents - The agent list a surface was given.
 */
export function hasWorkspaceAgents(agents: AgentOption[]): boolean {
  return agents.some(a => a.slug !== SEARCH_ONLY_SLUG);
}

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

/**
 * The name to show for an agent slug: the roster's, when the roster knows it,
 * else the slug read as words ("product-manager" → "Product manager") — a
 * deleted agent's turns still say who spoke, without a guess at a name.
 * @param slug - The agent's slug, as the runtime ran it.
 * @param agents - The agents this surface knows (the roster).
 * @param fallback - A name to prefer over the humanised slug when the roster does not know the slug (the server's, say).
 */
export function agentDisplayName(slug: string, agents: AgentOption[], fallback?: string): string {
  const known = agents.find(a => a.slug === slug)?.name;
  if (known) {
    return known;
  }
  if (fallback && fallback !== slug) {
    return fallback;
  }
  const words = slug.replace(/^__|__$/g, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/**
 * Whom a turn is attributed to ("via <specialist>"), or null when it is the
 * surface's own agent speaking. The turn's agent is a persisted fact
 * (`agent_slug` on the row, the `turn_agent` frame live) — never something
 * the composer guessed from its tags (backlog 009).
 *
 * Slugs are compared when both sides have one; names only for a turn stamped
 * before slugs travelled. A turn with no agent on it is nobody's to attribute.
 * @param turn - The message's agent, as stamped.
 * @param turn.agentSlug
 * @param turn.agentName
 * @param own - The surface's own agent: the workspace lead on the full-page chat, the conversation's agent beside a document.
 * @param own.slug
 * @param own.name
 * @returns The name to attribute the turn to, or null for the surface's own voice.
 */
export function turnAttribution(turn: { agentSlug?: string; agentName?: string }, own: { slug?: string; name: string }): string | null {
  if (!turn.agentSlug && !turn.agentName) {
    return null;
  }
  const isOwn = own.slug && turn.agentSlug ? turn.agentSlug === own.slug : turn.agentName === own.name;
  if (isOwn) {
    return null;
  }
  return turn.agentName ?? agentDisplayName(turn.agentSlug!, []);
}
