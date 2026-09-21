import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { costLine, deriveWorkQueue, flagsOf, isProbeRow, laneOf, whyLine, workLine } from './workQueue';

/**
 * The four-lane mapping, argued with here rather than in a browser.
 *
 * Every case below came off the live queue at agents.metacto.com: a rename
 * that is building, three recommendations nobody has decided, four queued
 * outcomes with no recorded reason between them, nine finished items and
 * eight probes. The page is only as honest as this file.
 */

const NOW = new Date('2026-09-21T16:00:00Z');

function row(id: number, title: string, meta: Record<string, unknown>, createdAt = NOW): PageRow {
  return { id, title, status: null, createdAt, meta };
}

describe('lanes', () => {
  it('reads the seven states as four lanes', () => {
    expect(laneOf(row(1, 'a', { state: 'new' }))).toBe('next');
    expect(laneOf(row(2, 'b', { state: 'triaged' }))).toBe('next');
    expect(laneOf(row(3, 'c', { state: 'in_scope' }))).toBe('next');
    expect(laneOf(row(4, 'd', { state: 'building' }))).toBe('progress');
    expect(laneOf(row(5, 'e', { state: 'shipped' }))).toBe('done');
    expect(laneOf(row(6, 'f', { state: 'answered' }))).toBe('done');
  });

  it('puts an outcome with no state at all in Next, because it is owed and has not started', () => {
    expect(laneOf(row(7, 'No nightly e2e runner for Send against production', {}))).toBe('next');
  });

  it('waits on the person even while the state says building', () => {
    const building = row(8, 'Rename Send to Stamp', { state: 'building', recommendationState: 'proposed', recommendedOutcome: 'build' });

    expect(laneOf(building)).toBe('waiting');
    expect(workLine(building, 'waiting', NOW)).toBe('waiting on you to decide; Vocion recommends we build it');
  });

  it('does not hold finished work in Waiting over a recommendation nobody closed', () => {
    expect(laneOf(row(9, 'shipped anyway', { state: 'shipped', recommendationState: 'proposed' }))).toBe('done');
  });

  it('leaves the archive out of the queue entirely', () => {
    const rows = [row(10, 'declined', { state: 'out_of_scope' }), row(11, 'queued', { state: 'new' })];

    expect(deriveWorkQueue(rows, { now: NOW }).map(r => r.id)).toEqual([11]);
  });
});

describe('probes', () => {
  it('drops what a harness filed, by how it arrived', () => {
    expect(isProbeRow(row(32, 'e2e 3zhj35: export button does nothing on my phone', { source: 'e2e-suite', state: 'answered' }))).toBe(true);
    expect(isProbeRow(row(23, 'Token probe: the factory writer can create records', { source: 'site-form', state: 'answered' }))).toBe(true);
    expect(isProbeRow(row(24, 'probe', { state: 'answered' }))).toBe(true);
    expect(isProbeRow(row(31, 'Intake smoke test: form attachment', { tags: ['intake', 'smoke-test'], state: 'answered' }))).toBe(true);
  });

  it('keeps a real outcome that is ABOUT probes', () => {
    const real = row(78, 'Filter e2e-suite submissions at intake and tag them test', {
      source: 'chat',
      tags: ['intake', 'e2e', 'factory'],
      state: 'shipped',
    });

    expect(isProbeRow(real)).toBe(false);
    expect(deriveWorkQueue([real], { now: NOW }).map(r => r.id)).toEqual([78]);
  });

  it('keeps probes out of the lanes and out of the counts', () => {
    const rows = [
      row(101, 'e2e 3ee2rh: export button does nothing on my phone', { source: 'e2e-suite', state: 'answered' }),
      row(93, 'e2e to7nx6: export button does nothing on my phone', { source: 'e2e-suite', state: 'answered' }),
      row(87, 'Send a link by email, and use the phone share sheet', { state: 'shipped', actualCents: 592 }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out.map(r => r.id)).toEqual([87]);
    expect(out[0]!.meta.doneCount).toBe(1);
  });
});

describe('next is visibly ordered', () => {
  const reasoned = [
    row(1, 'first', { state: 'triaged', why: ['production_bug'], priority: 90 }),
    row(2, 'second', { state: 'in_scope', why: ['blocks_goal'], priority: 70 }),
    row(3, 'third', { state: 'new', why: ['user_request'], priority: 50 }),
    row(4, 'fourth', { state: 'new', why: ['manual_toil'], priority: 10 }),
  ];

  it('numbers one, two, three and says how many are left', () => {
    const out = deriveWorkQueue(reasoned, { now: NOW });

    expect(out.map(r => r.meta.rank)).toEqual(['1', '2', '3']);
    expect(out.map(r => r.title)).toEqual(['first', 'second', 'third']);
    expect(out[0]!.meta.lane).toBe('Next · 1 more queued');
    expect(out[0]!.meta.nextCount).toBe(4);
  });

  it('does not rank a request with no recorded reason, and queues it behind the ranked work', () => {
    const rows = [
      row(5, 'no reason', { state: 'new' }, new Date('2026-09-01T00:00:00Z')),
      row(1, 'reasoned', { state: 'new', why: ['production_bug'] }, new Date('2026-09-10T00:00:00Z')),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out.map(r => [r.title, r.meta.rank])).toEqual([['reasoned', '1'], ['no reason', undefined]]);
  });

  it('says once, in the heading, that nothing is ranked at all', () => {
    const rows = [
      row(88, 'The planner writes task contracts without reading the repository', { state: 'new' }),
      row(89, 'One page that shows a feature from ask to announcement', { state: 'in_scope' }),
      row(94, 'Review is an event stream, not a queue of decisions', { state: 'in_scope' }),
      row(86, 'No nightly e2e runner for Send against production', {}),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out[0]!.meta.lane).toBe('Next · nothing ranked, no reason recorded on 4 queued');
    expect(out[0]!.meta.unreasonedCount).toBe(4);
    expect(out.every(r => r.meta.rank === undefined)).toBe(true);
  });
});

describe('the lanes carry what they could not draw', () => {
  it('attaches the decision minutes to Waiting', () => {
    const rows = [
      row(30, 'Send has no admin panel', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 15 }),
      row(38, 'Vocion fail endpoint cannot carry the kept branch', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 2 }),
      row(79, 'Vocion: records cannot be updated or removed over REST', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 2 }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out).toHaveLength(3);
    expect(out[0]!.meta.lane).toBe('Waiting on you · about 19 min to decide');
    expect(out[0]!.meta.waitingCount).toBe(3);
  });

  it('caps recently done and points the rest at Activity', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(
      100 + i,
      `shipped ${i}`,
      { state: 'shipped', answeredAt: new Date(NOW.getTime() - i * 3_600_000).toISOString() },
    ));
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out).toHaveLength(5);
    expect(out[0]!.meta.lane).toBe('Done recently · 4 more in Activity');
    expect(out[0]!.meta.doneCount).toBe(9);
    expect(out.map(r => r.title)).toEqual(['shipped 0', 'shipped 1', 'shipped 2', 'shipped 3', 'shipped 4']);
  });

  it('drops work that finished outside the window', () => {
    const old = row(1, 'ancient', { state: 'shipped', answeredAt: '2026-01-01T00:00:00Z' });

    expect(deriveWorkQueue([old], { now: NOW })).toEqual([]);
  });

  it('orders the lanes Next, In progress, Waiting, Done', () => {
    const rows = [
      row(1, 'done', { state: 'shipped', answeredAt: NOW.toISOString() }),
      row(2, 'waiting', { state: 'triaged', recommendationState: 'proposed' }),
      row(3, 'building', { state: 'building' }),
      row(4, 'queued', { state: 'new' }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out.map(r => r.meta.laneKey)).toEqual(['next', 'progress', 'waiting', 'done']);
    expect(out.map(r => r.meta.order)).toEqual([0, 1000, 2000, 3000]);
  });
});

describe('the sentences on a row', () => {
  it('renders the reason codes as human words, never as codes', () => {
    expect(whyLine(row(1, 'a', { why: ['user_request', 'manual_toil'] }))).toBe('a person asked for it · it removes manual toil');
  });

  it('falls back to the manager\'s own sentence, and to nothing at all', () => {
    expect(whyLine(row(2, 'b', { priorityReason: 'the invite email is broken for every new team' })))
      .toBe('the invite email is broken for every new team');
    expect(whyLine(row(3, 'c', {}))).toBeNull();
  });

  it('takes one line of the note, because the analysis belongs on the outcome page', () => {
    const long = 'Intake gap: e2e-suite submissions pollute the real request backlog on every suite run. One asker (send-lead, 2026-09-20). Core to the intake job.';

    expect(whyLine(row(4, 'd', { priorityReason: long })))
      .toBe('Intake gap: e2e-suite submissions pollute the real request backlog on every suite run.');
    expect(whyLine(row(5, 'e', { whyNote: `${'x'.repeat(60)} ${'y'.repeat(80)}` })))
      .toBe(`${'x'.repeat(60)}…`);
  });

  it('says what is happening in the lane\'s own terms', () => {
    expect(workLine(row(1, 'a', { state: 'new' }), 'next', NOW)).toBe('not triaged yet');
    expect(workLine(row(2, 'b', { state: 'in_scope' }), 'next', NOW)).toBe('in scope, not started');
    expect(workLine(row(3, 'c', { state: 'building', taskCount: 5 }), 'progress', NOW)).toBe('building, 5 tasks underway');
    expect(workLine(row(4, 'd', { state: 'shipped', answeredAt: '2026-09-20T16:00:00Z' }), 'done', NOW)).toBe('shipped yesterday');
  });

  it('says money the way the lane makes sense of it', () => {
    expect(costLine(row(1, 'a', { estimateCents: 8500 }), 'next')).toBe('about $85.00');
    expect(costLine(row(2, 'b', { estimateCents: 8500, actualCents: 2412 }), 'progress')).toBe('$24.12 of about $85.00');
    expect(costLine(row(3, 'c', { actualCents: 84 }), 'done')).toBe('$0.84');
    expect(costLine(row(4, 'd', {}), 'next')).toBeNull();
  });

  it('shows a conditional fact only when it is true, and never twice', () => {
    expect(flagsOf(row(1, 'a', {}), 'next')).toEqual([]);
    expect(flagsOf(row(2, 'b', { severity: 'p1', sizeClass: 'major' }), 'next')).toEqual(['urgent', 'major']);
    expect(flagsOf(row(3, 'c', { kind: 'incident' }), 'progress')).toEqual(['urgent']);
    // The Waiting lane's heading already says it, so the row does not.
    expect(flagsOf(row(4, 'd', { recommendationState: 'proposed' }), 'waiting')).toEqual([]);
    expect(flagsOf(row(5, 'e', { recommendationState: 'proposed' }), 'progress')).toEqual(['waiting on you']);
  });

  it('leaves a row with nothing to say empty rather than writing "not recorded"', () => {
    const [only] = deriveWorkQueue([row(1, 'bare', { state: 'new' })], { now: NOW });

    expect(only!.meta.whyLine).toBeUndefined();
    expect(only!.meta.costLine).toBeUndefined();
    expect(only!.meta.flags).toBeUndefined();
  });
});
