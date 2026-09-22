import type { SettledJudgment } from '@/services/inbox/autonomyProposal';
import { describe, expect, it } from 'vitest';
import { AUTONOMY_THRESHOLD, autonomyProposals } from '@/services/inbox/autonomyProposal';

const judgment = (over: Partial<SettledJudgment> = {}): SettledJudgment => ({
  class: 'notify.requester',
  label: 'requester notifications',
  outcome: 'approved',
  edited: false,
  consequence: { level: 'low', reversible: true },
  at: new Date('2026-09-21T10:00:00Z'),
  ...over,
});

const run = (n: number, over: Partial<SettledJudgment> = {}) => Array.from({ length: n }, (_, i) => judgment({ at: new Date(Date.UTC(2026, 8, 21, 8 + i)), ...over }));

describe('autonomyProposal', () => {
  it('turns three unchanged approvals into an offer to stop asking', () => {
    const { proposals } = autonomyProposals(run(AUTONOMY_THRESHOLD));

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.observation).toBe('You approved this kind of action unchanged 3 times.');
    expect(proposals[0]!.proposal).toBe('Recommend allowing requester notifications automatically.');
    expect(proposals[0]!.choices.map(c => c.label)).toEqual(['Allow automatically', 'Keep asking']);
  });

  it('does not propose anything on two, and says how far along it is', () => {
    const { proposals, holds } = autonomyProposals(run(2));

    expect(proposals).toEqual([]);
    expect(holds[0]!.reason).toBe('2 of 3 identical decisions so far.');
  });

  it('will also stop asking about something consistently refused', () => {
    const { proposals } = autonomyProposals(run(3, { outcome: 'rejected' }));

    expect(proposals[0]!.proposal).toBe('Recommend declining requester notifications automatically.');
    expect(proposals[0]!.choices[0]!.label).toBe('Decline automatically');
  });

  it('an edit breaks the run: a person disagreeing in detail is not a rule', () => {
    const history = run(3);
    history[1] = judgment({ edited: true, at: history[1]!.at });

    const { proposals, holds } = autonomyProposals(history);

    expect(proposals).toEqual([]);
    expect(holds[0]!.reason).toBe('1 of 3 identical decisions so far.');
  });

  it('being overruled once resets the count, so a standing proposal cannot go stale', () => {
    const history = [...run(3), judgment({ outcome: 'rejected', at: new Date('2026-09-21T20:00:00Z') })];

    expect(autonomyProposals(history).proposals).toEqual([]);
  });

  it('refuses to propose autonomy over anything that is not low consequence', () => {
    const { proposals, holds } = autonomyProposals(run(3, { consequence: { level: 'high', reversible: true } }));

    expect(proposals).toEqual([]);
    expect(holds[0]!.reason).toMatch(/only as safe as its worst case/);
  });

  it('refuses to propose autonomy over anything that cannot be undone', () => {
    const { proposals, holds } = autonomyProposals(run(3, { consequence: { level: 'low', reversible: false } }));

    expect(proposals).toEqual([]);
    expect(holds[0]!.reason).toMatch(/could not have been undone/);
  });

  it('holds the last one being edited against the whole class', () => {
    const history = [...run(3), judgment({ edited: true, at: new Date('2026-09-21T20:00:00Z') })];

    expect(autonomyProposals(history).holds[0]!.reason).toMatch(/changed before it was approved/);
  });

  it('keeps classes apart and reports them in a stable order', () => {
    const { proposals } = autonomyProposals([
      ...run(3),
      ...run(3, { class: 'objects.update_meta', label: 'ranking updates' }),
    ]);

    expect(proposals.map(p => p.class)).toEqual(['notify.requester', 'objects.update_meta']);
  });

  it('carries the window the run covers, so the offer can show its working', () => {
    const { proposals } = autonomyProposals(run(3));

    expect(proposals[0]!.since).toEqual(new Date(Date.UTC(2026, 8, 21, 8)));
    expect(proposals[0]!.until).toEqual(new Date(Date.UTC(2026, 8, 21, 10)));
  });
});
