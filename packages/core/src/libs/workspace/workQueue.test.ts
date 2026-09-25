import type { PageRow } from './pageFields';
import { describe, expect, it } from 'vitest';
import { acceptanceLine, acceptanceOf, blockerOf, contractGap, costLine, deriveWorkQueue, flagsOf, isBlocked, isProbeRow, laneOf, stageOf, stateOf, visualArtifactId, visualGap, whyLine, workLine } from './workQueue';

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
  it('reads the seven states as three lanes', () => {
    expect(laneOf(row(1, 'a', { state: 'new' }))).toBe('proposed');
    expect(laneOf(row(2, 'b', { state: 'triaged' }))).toBe('proposed');
    expect(laneOf(row(3, 'c', { state: 'in_scope' }))).toBe('proposed');
    expect(laneOf(row(4, 'd', { state: 'building' }))).toBe('progress');
    expect(laneOf(row(5, 'e', { state: 'shipped' }))).toBe('done');
    expect(laneOf(row(6, 'f', { state: 'answered' }))).toBe('done');
  });

  it('puts an outcome with no state at all in Proposed, because it is owed and has not started', () => {
    expect(laneOf(row(7, 'No nightly e2e runner for Send against production', {}))).toBe('proposed');
  });

  it('keeps a building outcome in progress when its recommendation is undecided, and flags it', () => {
    const building = row(8, 'Rename Send to Stamp', { state: 'building', recommendationState: 'proposed', recommendedOutcome: 'build', taskCount: 5, runningTaskCount: 2 });

    // The lane answers "has a worker got to it", which is yes. That a person
    // still owes a decision is a state on the row, not a lane of its own.
    expect(laneOf(building)).toBe('progress');
    expect(stateOf(building, 'progress')).toBe('Building');
    expect(flagsOf(building, 'progress')).toContain('waiting on you');
  });

  it('tells waiting from blocked: no running task is a wait with a name, Blocked needs an obstacle somebody wrote down', () => {
    // Review, 2026-09-24: "zero running tasks with tasks written reads as
    // Blocked" mislabelled work awaiting dispatch, awaiting QA and ready to
    // merge as failure. Stage, activity and blocker are three facts.
    const dispatch = row(20, 'Nightly deploy run', { state: 'building', taskCount: 3, runningTaskCount: 0 });
    const qa = row(23, 'Retry uploads', { state: 'building', taskCount: 1, runningTaskCount: 0, awaitingReviewTaskCount: 1 });
    const merge = row(24, 'Retry uploads', { state: 'building', taskCount: 1, runningTaskCount: 0, acceptedTaskCount: 1 });
    const moving = row(21, 'Rename Send', { state: 'building', taskCount: 3, runningTaskCount: 1 });
    const starting = row(22, 'Just claimed', { state: 'building', taskCount: 0 });
    const blocked = row(25, 'Connect staging', { state: 'building', taskCount: 2, runningTaskCount: 0, blocker: { what: 'The staging account is not connected', owner: 'chris@example.test', next: 'connect it on /dashboard/connectors' } });

    expect(isBlocked(dispatch)).toBe(false);
    expect(stateOf(dispatch, 'progress')).toBe('Awaiting dispatch');
    expect(workLine(dispatch, 'progress', NOW)).toBe('3 tasks written, none picked up yet. No action needed from you.');
    expect(stateOf(qa, 'progress')).toBe('Awaiting QA');
    expect(workLine(qa, 'progress', NOW)).toBe('Engineering finished. Awaiting QA; no action needed from you.');
    expect(stageOf(qa)).toBe('qa');
    expect(stateOf(merge, 'progress')).toBe('Ready to merge');
    expect(workLine(merge, 'progress', NOW)).toBe('QA approved. The merge is waiting on a person.');
    expect(isBlocked(moving)).toBe(false);
    expect(stateOf(moving, 'progress')).toBe('Building');
    expect(isBlocked(starting)).toBe(false);
    // Blocked: an obstacle, its owner and the one move — nothing derived.
    expect(isBlocked(blocked)).toBe(true);
    expect(blockerOf(blocked)).toEqual({ what: 'The staging account is not connected', owner: 'chris@example.test', next: 'connect it on /dashboard/connectors' });
    expect(stateOf(blocked, 'progress')).toBe('Blocked');
    expect(workLine(blocked, 'progress', NOW)).toBe('The staging account is not connected. chris@example.test to connect it on /dashboard/connectors.');
    // A blocker on finished work is history, not a state.
    expect(isBlocked(row(26, 'done', { state: 'shipped', blocker: { what: 'was stuck once' } }))).toBe(false);
  });

  it('reads the stage off the records, six steps and two exits', () => {
    expect(stageOf(row(1, 'a', { state: 'new' }))).toBe('asked');
    expect(stageOf(row(2, 'b', { state: 'triaged' }))).toBe('asked');
    expect(stageOf(row(3, 'c', { state: 'in_scope' }))).toBe('decided');
    expect(stageOf(row(4, 'd', { state: 'in_scope', taskCount: 2 }))).toBe('planned');
    expect(stageOf(row(5, 'e', { state: 'building', taskCount: 2, runningTaskCount: 1 }))).toBe('building');
    expect(stageOf(row(6, 'f', { state: 'building', taskCount: 2, acceptedTaskCount: 2 }))).toBe('qa');
    expect(stageOf(row(7, 'g', { state: 'shipped' }))).toBe('released');
    expect(stageOf(row(8, 'h', { state: 'answered' }))).toBe('answered');
    expect(stageOf(row(9, 'i', { state: 'deferred' }))).toBe('deferred');
    expect(deriveWorkQueue([row(6, 'f', { state: 'building', taskCount: 2, acceptedTaskCount: 2 })], { now: NOW })[0]?.meta?.stage).toBe('qa');
  });

  it('a deferred outcome is a decision, not a rejection: kept, badged, last in Proposed, with its reason and date', () => {
    const deferred = row(40, 'Dark mode', { state: 'deferred', deferReason: 'Not until Send is in dogfood. Revisit when two customers ask.', deferredUntil: '2026-10-15T00:00:00Z', askedAt: '2026-09-01T00:00:00Z' });
    const queued = row(41, 'Fix uploads', { state: 'triaged', why: ['user_asks'], priority: 80, askedAt: '2026-09-20T00:00:00Z' });

    expect(laneOf(deferred)).toBe('proposed');
    expect(stateOf(deferred, 'proposed')).toBe('Deferred');
    expect(workLine(deferred, 'proposed', NOW)).toBe('Deferred until 2026-10-15: Not until Send is in dogfood.');
    expect(deriveWorkQueue([deferred, queued], { now: NOW }).map(r => r.id)).toEqual([41, 40]);
  });

  it('a shipped outcome says whether it helped, or when that will be known', () => {
    expect(stateOf(row(50, 'a', { state: 'shipped', result: 'helped' }), 'done')).toBe('Shipped · helped');
    expect(stateOf(row(51, 'b', { state: 'shipped', result: 'did_not_help' }), 'done')).toBe('Shipped · did not help');
    expect(stateOf(row(52, 'c', { state: 'shipped' }), 'done')).toBe('Shipped');
    expect(workLine(row(53, 'd', { state: 'shipped', result: 'helped', resultNote: 'Upload failures fell from 4.1% to 0.3% (PostHog, 7 days). Nobody has reported a lost upload since.', answeredAt: '2026-09-20T16:00:00Z' }), 'done', NOW)).toBe('Upload failures fell from 4.1% to 0.3% (PostHog, 7 days).');
    expect(workLine(row(54, 'e', { state: 'shipped', answeredAt: '2026-09-20T16:00:00Z', checkAfter: '2026-09-28T00:00:00Z' }), 'done', NOW)).toBe('yesterday · result checked 2026-09-28');
    expect(workLine(row(55, 'f', { state: 'shipped', answeredAt: '2026-09-20T16:00:00Z', checkAfter: '2026-09-10T00:00:00Z' }), 'done', NOW)).toBe('yesterday · result not checked yet');
  });

  it('sorts what has stopped above what is running', () => {
    const rows = [
      row(30, 'moving', { state: 'building', taskCount: 2, runningTaskCount: 1, askedAt: '2026-09-01T00:00:00Z' }),
      row(31, 'stopped', { state: 'building', taskCount: 2, runningTaskCount: 0, askedAt: '2026-09-20T00:00:00Z', blocker: { what: 'checks fail on the shared helper three attempts running', owner: 'product-manager', next: 'revise the contract' } }),
    ];

    // Newer, but blocked — so it leads regardless of age.
    expect(deriveWorkQueue(rows, { now: NOW }).map(r => r.id)).toEqual([31, 30]);
  });

  it('sorts an undecided recommendation above the queue behind it', () => {
    const rows = [
      row(40, 'queued long ago', { state: 'new', askedAt: '2026-09-01T00:00:00Z' }),
      row(41, 'needs a decision', { state: 'new', recommendationState: 'proposed', askedAt: '2026-09-20T00:00:00Z' }),
    ];

    expect(deriveWorkQueue(rows, { now: NOW }).map(r => r.id)).toEqual([41, 40]);
  });

  it('does not hold finished work in progress over a recommendation nobody closed', () => {
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

    expect(out.map(r => r.meta.rank)).toEqual(['1', '2', '3', '4']);
    expect(out.map(r => r.title)).toEqual(['first', 'second', 'third', 'fourth']);
    expect(out[0]!.meta.lane).toBe('Proposed');
    expect(out[0]!.meta.laneNote).toBeUndefined();
    expect(out[0]!.meta.proposedCount).toBe(4);
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

    expect(out[0]!.meta.lane).toBe('Proposed');
    expect(out[0]!.meta.laneNote).toBe('nothing ranked, no reason recorded on 4');
    expect(out[0]!.meta.unreasonedCount).toBe(4);
    expect(out.every(r => r.meta.rank === undefined)).toBe(true);
  });
});

describe('the lanes carry what they could not draw', () => {
  it('stages the decisions: the first few read Decide, in the order a person should read them; the rest are Staged behind the ranked work', () => {
    const waiting = (id: number, extra: Record<string, unknown> = {}) => row(id, `ask ${id}`, { state: 'new', recommendationState: 'proposed', recommendedOutcome: 'build', askedAt: `2026-09-${String(id).padStart(2, '0')}T00:00:00Z`, ...extra });
    const rows = [
      waiting(10),
      waiting(11, { severity: 'major' }),
      waiting(12, { source: 'product-manager', severity: 'p0' }),
      waiting(13, { askedBy: { name: 'Ada Northwind', email: 'ada@northwind.example' }, source: 'chat' }),
      row(14, 'ranked', { state: 'triaged', priority: 70, why: ['user_request'], askedAt: '2026-09-01T00:00:00Z' }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW, decideShown: 2 });

    expect(out.map(r => [r.id, r.meta.state])).toEqual([
      [13, 'Decide'],
      [12, 'Decide'],
      [14, 'Triaged'],
      [11, 'Staged'],
      [10, 'Staged'],
    ]);
    expect(out[3]!.meta.workLine).toBe('Behind 2 decisions — moves up as they land.');
    expect(out[4]!.meta.workLine).toBe('Behind 3 decisions — moves up as they land.');
    expect(out[0]!.meta.laneNote).toBe('2 to decide · 2 staged behind them');
    expect(out[0]!.meta.decidingCount).toBe(2);
    expect(out[0]!.meta.stagedCount).toBe(2);
  });

  it('attaches the decision minutes to Proposed', () => {
    const rows = [
      row(30, 'Send has no admin panel', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 15 }),
      row(38, 'Vocion fail endpoint cannot carry the kept branch', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 2 }),
      row(79, 'Vocion: records cannot be updated or removed over REST', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build', decisionCost: 2 }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out).toHaveLength(3);
    expect(out[0]!.meta.lane).toBe('Proposed');
    expect(out[0]!.meta.laneNote).toBe('3 to decide · about 19 min');
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
    expect(out[0]!.meta.lane).toBe('Done');
    expect(out[0]!.meta.laneNote).toBe('4 more in Activity');
    expect(out[0]!.meta.doneCount).toBe(9);
    expect(out.map(r => r.title)).toEqual(['shipped 0', 'shipped 1', 'shipped 2', 'shipped 3', 'shipped 4']);
  });

  it('drops work that finished outside the window', () => {
    const old = row(1, 'ancient', { state: 'shipped', answeredAt: '2026-01-01T00:00:00Z' });

    expect(deriveWorkQueue([old], { now: NOW })).toEqual([]);
  });

  it('orders the lanes In progress, Proposed, Done', () => {
    const rows = [
      row(1, 'done', { state: 'shipped', answeredAt: NOW.toISOString() }),
      row(2, 'waiting', { state: 'triaged', recommendationState: 'proposed' }),
      row(3, 'building', { state: 'building' }),
      row(4, 'queued', { state: 'new' }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    // Waiting and queued are one lane now, and the decision leads it.
    expect(out.map(r => r.meta.laneKey)).toEqual(['progress', 'proposed', 'proposed', 'done']);
    expect(out.map(r => r.title)).toEqual(['building', 'waiting', 'queued', 'done']);
    expect(out.map(r => r.meta.order)).toEqual([0, 1000, 1001, 2000]);
  });
});

describe('what a row cannot show', () => {
  it('asks nothing of work a person never looks at', () => {
    expect(visualGap(row(1, 'a', { surface: 'infra', state: 'new' }), 'proposed')).toBeNull();
    expect(visualGap(row(2, 'b', { surface: 'data', state: 'new' }), 'proposed')).toBeNull();
    expect(visualGap(row(3, 'c', { surface: 'none', state: 'new' }), 'proposed')).toBeNull();
  });

  it('claims no gap for an outcome nobody has classified', () => {
    // Otherwise every row the day this shipped reads "surface not set", and a
    // column where every entry is the same complaint reports nothing.
    expect(visualGap(row(4, 'd', { state: 'new' }), 'proposed')).toBeNull();
    expect(visualGap(row(5, 'e', { state: 'shipped' }), 'done')).toBeNull();
  });

  it('wants a mock before a visual change is decided, and an after before it closes', () => {
    expect(visualGap(row(6, 'f', { surface: 'ui', state: 'new' }), 'proposed')).toBe('no mock');
    expect(visualGap(row(7, 'g', { surface: 'flow', state: 'new' }), 'proposed')).toBe('no mock');
    expect(visualGap(row(8, 'h', { surface: 'ui', state: 'shipped' }), 'done')).toBe('no after');
  });

  it('is closed by the picture itself', () => {
    expect(visualGap(row(9, 'i', { surface: 'ui', visuals: { beforeArtifactIds: [12] } }), 'proposed')).toBeNull();
    // The platform's drawing is not a mockup: the gap stays until Design files one.
    expect(visualGap(row(10, 'j', { surface: 'ui', state: 'new', visuals: { drawnArtifactId: 77 } }), 'proposed')).toBe('no mock');
    // Nor is it a list thumbnail: a row's picture is a real one or none (Chris, 2026-09-25).
    expect(visualArtifactId(row(10, 'j', { surface: 'ui', state: 'new', visuals: { drawnArtifactId: 77 } }), 'proposed')).toBeNull();
    expect(visualArtifactId(row(11, 'k', { surface: 'ui', state: 'new', visuals: { drawnArtifactId: 77, beforeArtifactIds: [12] } }), 'proposed')).toBe(12);
    expect(visualGap(row(10, 'j', { surface: 'ui', state: 'shipped', visuals: { afterArtifactIds: [13] } }), 'done')).toBeNull();
    // A before does not close a done row: the question there is what shipped.
    expect(visualGap(row(11, 'k', { surface: 'ui', state: 'shipped', visuals: { beforeArtifactIds: [14] } }), 'done')).toBe('no after');
  });

  it('is closed by a reason somebody wrote down, never by a silent skip', () => {
    expect(visualGap(row(12, 'l', { surface: 'ui', visuals: { noVisualReason: 'copy-only change behind a flag' } }), 'proposed')).toBeNull();
    // Blank is not a reason.
    expect(visualGap(row(13, 'm', { surface: 'ui', visuals: { noVisualReason: '   ' } }), 'proposed')).toBe('no mock');
  });

  it('asks nothing of work already being built', () => {
    expect(visualGap(row(14, 'n', { surface: 'ui', state: 'building' }), 'progress')).toBeNull();
  });

  it('names the gap on the row that has it, never as a complaint in the lane heading', () => {
    const rows = [
      row(20, 'needs a mock', { surface: 'ui', state: 'new' }),
      row(21, 'has one', { surface: 'ui', state: 'new', visuals: { beforeArtifactIds: [1] } }),
      row(22, 'not visual', { surface: 'infra', state: 'new' }),
    ];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out[0]!.meta.laneNote ?? '').not.toContain('without a visual');
    expect(out.map(r => r.meta.visualGap)).toContain('no mock');
  });
});

describe('the contract between a person and the factory', () => {
  const crit = (statement: string, met?: boolean) => (met === undefined ? { statement } : { statement, met });

  it('says how many criteria a proposal carries, so a person knows what they are agreeing to', () => {
    const two = row(1, 'a', { state: 'new', acceptance: [crit('links resolve'), crit('sessions unaffected')] });

    expect(acceptanceLine(two, 'proposed')).toBe('2 criteria');
    expect(acceptanceLine(row(2, 'b', { state: 'new', acceptance: [crit('one thing')] }), 'proposed')).toBe('1 criterion');
  });

  it('reports a proposal with nothing written down, because that is not a contract', () => {
    // "Done when it works" is not a contract: nobody can tell whether it was
    // met. An outcome put in front of a person with nothing written is the
    // gap, reported the way an unranked queue and a missing mockup already are.
    // Said on the feature page, not on every row that has none.
    expect(acceptanceLine(row(3, 'c', { state: 'new' }), 'proposed')).toBeNull();
    expect(acceptanceLine(row(4, 'd', { state: 'new', acceptance: [] }), 'proposed')).toBeNull();
  });

  it('switches to how much holds once the work is running', () => {
    // By then the question is no longer "what did we agree" but "how much of
    // it is true".
    const building = row(5, 'e', {
      state: 'building',
      acceptance: [crit('a', true), crit('b', true), crit('c')],
    });

    expect(acceptanceLine(building, 'progress')).toBe('2 of 3 met');
    expect(acceptanceLine(building, 'done')).toBe('2 of 3 met');
  });

  it('says all of them when a finished item met every one', () => {
    const done = row(6, 'f', { state: 'shipped', acceptance: [crit('a', true), crit('b', true)] });

    expect(acceptanceLine(done, 'done')).toBe('all 2 met');
  });

  it('counts an unchecked criterion as unmet, never as met', () => {
    // Absent is not false and it is certainly not true: nobody has looked.
    const { total, met } = acceptanceOf(row(7, 'g', { acceptance: [crit('a', true), crit('b'), crit('c', false)] }));

    expect(total).toBe(3);
    expect(met).toBe(1);
  });

  it('knows whether the contract was frozen', () => {
    expect(acceptanceOf(row(8, 'h', { acceptance: [crit('a')] })).frozen).toBe(false);
    expect(acceptanceOf(row(9, 'i', { acceptance: [crit('a')], acceptanceFrozenAt: '2026-09-22T10:00:00Z' })).frozen).toBe(true);
  });

  it('asks nothing of work that is only being built with no contract recorded', () => {
    expect(acceptanceLine(row(10, 'j', { state: 'building' }), 'progress')).toBeNull();
  });

  it('carries the line onto the row', () => {
    const out = deriveWorkQueue([row(11, 'k', { state: 'new', acceptance: [crit('x')] })], { now: NOW });

    expect(out[0]!.meta.acceptanceLine).toBe('1 criterion');
  });
});

describe('a finished outcome whose contract does not hold', () => {
  const crit = (statement: string, met?: boolean) => (met === undefined ? { statement } : { statement, met });

  it('says so, in code, rather than trusting a model to notice', () => {
    const shipped = row(1, 'a', { state: 'shipped', acceptance: [crit('a', true), crit('b', false), crit('c')] });

    // Shipped with one failed and one unchecked: that is a claim, not done.
    expect(contractGap(shipped, 'done')).toBe('2 of 3 unmet');
  });

  it('is silent when every criterion holds', () => {
    expect(contractGap(row(2, 'b', { state: 'shipped', acceptance: [crit('a', true)] }), 'done')).toBeNull();
  });

  it('does not report a missing contract twice', () => {
    // An outcome with no criteria is the PROPOSAL's gap, reported there as
    // "no criteria". Saying it again at the other end of its life would put
    // the same complaint on one row twice.
    expect(contractGap(row(3, 'c', { state: 'shipped' }), 'done')).toBeNull();
    expect(acceptanceLine(row(3, 'c', { state: 'new' }), 'proposed')).toBeNull();
  });

  it('asks nothing of work that has not finished', () => {
    const building = row(4, 'd', { state: 'building', acceptance: [crit('a'), crit('b')] });

    expect(contractGap(building, 'progress')).toBeNull();
    expect(contractGap(row(5, 'e', { state: 'new', acceptance: [crit('a')] }), 'proposed')).toBeNull();
  });

  it('carries the gate onto the row', () => {
    const out = deriveWorkQueue([
      row(6, 'f', { state: 'shipped', answeredAt: NOW.toISOString(), acceptance: [crit('a', true), crit('b')] }),
    ], { now: NOW });

    expect(out[0]!.meta.contractGap).toBe('1 of 2 unmet');
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

  it('says only what the badge does not, so no row repeats its own state', () => {
    // The badge reads "Not triaged"; a line under it saying so again is the
    // repetition the three-lane redraw existed to lose.
    expect(stateOf(row(1, 'a', { state: 'new' }), 'proposed')).toBe('Not triaged');
    expect(workLine(row(1, 'a', { state: 'new' }), 'proposed', NOW)).toBeNull();
    expect(workLine(row(2, 'b', { state: 'in_scope' }), 'proposed', NOW)).toBeNull();
    expect(workLine(row(3, 'c', { state: 'building', taskCount: 5, runningTaskCount: 2 }), 'progress', NOW)).toBe('5 tasks underway. No action needed from you.');
    expect(workLine(row(4, 'd', { state: 'shipped', answeredAt: '2026-09-20T16:00:00Z' }), 'done', NOW)).toBe('yesterday');
  });

  it('says what a decision is for, since the badge only says one is owed', () => {
    const waiting = row(5, 'e', { state: 'new', recommendationState: 'proposed', recommendedOutcome: 'build' });

    expect(stateOf(waiting, 'proposed')).toBe('Decide');
    // The action and how long it has waited, not who recommended it.
    expect(workLine(waiting, 'proposed', NOW)).toMatch(/^Decide whether to build it( · waiting (since today|\d+ days?))?$/);
  });

  it('says money the way the lane makes sense of it', () => {
    expect(costLine(row(1, 'a', { estimateCents: 8500 }), 'proposed')).toBe('about $85.00');
    expect(costLine(row(2, 'b', { estimateCents: 8500, actualCents: 2412 }), 'progress')).toBe('$24.12 of about $85.00');
    expect(costLine(row(3, 'c', { actualCents: 84 }), 'done')).toBe('$0.84');
    expect(costLine(row(4, 'd', {}), 'proposed')).toBeNull();
  });

  it('shows a conditional fact only when it is true, and never twice', () => {
    expect(flagsOf(row(1, 'a', {}), 'proposed')).toEqual([]);
    expect(flagsOf(row(2, 'b', { severity: 'p1', sizeClass: 'major' }), 'proposed')).toEqual(['urgent', 'major']);
    expect(flagsOf(row(3, 'c', { kind: 'incident' }), 'progress')).toEqual(['urgent']);
    // The row's own badge already reads "Decide", so the flag does not repeat it.
    expect(flagsOf(row(4, 'd', { recommendationState: 'proposed' }), 'proposed')).toEqual([]);
    expect(flagsOf(row(5, 'e', { recommendationState: 'proposed' }), 'progress')).toEqual(['waiting on you']);
  });

  it('leaves a row with nothing to say empty rather than writing "not recorded"', () => {
    const [only] = deriveWorkQueue([row(1, 'bare', { state: 'new' })], { now: NOW });

    expect(only!.meta.whyLine).toBeUndefined();
    expect(only!.meta.costLine).toBeUndefined();
    expect(only!.meta.flags).toBeUndefined();
  });
});

describe('which picture the card shows', () => {
  it('shows what is proposed while the outcome is still being decided or built', () => {
    const meta = { visuals: { beforeArtifactIds: [11], afterArtifactIds: [22] } };

    expect(visualArtifactId(row(1, 'a', meta), 'proposed')).toBe(11);
    expect(visualArtifactId(row(2, 'b', meta), 'progress')).toBe(11);
  });

  it('shows what it looks like NOW once it has shipped', () => {
    // The mockup has stopped being a proposal and become a historical claim;
    // the after-shot is the thing a person can check against the product.
    const meta = { visuals: { beforeArtifactIds: [11], afterArtifactIds: [22] } };

    expect(visualArtifactId(row(3, 'c', meta), 'done')).toBe(22);
  });

  it('falls back to the mockup on a shipped outcome nobody captured', () => {
    expect(visualArtifactId(row(4, 'd', { visuals: { beforeArtifactIds: [11] } }), 'done')).toBe(11);
  });

  it('has no picture for a row that names none', () => {
    expect(visualArtifactId(row(5, 'e', {}), 'proposed')).toBeNull();
    expect(visualArtifactId(row(6, 'f', { visuals: { beforeArtifactIds: [] } }), 'proposed')).toBeNull();
  });

  it('ignores an id that is not one', () => {
    expect(visualArtifactId(row(7, 'g', { visuals: { beforeArtifactIds: ['nope'] } }), 'proposed')).toBeNull();
  });

  it('puts the chosen picture on the row the page draws', () => {
    const [drawn] = deriveWorkQueue([row(8, 'h', { state: 'new', visuals: { beforeArtifactIds: [11] } })], { now: NOW });

    expect(drawn!.meta.visual).toBe(11);
  });

  it('a row a gate sent back reads Returned to the seat, with the first missing thing, and is not waiting on a person', () => {
    const rows = [row(50, 'sent back', { state: 'triaged', recommendationState: 'proposed', returnedTo: 'product-manager', gate: { name: 'decision-ready', failed: [{ field: 'acceptance', why: 'acceptance has 1 item; at least 3 needed' }, { field: 'why', why: 'why is not on the record' }] } })];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out[0]!.meta.state).toBe('Returned to PM');
    expect(out[0]!.meta.workLine).toBe('Gate "decision-ready": acceptance has 1 item; at least 3 needed (+1 more). No action needed from you.');
  });

  it('a row the judge sent back names the thing that failed', () => {
    const rows = [row(51, 'judged back', { state: 'triaged', returnedTo: 'product-manager', gate: { name: 'decision-ready', judged: 'return', reasonCode: 'untestable-criteria', example: '"done when it works"' } })];
    const out = deriveWorkQueue(rows, { now: NOW });

    expect(out[0]!.meta.state).toBe('Returned to PM');
    expect(out[0]!.meta.workLine).toBe('Gate "decision-ready" sent it back: "done when it works". No action needed from you.');
  });
});

describe('a dismissed proposal', () => {
  it('leaves the queue: out of scope or a rejected recommendation', () => {
    const open = row(50, 'open', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build' });
    const outOfScope = row(51, 'oos', { state: 'out_of_scope', recommendationState: 'rejected' });
    const rejected = row(52, 'rej', { state: 'triaged', recommendationState: 'rejected' });

    expect(deriveWorkQueue([open, outOfScope, rejected], { now: NOW }).map(r => r.id)).toEqual([50]);
  });
});
