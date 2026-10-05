import { describe, expect, it } from 'vitest';
import { lastAnswerOf } from './lastAnswer';

describe('lastAnswerOf (Chris, 2026-10-05: steps leaked into a Slack reply)', () => {
  it('keeps the words after the last tool call', () => {
    expect(lastAnswerOf('I\'ll check the rollup.\n\nThe team is idle.', 'I\'ll check the rollup.')).toBe('The team is idle.');
  });

  it('keeps the whole answer when no tool ran, nothing followed the last one, or the answer was rebuilt', () => {
    expect(lastAnswerOf('The team is idle.', '')).toBe('The team is idle.');
    expect(lastAnswerOf('I\'ll check the rollup.', 'I\'ll check the rollup.')).toBe('I\'ll check the rollup.');
    expect(lastAnswerOf('A different answer.', 'I\'ll check the rollup.')).toBe('A different answer.');
  });
});
