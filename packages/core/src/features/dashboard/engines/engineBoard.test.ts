/**
 * The Engines page's arithmetic (ADR 0005): the URL's window, source and
 * engine; a column per engine, never a missing one; each table line; and
 * where a run row links.
 */
import type { EngineScore } from '@/services/factory/engineRun';
import { describe, expect, it } from 'vitest';
import { BOARD_LINES, boardColumns, duration, emptyLine, enginesHref, money, pct, readEnginesQuery, runLinks, sizeSplit } from './engineBoard';

const score = (engine: string, over: Partial<EngineScore> = {}): EngineScore => ({ engine, source: 'factory', runs: 4, running: 1, prs: 3, qaPassed: 2, qaFailed: 1, accepted: 1, merged: 1, reverted: 0, failed: 0, prRate: 1, qaPassRate: 0.667, acceptRate: 0.5, medianDurationS: 245, totalCents: 1234, centsPerLanded: 617, guardViolations: 2, retries: 1, models: ['model-large'], byComplexity: { small: 3, large: 1 }, ...over });

describe('the URL', () => {
  it('reads the window, source and engine, and falls back to 30 days of real work', () => {
    expect(readEnginesQuery({})).toEqual({ days: 30, source: 'factory', engine: null });
    expect(readEnginesQuery({ days: '7', source: 'eval', engine: 'openhands' })).toEqual({ days: 7, source: 'eval', engine: 'openhands' });
    expect(readEnginesQuery({ days: '45', source: 'prod', engine: 'Bad Engine!' })).toEqual({ days: 30, source: 'factory', engine: null });
    expect(readEnginesQuery({ days: ['7', '90'] })).toEqual({ days: 30, source: 'factory', engine: null });
  });

  it('writes links that change one thing and leave the defaults out', () => {
    const q = readEnginesQuery({});

    expect(enginesHref('engines', q, {})).toBe('/dashboard/p/engines');
    expect(enginesHref('engines', q, { days: 90 })).toBe('/dashboard/p/engines?days=90');
    expect(enginesHref('engines', { ...q, days: 7 }, { engine: 'openhands' })).toBe('/dashboard/p/engines?days=7&engine=openhands');
    expect(enginesHref('engines', { ...q, engine: 'openhands' }, { source: 'eval', engine: null })).toBe('/dashboard/p/engines?source=eval');
  });
});

describe('the columns', () => {
  it('always has claude-cli and openhands, in that order, an empty one saying it has no runs', () => {
    const cols = boardColumns([score('claude-cli')], 'factory');

    expect(cols.map(c => [c.engine, c.runs])).toEqual([['claude-cli', 4], ['openhands', 0]]);
  });

  it('adds codex and any other engine with runs, and shows only the source asked for', () => {
    const cols = boardColumns([score('zed'), score('codex'), score('openhands'), score('claude-cli', { source: 'eval' })], 'factory');

    expect(cols.map(c => [c.engine, c.runs])).toEqual([['claude-cli', 0], ['openhands', 4], ['codex', 4], ['zed', 4]]);
  });
});

describe('the lines', () => {
  it('reads every figure the scoreboard has, and dashes where there is nothing', () => {
    const line = (k: string, e: EngineScore) => BOARD_LINES.find(l => l.key === k)!.value(e);
    const e = score('openhands');

    expect(BOARD_LINES.map(l => l.key)).toEqual(['runs', 'prRate', 'qaPassRate', 'acceptRate', 'medianDurationS', 'totalCents', 'centsPerLanded', 'guardViolations', 'retries', 'size']);
    expect(['runs', 'prRate', 'qaPassRate', 'acceptRate', 'medianDurationS', 'totalCents', 'centsPerLanded', 'guardViolations', 'retries', 'size'].map(k => line(k, e)))
      .toEqual(['4 (1 running)', '100%', '67%', '50%', '4m 05s', '$12.34', '$6.17', '2', '1', 'small 3 · large 1']);

    const none = boardColumns([], 'factory')[1]!;

    expect(BOARD_LINES.map(l => l.value(none))).toEqual(['0', '—', '—', '—', '—', '—', '—', '—', '—', '—']);
  });

  it('formats', () => {
    expect(pct(null)).toBe('—');
    expect(money(5)).toBe('$0.05');
    expect(duration(3725)).toBe('1h 02m');
    expect(sizeSplit({ unknown: 2, medium: 1 })).toBe('medium 1 · unknown 2');
  });
});

describe('a run row', () => {
  it('links its run, task, feature and pull request', () => {
    expect(runLinks({ workerRunId: 41, taskId: 9, requestId: 7, prUrl: 'https://github.example/kestrel/app/pull/3' })).toEqual({
      run: '/dashboard/p/runs/41',
      task: '/dashboard/objects/9',
      feature: '/dashboard/p/feature/7',
      pr: 'https://github.example/kestrel/app/pull/3',
    });
  });

  it('links nothing it does not have, and never a URL that is not https', () => {
    expect(runLinks({ workerRunId: null, taskId: null, requestId: null, prUrl: 'javascript:alert(1)' })).toEqual({ run: null, task: null, feature: null, pr: null });
  });
});

describe('the empty state', () => {
  it('says what is missing and how it fills', () => {
    const q = readEnginesQuery({});

    expect(emptyLine(q, 3)).toBeNull();
    expect(emptyLine(q, 0)).toContain('No engineering runs in the last 30 days');
    expect(emptyLine({ ...q, engine: 'openhands' }, 0)).toContain('No openhands runs in the last 30 days');
    expect(emptyLine({ ...q, engine: 'openhands' }, 0)).toContain('harness.engine');
    expect(emptyLine({ ...q, source: 'eval' }, 0)).toContain('import-eval-runs');
  });
});
