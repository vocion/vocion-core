import type { AgentOption } from './types';
import { describe, expect, it } from 'vitest';
import { defaultAgentSlug, parseSearchCommand, routeTurn, workspaceChips } from './routing';

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

describe('workspaceChips — one workspace voice', () => {
  it('takes the lead\'s chips, then one per team lead, capped, without duplicates', () => {
    const agents: AgentOption[] = [
      { ...AGENTS[0]!, suggestions: [{ label: 'Quarter', prompt: 'How is the quarter?' }, { label: 'Risks', prompt: 'What is at risk?' }] },
      { ...AGENTS[1]!, suggestions: [{ label: 'Pipeline', prompt: 'Pipeline health?' }, { label: 'x', prompt: 'x' }] },
      { slug: 'gtm-lead', name: 'GTM Lead', icon: 'bot', placeholder: '', role: 'lead', parentSlug: 'revenue-director', suggestions: [{ label: 'Quarter dup', prompt: 'How is the quarter?' }, { label: 'Inbound', prompt: 'Any inbound?' }] },
      AGENTS[2]!,
      AGENTS[3]!,
    ];

    expect(workspaceChips(agents).map(c => c.prompt)).toEqual(['How is the quarter?', 'What is at risk?', 'Pipeline health?']);
    expect(workspaceChips(agents, 2)).toHaveLength(2);
  });
});

describe('parseSearchCommand', () => {
  it('recognises /search and returns the bare query', () => {
    expect(parseSearchCommand('/search northwind governance')).toEqual({ text: 'northwind governance', searchOnly: true });
    expect(parseSearchCommand('  /SEARCH  MSA unsigned ')).toEqual({ text: 'MSA unsigned', searchOnly: true });
    expect(parseSearchCommand('search the deal')).toEqual({ text: 'search the deal', searchOnly: false });
    expect(parseSearchCommand('/search')).toEqual({ text: '/search', searchOnly: false });
  });
});
