import type { AgentOption } from './types';
import { describe, expect, it } from 'vitest';
import { defaultAgentSlug, routeTurn } from './routing';

const AGENTS: AgentOption[] = [
  { slug: 'revenue-director', name: 'Revenue Director', icon: 'bot', placeholder: '', role: 'lead' },
  { slug: 'revenue-lead', name: 'RevOps Lead', icon: 'bot', placeholder: '', role: 'lead', parentSlug: 'revenue-director' },
  { slug: 'proposal-writer', name: 'Proposal Writer', icon: 'bot', placeholder: '', role: 'specialist', parentSlug: 'revenue-lead' },
  { slug: '__search__', name: 'Search only', icon: 'search', placeholder: '' },
];

describe('defaultAgentSlug — the workspace lead, never the last-used pointer', () => {
  it('picks the parentless lead', () => {
    expect(defaultAgentSlug(AGENTS)).toBe('revenue-director');
    expect(defaultAgentSlug([...AGENTS].reverse())).toBe('revenue-director');
  });

  it('falls back to the first real agent, then to search', () => {
    expect(defaultAgentSlug([AGENTS[2]!, AGENTS[3]!])).toBe('proposal-writer');
    expect(defaultAgentSlug([AGENTS[3]!])).toBe('__search__');
  });
});

describe('routeTurn — @agent and @team route one turn', () => {
  it('routes to a tagged agent', () => {
    expect(routeTurn([{ type: 'agent', id: 'proposal-writer', label: 'Proposal Writer' }], AGENTS)?.slug).toBe('proposal-writer');
  });

  it('routes a tagged team to its lead, and ignores tags that name nobody', () => {
    expect(routeTurn([{ type: 'team', id: 'revops', label: 'RevOps', routeTo: 'revenue-lead' }], AGENTS)?.slug).toBe('revenue-lead');
    expect(routeTurn([{ type: 'team', id: 'marketing', label: 'Marketing' }], AGENTS)).toBeNull();
    expect(routeTurn([{ type: 'mission', id: 'daily-brief', label: 'Daily brief' }], AGENTS)).toBeNull();
    expect(routeTurn([], AGENTS)).toBeNull();
  });
});
