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

  // 5.0 screen capture: an assistant's ask read "Consulted Northwind Revenue
  // answered and recommended an action" — the row's own "X answered" wrapped
  // in "consulted". A delegate row that names both of its tenses already says
  // what was done.
  it('a delegate that names its own tenses says them as written', () => {
    const asked = { kind: 'delegate' as const, status: 'done' as const, label: 'Asked Northwind Revenue', labels: { running: 'Asking Northwind Revenue', done: 'Asked Northwind Revenue' } };

    expect(stepHeadline([asked, { kind: 'draft', status: 'done', label: 'Recommended an action', tool: 'recommend_action' }])).toBe('Asked Northwind Revenue and recommended an action');
    expect(stepHeadline([{ kind: 'tool', status: 'done', label: 'Listed your workspaces' }, asked])).toBe('Listed your workspaces and asked Northwind Revenue');
  });

  it('an ask that failed still names what was asked, and counts the failure', () => {
    const failed = { kind: 'delegate' as const, status: 'error' as const, label: 'Northwind Revenue could not answer', labels: { running: 'Asking Northwind Revenue', done: 'Asked Northwind Revenue' } };

    expect(stepHeadline([failed, { kind: 'tool', status: 'done', label: 'Listed your workspaces' }])).toBe('Asked Northwind Revenue and listed your workspaces · 1 failed');
  });

  it('reasoning alone is said as such', () => {
    expect(stepHeadline([{ kind: 'reason', status: 'done', label: 'Thought through it' }])).toBe('Thought it through');
    expect(stepHeadline([], 4)).toBe('Grounded in 4 sources');
  });
});
