import { describe, expect, it } from 'vitest';
import { learnedFromDecision } from './learnedFromDecision';

/**
 * What the review surface says a decision TAUGHT.
 *
 * The rule under test is that every sentence is true of what the product
 * actually does, in the person's words: a note goes to the feedback queue and
 * may become a rule; a decline keeps the kind asking; a plain approval says
 * nothing beyond its own receipt; and Undo is only offered where there is
 * something to put back.
 */

const base = {
  decision: 'approve' as const,
  actionId: 'hubspot.update',
  runId: 77,
  hasNote: false,
  undoable: false,
};

describe('what a review decision taught', () => {
  it('says nothing after a plain approval: the receipt already said what happened', () => {
    expect(learnedFromDecision(base)).toBeNull();
  });

  it('says a decline keeps the kind coming for approval', () => {
    expect(learnedFromDecision({ ...base, decision: 'reject' })).toEqual({
      title: 'Learned from this',
      description: 'This kind of work keeps coming to you for approval.',
    });
  });

  it('says a written reason will be suggested as a rule, on an approve too', () => {
    expect(learnedFromDecision({ ...base, decision: 'reject', hasNote: true })!.description)
      .toBe('This kind of work keeps coming to you for approval. Your reason will be suggested as a rule if it is new.');
    expect(learnedFromDecision({ ...base, hasNote: true })!.description)
      .toBe('Approvals like this one count toward it doing this kind of work without asking you. Your reason will be suggested as a rule if it is new.');
  });

  it('names a self-update by its noun, because that is the one to recognise later', () => {
    expect(learnedFromDecision({ ...base, actionId: 'agent.revise_prompt' })!.description)
      .toBe('A change to the agent\'s own prompt. Approvals like this one count toward it doing this kind of work without asking you.');
    expect(learnedFromDecision({ ...base, actionId: 'wiki.write_page' })!.description)
      .toBe('A change to the agent\'s own wiki. Approvals like this one count toward it doing this kind of work without asking you.');
  });

  it('never uses the ladder\'s jargon or a dash', () => {
    for (const input of [{ ...base, decision: 'reject' as const }, { ...base, hasNote: true }, { ...base, actionId: 'agent.revise_prompt' }]) {
      const said = learnedFromDecision(input)!.description;

      expect(said).not.toMatch(/ladder|evidence|recorded|—/);
    }
  });

  it('offers Undo only when something reversible actually ran', () => {
    expect(learnedFromDecision({ ...base, actionId: 'agent.revise_prompt', undoable: true })!.undoRunId).toBe(77);
    // A rejection executed nothing, so there is nothing to put back.
    expect(learnedFromDecision({ ...base, decision: 'reject', undoable: true })!.undoRunId).toBeUndefined();
    expect(learnedFromDecision({ ...base, actionId: 'agent.revise_prompt', undoable: false })!.undoRunId).toBeUndefined();
  });
});
