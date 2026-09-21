import { describe, expect, it } from 'vitest';
import { learnedFromDecision } from './learnedFromDecision';

/**
 * What the review surface says a decision TAUGHT.
 *
 * The rule under test is that every sentence is true of what the product
 * actually does: a note goes to the feedback queue and may become a rule; a
 * bare click is still counted as agreement or disagreement on the ladder; and
 * Undo is only offered where there is something to put back.
 */

const base = {
  decision: 'approve' as const,
  actionId: 'hubspot.update',
  runId: 77,
  hasNote: false,
  undoable: false,
};

describe('what a review decision taught', () => {
  it('counts an approval as agreement the ladder climbs on', () => {
    expect(learnedFromDecision(base)).toEqual({
      title: 'Learned from this',
      description: 'Agreement recorded — evidence this kind climbs the ladder on.',
    });
  });

  it('counts a rejection as a disagreement that keeps the kind asking', () => {
    expect(learnedFromDecision({ ...base, decision: 'reject' }).description)
      .toBe('Disagreement recorded — this kind keeps asking.');
  });

  it('says a written reason is queued to become a rule', () => {
    expect(learnedFromDecision({ ...base, decision: 'reject', hasNote: true }).description)
      .toBe('Disagreement recorded — this kind keeps asking. Your reason is queued to become a rule if nobody has said it before.');
  });

  it('names a self-update by its noun, because that is the one to recognise later', () => {
    expect(learnedFromDecision({ ...base, actionId: 'agent.revise_prompt' }).description)
      .toBe('A self-update to the prompt. Agreement recorded — evidence this kind climbs the ladder on.');
    expect(learnedFromDecision({ ...base, actionId: 'wiki.write_page' }).description)
      .toBe('A self-update to the wiki. Agreement recorded — evidence this kind climbs the ladder on.');
  });

  it('offers Undo only when something reversible actually ran', () => {
    expect(learnedFromDecision({ ...base, undoable: true }).undoRunId).toBe(77);
    // A rejection executed nothing, so there is nothing to put back.
    expect(learnedFromDecision({ ...base, decision: 'reject', undoable: true }).undoRunId).toBeUndefined();
    expect(learnedFromDecision({ ...base, undoable: false }).undoRunId).toBeUndefined();
  });
});
