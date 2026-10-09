import { describe, expect, it } from 'vitest';
import { describeCardState } from './cardState';

describe('describeCardState', () => {
  const time = () => '7:50 AM';

  it('a ruling reads as its answer, and says when the trust bar chose it (proposal 5210)', () => {
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', choice: { label: 'Show with upsell', byTrustBar: false } }, time)).toEqual({ label: 'You chose Show with upsell', tone: 'green' });
    expect(describeCardState({ status: 'done', approvedByAgent: true, choice: { label: 'Hide on locked rows', byTrustBar: true } }, time)).toEqual({ label: 'Chose Hide on locked rows for you', tone: 'green' });
  });

  it('names one state, never two at once', () => {
    expect(describeCardState({ status: 'undone', decidedBy: 'Sam Okafor', summary: 'removed the source and the documents it had read' }, time).label).toBe('Undone by Sam Okafor — removed the source and the documents it had read');
    expect(describeCardState({ status: null }, time).label).toBe('Waiting on you');
    // Meant to be filed and not: nothing is waiting on anyone (conversation 349).
    expect(describeCardState({ status: null, unfiled: true }, time)).toEqual({ label: 'Not filed', tone: 'red' });
    // A person filed it after all: the run's state wins.
    expect(describeCardState({ status: 'pending', unfiled: true }, time).label).toBe('Waiting on you');
    expect(describeCardState({ status: 'pending' }, time).label).toBe('Waiting on you');
    expect(describeCardState({ status: 'done', approvedByAgent: true, decidedBy: 'Dana Reyes' }, time).label).toBe('Done for you');
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', decidedAt: '2026-09-28T14:50:00Z' }, time).label)
      .toBe('Approved by Dana Reyes · 7:50 AM');
    expect(describeCardState({ status: 'rejected', decidedBy: 'Dana Reyes' }, time).label).toBe('Rejected by Dana Reyes');
    expect(describeCardState({ status: 'rejected' }, time).label).toBe('Rejected');
    expect(describeCardState({ status: 'executing', approvedByAgent: true }, time).label).toBe('Done for you · running');
    expect(describeCardState({ status: 'snoozed' }, time).label).toBe('Deferred');
  });

  it('a done card says what was done, from the run (Chris, 2026-09-28: "Done for you · Undo" did not say it ran)', () => {
    expect(describeCardState({ status: 'done', approvedByAgent: true, summary: 'changed request #124: outcome, mainRisk' }, time))
      .toEqual({ label: 'Done for you — changed request #124: outcome, mainRisk', tone: 'green' });
    expect(describeCardState({ status: 'done', decidedBy: 'Dana Reyes', summary: 'filed request #131' }, time).label).toBe('Approved by Dana Reyes — filed request #131');
    // Only a done run says what it did; a waiting one does not claim it.
    expect(describeCardState({ status: 'pending', summary: 'changed request #124: outcome' }, time).label).toBe('Waiting on you');
  });

  it('a filing that misses its bar reads "Draft needed" until a run exists', () => {
    expect(describeCardState({ status: null, draft: true }, time)).toEqual({ label: 'Draft needed', tone: 'amber' });
    expect(describeCardState({ status: 'pending', draft: true }, time).label).toBe('Waiting on you');
  });
});
