/**
 * The router's rule, pinned: `handles` outranks description, description
 * outranks suggestions, a tie goes to initiative, then to the lead, and
 * nothing convincing means the lead answers with the reason written down.
 */
import type { RoutableAgent } from './router';
import { describe, expect, it } from 'vitest';
import { chooseAgent, MIN_ROUTE_SCORE, readInitiative, scoreAgent, topicWords } from './router';

const lead: RoutableAgent = {
  slug: 'revenue-lead',
  name: 'Revenue lead',
  description: 'Runs the revenue workspace: pipeline, deals, forecasts and the people who own them.',
  handles: ['pipeline', 'deals', 'forecast'],
  suggestions: [{ label: 'Pipeline review', prompt: 'Walk the pipeline and name what moved.' }],
};

const researcher: RoutableAgent = {
  slug: 'wiki-researcher',
  name: 'Wiki researcher',
  description: 'Answers first and writes it down: researches a question against the wiki, the knowledge index and the web.',
  handles: ['wiki', 'standing rules', 'research', 'plans', 'decisions'],
  suggestions: [{ label: 'Research this', prompt: 'Research the following against the wiki first.' }],
  initiative: 'high',
};

const curator: RoutableAgent = {
  slug: 'wiki-curator',
  name: 'Wiki curator',
  description: 'Keeps the workspace wiki true, small and read: merges duplicates, prunes what nobody reads.',
  handles: ['wiki curation', 'duplicates'],
  initiative: 'low',
};

const roster = [lead, researcher, curator];

describe('topicWords', () => {
  it('drops stopwords and short words, and adds a crude singular', () => {
    const words = topicWords('What are our standing rules about plans and decisions?');

    expect(words.has('what')).toBe(false);
    expect(words.has('are')).toBe(false);
    expect(words).toEqual(new Set(['standing', 'rules', 'rule', 'plans', 'plan', 'decisions', 'decision']));
  });
});

describe('scoreAgent', () => {
  it('scores a handles phrase above a description word above a suggestion word', () => {
    const message = 'Please research what the wiki says about our forecast';
    const words = topicWords(message);
    const r = scoreAgent(researcher, message, words);
    const l = scoreAgent(lead, message, words);

    // "research" and "wiki" are handles phrases (3 each); "wiki" and "research" also sit in the description.
    expect(r.matched).toEqual(expect.arrayContaining(['handles: wiki', 'handles: research']));
    expect(r.score).toBeGreaterThan(l.score);
    // The lead's "forecast" handle matched too — one phrase.
    expect(l.matched).toContain('handles: forecast');
  });

  it('matches a multi-word handle when all its words are present, at the lower weight', () => {
    const message = 'Are these rules still standing?';
    const c = scoreAgent(researcher, message, topicWords(message));

    expect(c.matched).toContain('handles: standing rules');
    expect(c.score).toBe(2);
  });
});

describe('chooseAgent', () => {
  it('routes to the agent whose handles match', () => {
    const d = chooseAgent({ agents: roster, message: 'What does the wiki say about our house voice?', leadSlug: 'revenue-lead', surface: 'chat' })!;

    expect(d.chosen).toBe('wiki-researcher');
    expect(d.defaulted).toBe(false);
    expect(d.reason).toMatch(/wiki-researcher matched handles: wiki/);
    expect(d.candidates[0]).toMatchObject({ slug: 'wiki-researcher', initiative: 'high' });
    expect(d.candidates.map(c => c.slug)).toContain('revenue-lead');
    expect(d.surface).toBe('chat');
  });

  it('breaks an exact tie on initiative, and says so', () => {
    // Both wiki agents handle "wiki" exactly; the message says nothing else that scores.
    const a: RoutableAgent = { slug: 'a-agent', name: 'A', handles: ['wiki'], initiative: 'normal' };
    const b: RoutableAgent = { slug: 'b-agent', name: 'B', handles: ['wiki'], initiative: 'high' };
    const d = chooseAgent({ agents: [a, b], message: 'wiki', leadSlug: 'a-agent', surface: 'chat' })!;

    expect(d.chosen).toBe('b-agent');
    expect(d.reason).toMatch(/Tied with a-agent; b-agent has more initiative \(high over normal\)/);
  });

  it('with equal initiative a tie goes to the workspace lead', () => {
    const a: RoutableAgent = { slug: 'a-agent', name: 'A', handles: ['wiki'] };
    const b: RoutableAgent = { slug: 'b-agent', name: 'B', handles: ['wiki'] };
    const d = chooseAgent({ agents: [a, b], message: 'wiki', leadSlug: 'b-agent', surface: 'chat' })!;

    expect(d.chosen).toBe('b-agent');
    expect(d.reason).toMatch(/is the workspace lead/);
  });

  it('defaults to the lead when nothing clears the bar, with the reason', () => {
    const d = chooseAgent({ agents: roster, message: 'Good morning, how are things?', leadSlug: 'revenue-lead', surface: 'mcp' })!;

    expect(d.chosen).toBe('revenue-lead');
    expect(d.defaulted).toBe(true);
    expect(d.reason).toMatch(/workspace lead answers/);
    expect(d.candidates.every(c => c.score < MIN_ROUTE_SCORE)).toBe(true);
  });

  it('defaults to the first active agent when the project names no lead, and never to an inactive one', () => {
    const inactiveLead: RoutableAgent = { ...lead, active: 'false' };
    const d = chooseAgent({ agents: [inactiveLead, curator, researcher], message: 'hello', leadSlug: 'revenue-lead', surface: 'chat' })!;

    expect(d.chosen).toBe('wiki-curator');
    expect(d.candidates.map(c => c.slug)).not.toContain('revenue-lead');
  });

  it('is null for a roster with nobody active', () => {
    expect(chooseAgent({ agents: [{ ...lead, active: false }], message: 'hi', surface: 'chat' })).toBeNull();
  });

  it('is deterministic across roster order', () => {
    const forward = chooseAgent({ agents: roster, message: 'Merge the duplicates in the wiki', leadSlug: 'revenue-lead', surface: 'chat' })!;
    const reversed = chooseAgent({ agents: [...roster].reverse(), message: 'Merge the duplicates in the wiki', leadSlug: 'revenue-lead', surface: 'chat' })!;

    expect(forward.chosen).toBe(reversed.chosen);
    expect(forward.candidates.map(c => c.slug)).toEqual(reversed.candidates.map(c => c.slug));
  });
});

describe('readInitiative', () => {
  it('reads null and anything unexpected as normal', () => {
    expect(readInitiative(null)).toBe('normal');
    expect(readInitiative('eager')).toBe('normal');
    expect(readInitiative('high')).toBe('high');
    expect(readInitiative('low')).toBe('low');
  });
});
