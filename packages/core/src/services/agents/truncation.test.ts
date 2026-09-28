import { describe, expect, it } from 'vitest';
import { cutOffMidSentence } from './truncation';

describe('an answer cut off mid-sentence', () => {
  it('is recognised when a code span or fence is left open, or a sentence stops mid-word', () => {
    expect(cutOffMidSentence('**Scope gate on the pull request.** Six criteria to compare. Head read at `')).toBe(true);
    expect(cutOffMidSentence('Here is the diff summary for the change:\n\n```diff\n+ added line')).toBe(true);
    expect(cutOffMidSentence('The contract was frozen this morning and the change touches three files, so the')).toBe(true);
  });

  it('is not raised for a finished answer, a list, a heading or a table', () => {
    expect(cutOffMidSentence('All six criteria are proven by the screenshots and the tests. Merge it.')).toBe(false);
    expect(cutOffMidSentence('Findings so far on the change:\n\n- AC1 proven by the header screenshot')).toBe(false);
    expect(cutOffMidSentence('A long enough answer that ends on a heading line\n\n## Next steps')).toBe(false);
    expect(cutOffMidSentence('| criterion | status |\n|---|---|\n| AC1 | proven |')).toBe(false);
    expect(cutOffMidSentence('Short')).toBe(false);
  });
});
