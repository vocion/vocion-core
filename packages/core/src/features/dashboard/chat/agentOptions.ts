import type { AgentOption } from './types';
import { listAgents } from '@/services/AgentService';

/**
 * Built-in virtual agent — corpus search without an LLM in the loop.
 * Always appended to the agent list so users have a fallback path
 * even before any agents are authored.
 */
const SEARCH_ONLY_AGENT: AgentOption = {
  slug: '__search__',
  name: 'Search only',
  icon: 'search',
  placeholder: 'Search across your connected systems…',
};

/**
 * Builds the agent list the chat surfaces (full page + floating bubble)
 * pick from. Leads sort first — you brief the Lead; specialists are there
 * when you need to go direct.
 * @param orgId - Organization ID for which to fetch agents
 */
export async function buildAgentOptions(orgId: string): Promise<AgentOption[]> {
  const dbAgents = await listAgents(orgId);
  const ordered = [...dbAgents].sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === 'lead' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return [
    ...ordered.map(a => ({
      slug: a.slug,
      name: a.name,
      icon: 'bot' as const,
      role: (a.role === 'lead' ? 'lead' : 'specialist') as 'lead' | 'specialist',
      eyebrow: a.eyebrow ?? undefined,
      description: a.description ?? undefined,
      suggestions: a.suggestions ?? [],
      placeholder: `Message ${a.name}…`,
    })),
    SEARCH_ONLY_AGENT,
  ];
}
