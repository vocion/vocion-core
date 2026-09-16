import { describe, expect, it } from 'vitest';
import { resolveSequenceState } from './sequenceState';

const NURTURE = { id: 'seq-nurture', name: 'Personalized Nurture' };

describe('resolveSequenceState — the four cases, resolved before an Enroll button', () => {
  it('(A) in another sequence with no stated disposition → AMBIGUOUS, and no one-click Enroll', () => {
    const r = resolveSequenceState(
      { id: 'seq-inbound', name: 'Inbound Follow-up', status: 'active', step: 1, totalSteps: 3, kind: 'manual' },
      NURTURE,
      4,
    );

    expect(r.case).toBe('ambiguous');
    expect(r.canEnroll).toBe(false);
    expect(r.approvingWill).toBeNull();
    expect(r.blockedReason).toContain('Inbound Follow-up');
    expect(r.blockedReason).toContain('replaces it or runs alongside it');
  });

  it('(B) already in the recommended sequence → nothing to approve', () => {
    const r = resolveSequenceState({ id: 'seq-nurture', name: 'Personalized Nurture', status: 'active' }, NURTURE, 4);

    expect(r.case).toBe('already-enrolled');
    expect(r.canEnroll).toBe(false);
    expect(r.blockedReason).toContain('already in Personalized Nurture');
  });

  it('(C) enrolled but finished → enrolling is unambiguous, and says the old one is untouched', () => {
    const r = resolveSequenceState({ id: 'seq-inbound', name: 'Inbound Follow-up', status: 'completed' }, NURTURE, 4);

    expect(r.case).toBe('finished');
    expect(r.canEnroll).toBe(true);
    expect(r.approvingWill).toBe('Enroll in Personalized Nurture. Inbound Follow-up already finished and is not affected.');
  });

  it('(D) an automated CRM sequence Vocion proposes replacing → the transaction is stated', () => {
    const r = resolveSequenceState(
      { id: 'seq-auto', name: 'MQL Auto-Nurture', status: 'active', kind: 'automated', step: 1, totalSteps: 3 },
      NURTURE,
      4,
    );

    expect(r.case).toBe('replace-automated');
    expect(r.approvingWill).toBe('Unenroll from MQL Auto-Nurture and enroll in Personalized Nurture.');
    expect(r.canEnroll).toBe(true);
    expect(r.currentLine).toContain('step 1 of 3');
    expect(r.currentLine).toContain('enrolled automatically');
  });

  it('a stated disposition settles the manual case either way, and says which', () => {
    const replace = resolveSequenceState(
      { name: 'Inbound Follow-up', status: 'active', kind: 'manual', disposition: 'replace' },
      NURTURE,
      4,
    );
    const add = resolveSequenceState(
      { name: 'Inbound Follow-up', status: 'active', kind: 'manual', disposition: 'add' },
      NURTURE,
      4,
    );

    expect(replace.approvingWill).toBe('Unenroll from Inbound Follow-up and enroll in Personalized Nurture.');
    expect(add.approvingWill).toBe('Add Personalized Nurture. Inbound Follow-up stays active.');
    expect([replace.canEnroll, add.canEnroll]).toEqual([true, true]);
  });

  it('nothing running → a plain enroll', () => {
    const r = resolveSequenceState({ status: 'none' }, NURTURE, 4);

    expect(r.case).toBe('none');
    expect(r.approvingWill).toBe('Enroll in Personalized Nurture.');
    expect(r.currentLine).toBe('Not in a sequence');
  });

  it('never observed → the page says so and holds the button, instead of guessing', () => {
    for (const current of [null, undefined, { status: 'unknown' }]) {
      const r = resolveSequenceState(current, NURTURE, 4);

      expect(r.case).toBe('ambiguous');
      expect(r.canEnroll).toBe(false);
      expect(r.currentLine).toContain('Not established');
      expect(r.blockedReason).toContain('could mean adding a second one or replacing one');
    }
  });

  it('no recommendation → there is nothing to enroll into', () => {
    const r = resolveSequenceState({ status: 'none' }, null, 0);

    expect(r.canEnroll).toBe(false);
    expect(r.recommendedLine).toBeNull();
  });

  it('the recommended line carries the send count the page is showing', () => {
    expect(resolveSequenceState({ status: 'none' }, NURTURE, 4).recommendedLine).toBe('Personalized Nurture · 4 sends');
    expect(resolveSequenceState({ status: 'none' }, NURTURE, 1).recommendedLine).toBe('Personalized Nurture · 1 send');
  });
});
