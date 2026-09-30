import { describe, expect, it } from 'vitest';
import { DRAW_LOST_MS, fieldValue, mockupAfterRun, mockupDecision, MockupRuleSchema } from './mockupDefault';

const RULE = MockupRuleSchema.parse({ owedWhen: { field: 'surface', oneOf: ['ui', 'flow'] }, skipWhen: [{ field: 'kind', oneOf: ['bug'] }] });
const NOW = new Date('2026-09-30T12:00:00Z');

describe('who owes a mockup', () => {
  it('is the plugin\'s rule, read off the record: a UI surface, not skipped, none yet', () => {
    expect(mockupDecision({ surface: 'ui' }, RULE, NOW)).toEqual({ do: 'draw', attempt: 1 });
    expect(mockupDecision({ surface: 'flow', kind: 'idea' }, RULE, NOW)).toEqual({ do: 'draw', attempt: 1 });
    expect(mockupDecision({ surface: 'infra' }, RULE, NOW)).toEqual({ do: 'skip', why: 'no UI to draw: surface is infra' });
    expect(mockupDecision({ surface: 'ui', kind: 'bug' }, RULE, NOW)).toEqual({ do: 'skip', why: 'kind is bug' });
    expect(mockupDecision({ surface: 'ui', visuals: { mockupArtifactIds: [3] } }, RULE, NOW).do).toBe('skip');
    expect(mockupDecision({ surface: 'ui', visuals: { noVisualReason: 'A copy change in an email.' } }, RULE, NOW)).toEqual({ do: 'skip', why: 'a reason for no visual is recorded' });
  });

  it('reads dotted fields', () => {
    expect(fieldValue({ visuals: { surfaceUrl: '/rooms' } }, 'visuals.surfaceUrl')).toBe('/rooms');
    expect(fieldValue({}, 'visuals.surfaceUrl')).toBeNull();
  });

  it('asks once while a drawing runs, and again once when it was lost', () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

    expect(mockupDecision({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt: 1, at: at(60_000) } } }, RULE, NOW)).toEqual({ do: 'skip', why: 'already being drawn (attempt 1)' });
    expect(mockupDecision({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt: 1, at: at(DRAW_LOST_MS + 1) } } }, RULE, NOW)).toEqual({ do: 'draw', attempt: 2, lastFailure: 'the last drawing started and never finished' });
    expect(mockupDecision({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt: 2, at: at(DRAW_LOST_MS + 1) } } }, RULE, NOW).do).toBe('skip');
    expect(mockupDecision({ surface: 'ui', visuals: { mockupDraw: { state: 'failed', attempt: 2, at: at(1), reason: 'no renderer' } } }, RULE, NOW)).toEqual({ do: 'skip', why: 'drew nothing after 2 attempts: no renderer' });
  });

  it('reads nothing for an update that changed none of the rule\'s fields', () => {
    expect(mockupDecision({ surface: 'ui' }, RULE, NOW, ['acceptance'])).toEqual({ do: 'skip', why: 'the write changed nothing the rule reads' });
    expect(mockupDecision({ surface: 'ui' }, RULE, NOW, ['surface'])).toEqual({ do: 'draw', attempt: 1 });
  });
});

describe('after a drawing', () => {
  const drawing = (attempt: number) => ({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt, at: NOW.toISOString() } } });

  it('is done when the mockups are there', () => {
    expect(mockupAfterRun({ visuals: { mockupArtifactIds: [9] } }, RULE, { reason: '', automationRunId: 1 }, NOW)).toEqual({ do: 'done', why: 'drawn' });
  });

  it('tries once more carrying the reason, then writes it down', () => {
    const first = mockupAfterRun(drawing(1), RULE, { reason: 'the renderer is not available', automationRunId: 7 }, NOW);

    expect(first).toEqual({ do: 'retry', attempt: 2, mark: { state: 'drawing', attempt: 2, at: NOW.toISOString(), reason: 'the renderer is not available', automationRunId: 7 }, line: 'The mockup was not drawn (attempt 1): the renderer is not available. Drawing it once more.' });

    const second = mockupAfterRun(drawing(2), RULE, { reason: 'the renderer is not available', automationRunId: 8 }, NOW);

    expect(second).toMatchObject({ do: 'give-up', mark: { state: 'failed', attempt: 2, reason: 'the renderer is not available' } });
  });
});
