import { describe, expect, it } from 'vitest';
import { ContinuationJoin, cutOffMidSentence, needsJoinSpace, repeatedLead } from './truncation';

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

describe('a continuation joined to where it stopped', () => {
  const prior = 'The request card is on your screen — approving it is what writes the record.\n\nTwo corrections, now that I have checked:\n\n**There';
  const again = 'een — approving it is what writes the record.\n\nTwo corrections, now that I have checked:\n\n**There is still no request on file.**';

  it('finds the repeat of the answer\'s end at the continuation\'s start (conversation 349)', () => {
    const k = repeatedLead(prior, again);

    expect(`${prior}${again.slice(k)}`).toBe('The request card is on your screen — approving it is what writes the record.\n\nTwo corrections, now that I have checked:\n\n**There is still no request on file.**');
  });

  it('never takes a few shared letters for a repeat', () => {
    expect(repeatedLead('Two corrections:\n\n**The', 're is still nothing on file.')).toBe(0);
    expect(repeatedLead('It is filed', ' as request #12.')).toBe(0);
  });

  it('streams: holds while the start could still be a repeat, then releases it without the repeat', () => {
    const join = new ContinuationJoin(prior);
    let out = '';
    for (let i = 0; i < again.length; i += 5) {
      out += join.push(again.slice(i, i + 5));
    }
    out += join.flush();

    expect(`${prior}${out}`).not.toContain('Thereeen');
    expect(out).toBe(' is still no request on file.**');
  });

  it('releases a continuation that is not a repeat after the first characters that differ', () => {
    const join = new ContinuationJoin(prior);

    // " is" occurs in the answer, so it waits one delta; " is still" does not.
    expect(join.push(' is')).toBe('');
    expect(join.push(' still')).toBe(' is still');
    expect(join.push(' open.')).toBe(' open.');
    expect(join.flush()).toBe('');
  });
});

describe('the join never glues two words (prod: "**Mylast message")', () => {
  it('puts a space between a finished, capitalized word and a continuation that forgot one', () => {
    expect(needsJoinSpace('**My', 'last message')).toBe(true);

    const join = new ContinuationJoin('**My');
    const out = join.push('last message') + join.flush();

    expect(out).toBe(' last message');
    expect(`**My${out}`).toBe('**My last message');
  });

  it('leaves a continuation alone when it already drew its own boundary', () => {
    expect(needsJoinSpace('I changed', ' the title')).toBe(false);

    const join = new ContinuationJoin('I changed');

    expect(join.push(' the title')).toBe(' the title');
    expect('I changed' + ' the title').toBe('I changed the title');
  });

  it('stays glued when the model resumed mid-word — a lowercase fragment, not a whole word', () => {
    expect(needsJoinSpace('cont', 'inuation')).toBe(false);

    const join = new ContinuationJoin('cont');
    const out = join.push('inuation');

    expect(out).toBe('inuation');
    expect(`cont${out}`).toBe('continuation');
  });

  it('adds nothing when there is nothing to release, or the join is not letter-to-letter', () => {
    expect(needsJoinSpace('cont', '')).toBe(false);
    expect(needsJoinSpace('Ends with punctuation.', 'Next sentence.')).toBe(false);
    expect(needsJoinSpace('version 2', '0 releases')).toBe(false);
    expect(needsJoinSpace('', 'anything')).toBe(false);
  });
});
