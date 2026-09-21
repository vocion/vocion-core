import { describe, expect, it } from 'vitest';
import { stepHeadline } from './stepHeadline';

describe('stepHeadline', () => {
  it('says what the work was: research plus the artifact', () => {
    const line = stepHeadline([
      { kind: 'search', status: 'done', label: 'Searched sources', tool: 'search_knowledge' },
      { kind: 'search', status: 'done', label: 'Searched the web', tool: 'web_search' },
      { kind: 'tool', status: 'done', label: 'Read the brand guide', tool: 'get_brand' },
      { kind: 'tool', status: 'done', label: 'Wrote the document', tool: 'render_markdown' },
    ], 30);

    expect(line).toBe('Researched 30 sources, wrote the document and read the brand guide');
  });

  it('a single search with no sources keeps its own words', () => {
    expect(stepHeadline([{ kind: 'search', status: 'done', label: 'Searched the data room' }])).toBe('Searched the data room');
  });

  it('caps at three phrases and counts the rest, and names failures', () => {
    const steps = ['a', 'b', 'c', 'd'].map(x => ({ kind: 'tool' as const, status: 'done' as const, label: `Did ${x}` }));

    expect(stepHeadline(steps)).toBe('Did a, did b and did c, +1 more');
    expect(stepHeadline([{ kind: 'tool', status: 'error', label: 'Read the brand guide' }])).toBe('Read the brand guide · 1 failed');
  });

  it('a delegate reads as consulting the specialist', () => {
    expect(stepHeadline([{ kind: 'delegate', status: 'done', label: 'Proposal Writer finished' }])).toBe('Consulted Proposal Writer');
  });

  it('reasoning alone is said as such', () => {
    expect(stepHeadline([{ kind: 'reason', status: 'done', label: 'Thought through it' }])).toBe('Thought it through');
    expect(stepHeadline([], 4)).toBe('Grounded in 4 sources');
  });
});
