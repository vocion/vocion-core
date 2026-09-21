import { describe, expect, it } from 'vitest';
import { chainReAsks, chaseLine, citedAskIds } from './reAskChain';

function ask(id: number, minute = 0, text: { title?: string; body?: string; sourceRef?: string } = {}) {
  return {
    id,
    title: text.title ?? `ask ${id}`,
    body: text.body ?? null,
    sourceRef: text.sourceRef ?? null,
    createdAt: new Date(Date.UTC(2026, 8, 21, 0, minute)),
  };
}

describe('citedAskIds', () => {
  it('reads the forms the factory actually writes', () => {
    expect(citedAskIds('Ask #71 is still open')).toEqual([71]);
    expect(citedAskIds('every-asker-hears-back:ask-69-system-failure-check-9')).toEqual([69]);
    expect(citedAskIds('asks-61-64:check6')).toEqual([61, 62, 63, 64]);
  });

  it('expands an en-dash range, which is how the escalations are written', () => {
    expect(citedAskIds('Asks #61–64 open 2 checks').sort((a, b) => a - b)).toEqual([61, 62, 63, 64]);
  });

  it('does not expand a range that runs backwards or runs away', () => {
    expect(citedAskIds('#64-61')).toEqual([64]);
    expect(citedAskIds('#1-9999')).toEqual([1]);
  });

  it('is empty for text with no citation', () => {
    expect(citedAskIds('req 39 shipped in release 345836d')).toEqual([]);
    expect(citedAskIds(null)).toEqual([]);
    expect(citedAskIds('')).toEqual([]);
  });
});

describe('chainReAsks', () => {
  it('folds a chase into the decision it chases', () => {
    const chains = chainReAsks([ask(69, 0), ask(71, 10, { body: 'Ask #69 has been open for 5 consecutive checks' })]);

    expect(chains).toHaveLength(1);
    expect(chains[0]!.root.id).toBe(69);
    expect(chains[0]!.chases.map(c => c.id)).toEqual([71]);
    expect(chains[0]!.lastChasedAt).toEqual(new Date(Date.UTC(2026, 8, 21, 0, 10)));
  });

  it('folds a chase of a chase into the original decision, not the reminder', () => {
    const chains = chainReAsks([
      ask(68, 0),
      ask(69, 10, { body: 'Ask #68 has been open 3 checks' }),
      ask(71, 20, { body: 'Ask #69 is still open' }),
      ask(79, 30, { body: 'Ask #71 (filed check 9) is still open' }),
    ]);

    expect(chains).toHaveLength(1);
    expect(chains[0]!.root.id).toBe(68);
    expect(chains[0]!.chases.map(c => c.id)).toEqual([69, 71, 79]);
  });

  it('never merges two decisions because one reminder bundled them', () => {
    const chains = chainReAsks([
      ask(78, 0, { title: 'Is Slate e2e in scope?' }),
      ask(80, 5, { title: 'Approve task contracts for the e2e runner' }),
      ask(84, 10, { body: 'Ask #80 and ask #78 both need your approval' }),
    ]);

    expect(chains.map(c => c.root.id)).toEqual([78, 80]);
    expect(chains.find(c => c.root.id === 78)!.chases.map(c => c.id)).toEqual([84]);
    expect(chains.find(c => c.root.id === 80)!.chases).toEqual([]);
  });

  it('ignores a citation of an ask that is not open, so a gap request id is not a chase', () => {
    const chains = chainReAsks([ask(97, 0, { body: 'Gap request #2584 needs your approval' })]);

    expect(chains).toHaveLength(1);
    expect(chains[0]!.chases).toEqual([]);
  });

  it('does not let a decision swallow one filed after it', () => {
    const chains = chainReAsks([ask(10, 0, { body: 'see #20' }), ask(20, 10)]);

    expect(chains.map(c => c.root.id)).toEqual([10, 20]);
  });

  it('does not depend on the order rows came back', () => {
    const rows = [ask(68, 0), ask(69, 10, { body: 'Ask #68' }), ask(71, 20, { body: 'Ask #69' })];
    const forward = chainReAsks(rows);
    const backward = chainReAsks([...rows].reverse());

    expect(backward.map(c => c.root.id)).toEqual(forward.map(c => c.root.id));
    expect(backward[0]!.chases.map(c => c.id)).toEqual(forward[0]!.chases.map(c => c.id));
  });

  it('leaves an ordinary ask alone', () => {
    const chains = chainReAsks([ask(59), ask(66, 5)]);

    expect(chains.map(c => c.root.id)).toEqual([59, 66]);
    expect(chains.every(c => c.chases.length === 0)).toBe(true);
  });

  it('collapses the production storm of 2026-09-21 to one decision', () => {
    // #61-64 filed together, then chased once per scheduled check.
    const rows = [
      ask(61, 0, { title: 'Own the release notes for the observability releases (req 41)?' }),
      ask(67, 120, { body: 'Asks #61 and #64 are still open', sourceRef: 'every-asker-hears-back:escalation:asks-61-64:check6' }),
      ask(68, 125, { body: 'Asks #61–64 have been open since check 4' }),
      ask(69, 240, { body: 'Ask #68 has been open for 3 consecutive checks' }),
      ask(70, 241, { body: 'Ask #68 has been open for 3 consecutive checks' }),
      ask(71, 480, { body: 'Ask #69 has been open for 5 consecutive scheduled checks' }),
      ask(77, 600, { body: 'Ask #71 has been open 2 hours with no response' }),
      ask(79, 601, { body: 'Ask #71 (filed check 9) is still open' }),
    ];
    const chains = chainReAsks(rows);

    expect(chains).toHaveLength(1);
    expect(chains[0]!.root.id).toBe(61);
    expect(chains[0]!.chases).toHaveLength(7);
  });
});

describe('chaseLine', () => {
  it('says nothing when a decision has never been chased', () => {
    expect(chaseLine({ root: ask(59), chases: [], lastChasedAt: null })).toBeNull();
  });

  it('counts the chases it replaced', () => {
    expect(chaseLine({ root: ask(61), chases: [ask(67, 1)], lastChasedAt: new Date() })).toBe('asked again 1 time, still open');
    expect(chaseLine({ root: ask(61), chases: [ask(67, 1), ask(68, 2)], lastChasedAt: new Date() })).toBe('asked again 2 times, still open');
  });
});
