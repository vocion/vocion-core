import { describe, expect, it } from 'vitest';
import { PROGRESS_WORDS } from './progressWords';

describe('the rule for words while the work goes on (2026-10-29)', () => {
  it('forbids grading openers and wrap-ups between steps', () => {
    expect(PROGRESS_WORDS).toContain('"Perfect."');
    expect(PROGRESS_WORDS).toContain('"Great!"');
    expect(PROGRESS_WORDS).toContain('never a wrap-up');
  });
});
