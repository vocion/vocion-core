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
  // in "consulted". The ask now marks the phrase it adds, in both tenses.
  const headline = { running: 'asking Northwind Revenue', done: 'asked Northwind Revenue' };

  it('a step that marks its own phrase says it as written', () => {
    const asked = { kind: 'delegate' as const, status: 'done' as const, label: 'Asked Northwind Revenue', headline };

    expect(stepHeadline([asked, { kind: 'draft', status: 'done', label: 'Recommended an action', tool: 'recommend_action' }])).toBe('Asked Northwind Revenue and recommended an action');
    // Never re-cased: the workspace's name keeps its capitals mid-line.
    expect(stepHeadline([{ kind: 'tool', status: 'done', label: 'Listed your workspaces' }, asked])).toBe('Listed your workspaces and asked Northwind Revenue');
  });

  it('says the ask in the present tense while it is still running', () => {
    const asking = { kind: 'delegate' as const, status: 'progress' as const, label: 'Asking Northwind Revenue', headline };

    expect(stepHeadline([{ kind: 'tool', status: 'done', label: 'Listed your workspaces' }, asking])).toBe('Listed your workspaces and asking Northwind Revenue');
    expect(stepHeadline([{ ...asking, status: 'start' }, { kind: 'tool', status: 'done', label: 'Listed your workspaces' }])).toBe('Asking Northwind Revenue and listed your workspaces');
  });

  it('an ask that failed still names what was asked, and counts the failure', () => {
    const failed = { kind: 'delegate' as const, status: 'error' as const, label: 'Northwind Revenue could not answer', headline };

    expect(stepHeadline([failed, { kind: 'tool', status: 'done', label: 'Listed your workspaces' }])).toBe('Asked Northwind Revenue and listed your workspaces · 1 failed');
  });

  // A thread from 5.0 stored the ask with `labels` whose finished tense was
  // "<Workspace> answered" and no marked phrase. It reads as a consult of the
  // workspace, never as "northwind Revenue answered" with the name re-cased.
  it('an ask stored by 5.0 reads as consulting the workspace', () => {
    const stored = { kind: 'delegate' as const, status: 'done' as const, label: 'Northwind Revenue answered', labels: { running: 'Asking Northwind Revenue', done: 'Northwind Revenue answered' } };
    const line = stepHeadline([{ kind: 'tool', status: 'done', label: 'Listed your workspaces' }, stored]);

    expect(line).toBe('Listed your workspaces and consulted Northwind Revenue');
    expect(line).not.toContain('northwind');
  });

  it('reasoning alone is said as such', () => {
    expect(stepHeadline([{ kind: 'reason', status: 'done', label: 'Thought through it' }])).toBe('Thought it through');
    expect(stepHeadline([], 4)).toBe('Grounded in 4 sources');
  });
});
