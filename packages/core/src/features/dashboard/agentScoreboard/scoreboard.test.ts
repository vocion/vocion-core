import type { AgentScore } from '@/services/evals/live/signals';
import { describe, expect, it } from 'vitest';
import { BOARD_COLUMNS, countShare, judgedFlags, onlineLine, readScoreboardQuery, scoreboardHref, turnHref } from './scoreboard';

const score = (over: Partial<AgentScore> = {}): AgentScore => ({ agentSlug: 'pipeline-analyst', level: 'quick', turns: 40, toolCalls: 100, toolErrors: 4, searches: 12, toolFailures: 1, refusedWithAction: 2, claimedSave: 0, flagged: 3, loading: ['history'], lastAt: null, judged: 6, grounded: { passed: 4, of: 5 }, argsCorrect: { passed: 0, of: 0 }, unjustifiedRefusals: 1, ...over });

describe('the scoreboard query', () => {
  it('reads the window and agent, falling back to 30 days and every agent', () => {
    expect(readScoreboardQuery({})).toEqual({ days: 30, agent: null });
    expect(readScoreboardQuery({ days: '7', agent: 'revenue-lead' })).toEqual({ days: 7, agent: 'revenue-lead' });
    expect(readScoreboardQuery({ days: '12', agent: '../etc' })).toEqual({ days: 30, agent: null });
  });

  it('leaves defaults out of the link', () => {
    const q = { days: 30 as const, agent: null };

    expect(scoreboardHref(q, {})).toBe('/dashboard/evals/live');
    expect(scoreboardHref(q, { days: 90, agent: 'revenue-lead' })).toBe('/dashboard/evals/live?days=90&agent=revenue-lead');
    expect(scoreboardHref({ days: 7, agent: 'x' }, { agent: null })).toBe('/dashboard/evals/live?days=7');
  });
});

describe('the board', () => {
  const cell = (key: string) => BOARD_COLUMNS.find(c => c.key === key)!;

  it('says each signal as a count and a share, and marks the ones worth reading', () => {
    const s = score();

    expect(cell('refused').value(s)).toBe('2 (5%)');
    expect(cell('refused').warn(s)).toBe(true);
    expect(cell('claimed').value(s)).toBe('0');
    expect(cell('claimed').warn(s)).toBe(false);
    expect(cell('errors').value(s)).toBe('4%');
    expect(cell('searches').value(s)).toBe('0.3');
  });

  it('shows a dash, not a zero rate, where nothing ran', () => {
    const s = score({ turns: 0, toolCalls: 0 });

    expect(countShare(0, 0)).toBe('—');
    expect(cell('errors').value(s)).toBe('—');
  });

  it('reads the nightly judge\'s sample as passed over applicable, and marks a miss', () => {
    const s = score();

    expect(cell('grounded').value(s)).toBe('4/5');
    expect(cell('grounded').warn(s)).toBe(true);
    expect(cell('args').value(s)).toBe('—');
    expect(cell('args').warn(s)).toBe(false);
  });

  it('turns a judged verdict into the problems it found', () => {
    expect(judgedFlags(null)).toEqual([]);
    expect(judgedFlags({ grounded: false, argsCorrect: null, unjustifiedRefusal: true, completed: true })).toEqual(['judgedUngrounded', 'judgedRefusal']);
    expect(judgedFlags({ grounded: true, argsCorrect: true, unjustifiedRefusal: false, completed: true })).toEqual([]);
  });

  it('links a turn to its conversation only when it had one', () => {
    expect(turnHref({ conversationId: 42 })).toBe('/dashboard/chat/42');
    expect(turnHref({ conversationId: null })).toBeNull();
  });
});

describe('the online evaluation line', () => {
  it('says plainly whether a sample of live turns is being judged', () => {
    expect(onlineLine(null)).toContain('not set up');
    expect(onlineLine(null)).toContain('agent-evals-nightly');
    expect(onlineLine({ enabled: false, samplingPercentage: 5, evaluatorIds: ['Builtin.Correctness'] })).toContain('switched off');
    expect(onlineLine({ enabled: true, samplingPercentage: 5, evaluatorIds: ['Builtin.Correctness'] })).toContain('judges 5% of live sessions (Builtin.Correctness)');
  });
});
