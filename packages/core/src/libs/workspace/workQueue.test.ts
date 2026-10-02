import type { PageRow } from './pageFields';
import type { WorkQueueOptions } from './workQueue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readStatusModel, withFollowedStatus } from '@/libs/objects/statusModel';
import { acceptanceLine, acceptanceOf, blockerOf, contractGap, costLine, deriveWorkQueue, flagsOf, isBlocked, isProbeRow, laneOf, placeOfRow, visualArtifactId, visualGap, whyLine, workLine, workStateOf } from './workQueue';

/**
 * The four-lane mapping, argued with here rather than in a browser.
 *
 * Every case below came off the live queue at agents.metacto.com: a rename
 * that is building, three recommendations nobody has decided, four queued
 * outcomes with no recorded reason between them, nine finished items and
 * eight probes. The page is only as honest as this file.
 */

const NOW = new Date('2026-09-21T16:00:00Z');

/** The software factory's request type: its status, groups and transitions are what Work reads. */
const MODEL = readStatusModel(parse(readFileSync(join(process.cwd(), 'templates/plugins/software-factory/objects/request/type.yaml'), 'utf8')).schema)!;

/**
 * A request row. A row given a `state` carries the status a write of that
 * state carries (the type's `state:` transitions, as `objects.update_meta`
 * writes it); a row given `status` keeps it.
 * @param id
 * @param title
 * @param meta
 * @param createdAt
 */
function row(id: number, title: string, meta: Record<string, unknown>, createdAt = NOW): PageRow {
  return { id, title, status: null, createdAt, meta: withFollowedStatus(MODEL, meta, NOW.toISOString()) };
}

const derive = (rows: PageRow[], opts: WorkQueueOptions = {}) => deriveWorkQueue(rows, { statuses: MODEL, ...opts });
const place = (r: PageRow) => placeOfRow(r, MODEL);
const badge = (r: PageRow, opts: { staged?: boolean } = {}) => workStateOf(place(r), opts).label;
const lineOf = (r: PageRow, now = NOW, opts: { staged?: boolean; ahead?: number } = {}) => workLine(r, place(r), now, opts);

describe('lanes: the status field and its groups (Chris, 2026-10-02)', () => {
  it('reads each status as the group the type puts it in', () => {
    const lane = (status: string) => laneOf(row(1, status, { status }), MODEL);

    for (const s of ['new', 'triaged', 'deciding', 'queued', 'deferred']) {
      expect(lane(s)).toBe('proposed');
    }
    for (const s of ['planning', 'building', 'in_qa', 'changes_asked', 'awaiting_merge', 'deploying', 'stopped']) {
      expect(lane(s)).toBe('progress');
    }
    for (const s of ['shipped', 'seen_live', 'answered']) {
      expect(lane(s)).toBe('done');
    }
    for (const s of ['out_of_scope', 'duplicate']) {
      expect(lane(s)).toBe('archived');
    }
  });

  it('puts a null or unknown status In progress, as Chris asked', () => {
    expect(laneOf(row(7, 'No nightly e2e runner', {}), MODEL)).toBe('progress');
    expect(laneOf(row(8, 'odd', { status: 'something_new' }), MODEL)).toBe('progress');
    expect(badge(row(7, 'none', {}))).toBe('In progress');
    expect(lineOf(row(7, 'none', {}))).toBe('No status recorded yet · today');
  });

  it('never infers the lane from the other fields: a status that says shipped is Done whatever state says (FE-224)', () => {
    const shipped = row(224, 'copy link', { state: 'building', status: 'shipped', shippedAt: '2026-09-21T03:19:08Z', recovery: { stage: 'recovering' } });

    expect(laneOf(shipped, MODEL)).toBe('done');
    expect(badge(shipped)).toBe('Shipped');
  });

  it('labels and tones come from the type', () => {
    expect(workStateOf(place(row(130, 'reminders', { status: 'awaiting_merge' })))).toEqual({ label: 'Waiting on your merge', tone: 'warn' });
    expect(workStateOf(place(row(1, 'a', { status: 'stopped' })))).toEqual({ label: 'Stopped · needs you', tone: 'bad' });
    expect(workStateOf(place(row(2, 'b', { status: 'seen_live' })))).toEqual({ label: 'Shipped · seen live', tone: 'ok' });
    expect(workStateOf(place(row(3, 'c', { status: 'building' })))).toEqual({ label: 'Building', tone: 'info' });
  });

  it('a row waiting on your merge says what the status was written with, and leads the lane (FE-130)', () => {
    const merge = row(130, 'Remind who has not opened it', { status: 'awaiting_merge', statusLine: 'QA approved 8 of 8; the merge waits on a person (infra class).', statusAt: '2026-09-21T05:31:31Z', taskCount: 9, runningTaskCount: 0, askedAt: '2026-09-20T00:00:00Z' });
    const building = row(131, 'Copy link', { status: 'building', statusLine: 'RUN-478 is building attempt 2.', statusAt: '2026-09-21T15:00:00Z', askedAt: '2026-09-01T00:00:00Z' });
    const out = derive([building, merge], { now: NOW });

    expect(out.map(r => r.id)).toEqual([130, 131]);
    expect(out[0]!.meta.state).toBe('Waiting on your merge');
    expect(out[0]!.meta.workLine).toBe('QA approved 8 of 8; the merge waits on a person (infra class) · today');
    expect(out[0]!.meta.needsYou).toBe(true);
    expect(out[1]!.meta.workLine).toBe('RUN-478 is building attempt 2. No action needed from you · today');
    expect(out[1]!.meta.needsYou).toBeUndefined();
  });

  it('tells a status from an obstacle: Blocked is a flag and a line, written down by somebody', () => {
    const blocked = row(25, 'Connect staging', { status: 'building', taskCount: 2, runningTaskCount: 0, blocker: { what: 'The staging account is not connected', owner: 'chris@example.test', next: 'connect it on /dashboard/connectors' } });

    expect(isBlocked(blocked, place(blocked))).toBe(true);
    expect(blockerOf(blocked)).toEqual({ what: 'The staging account is not connected', owner: 'chris@example.test', next: 'connect it on /dashboard/connectors' });
    expect(badge(blocked)).toBe('Building');
    expect(flagsOf(blocked, place(blocked))).toContain('blocked');
    expect(lineOf(blocked)).toBe('The staging account is not connected. chris@example.test to connect it on /dashboard/connectors · today');

    // A blocker on finished work is history, not a state.
    const done = row(26, 'done', { status: 'shipped', blocker: { what: 'was stuck once' } });

    expect(isBlocked(done, place(done))).toBe(false);
  });

  it('a deferred outcome is a decision, not a rejection: kept, badged, last in Proposed, with its reason and date', () => {
    const deferred = row(40, 'Dark mode', { state: 'deferred', deferReason: 'Not until Send is in dogfood. Revisit when two customers ask.', deferredUntil: '2026-10-15T00:00:00Z', askedAt: '2026-09-01T00:00:00Z' });
    const queued = row(41, 'Fix uploads', { state: 'triaged', why: ['user_asks'], priority: 80, askedAt: '2026-09-20T00:00:00Z' });

    expect(laneOf(deferred, MODEL)).toBe('proposed');
    expect(badge(deferred)).toBe('Deferred');
    expect(lineOf(deferred)).toBe('Deferred until 2026-10-15: Not until Send is in dogfood.');
    expect(derive([deferred, queued], { now: NOW }).map(r => r.id)).toEqual([41, 40]);
  });

  it('a shipped outcome says whether it helped, or when that will be known', () => {
    expect(lineOf(row(53, 'd', { state: 'shipped', shippedAt: '2026-09-20T16:00:00Z', result: 'helped', resultNote: 'Upload failures fell from 4.1% to 0.3% (PostHog, 7 days). Nobody has reported a lost upload since.' }))).toBe('Helped: Upload failures fell from 4.1% to 0.3% (PostHog, 7 days).');
    expect(lineOf(row(51, 'b', { state: 'shipped', shippedAt: '2026-09-20T16:00:00Z', result: 'did_not_help' }))).toBe('yesterday · did not help');
    expect(lineOf(row(54, 'e', { state: 'shipped', shippedAt: '2026-09-20T16:00:00Z', checkAfter: '2026-09-28T00:00:00Z' }))).toBe('yesterday · result checked 2026-09-28');
    expect(lineOf(row(55, 'f', { state: 'shipped', shippedAt: '2026-09-20T16:00:00Z', checkAfter: '2026-09-10T00:00:00Z' }))).toBe('yesterday · result not checked yet');
  });

  it('sorts what has stopped above what is running', () => {
    const rows = [
      row(30, 'moving', { state: 'building', taskCount: 2, runningTaskCount: 1, askedAt: '2026-09-01T00:00:00Z' }),
      row(31, 'stopped', { state: 'building', taskCount: 2, runningTaskCount: 0, askedAt: '2026-09-20T00:00:00Z', blocker: { what: 'checks fail on the shared helper three attempts running', owner: 'product-manager', next: 'revise the contract' } }),
    ];

    // Newer, but blocked — so it leads regardless of age.
    expect(derive(rows, { now: NOW }).map(r => r.id)).toEqual([31, 30]);
  });

  it('sorts an undecided recommendation above the queue behind it', () => {
    const rows = [
      row(40, 'queued long ago', { state: 'new', askedAt: '2026-09-01T00:00:00Z' }),
      row(41, 'needs a decision', { state: 'new', recommendationState: 'proposed', askedAt: '2026-09-20T00:00:00Z' }),
    ];

    expect(derive(rows, { now: NOW }).map(r => r.id)).toEqual([41, 40]);
  });

  it('leaves the archive out of the queue entirely: out of scope, dismissed, duplicate', () => {
    const rows = [
      row(10, 'declined', { state: 'out_of_scope' }),
      row(12, 'dismissed', { state: 'triaged', recommendationState: 'rejected' }),
      row(13, 'repeat', { state: 'new', duplicateOf: 11 }),
      row(11, 'queued', { state: 'new' }),
    ];

    expect(derive(rows, { now: NOW }).map(r => r.id)).toEqual([11]);
  });

  it('draws one lane of work when the type declares no status', () => {
    const out = deriveWorkQueue([row(1, 'a', { state: 'new' })], { now: NOW });

    expect(out.map(r => r.meta.laneKey)).toEqual(['progress']);
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
    expect(derive([real], { now: NOW }).map(r => r.id)).toEqual([78]);
  });

  it('keeps probes out of the lanes and out of the counts', () => {
    const rows = [
      row(101, 'e2e 3ee2rh: export button does nothing on my phone', { source: 'e2e-suite', state: 'answered' }),
      row(93, 'e2e to7nx6: export button does nothing on my phone', { source: 'e2e-suite', state: 'answered' }),
      row(87, 'Send a link by email, and use the phone share sheet', { state: 'shipped', actualCents: 592 }),
    ];
    const out = derive(rows, { now: NOW });

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
    const out = derive(reasoned, { now: NOW });

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
    const out = derive(rows, { now: NOW });

    expect(out.map(r => [r.title, r.meta.rank])).toEqual([['reasoned', '1'], ['no reason', undefined]]);
  });

  it('says once, in the heading, that nothing is ranked at all', () => {
    const rows = [
      row(88, 'The planner writes task contracts without reading the repository', { state: 'new' }),
      row(89, 'One page that shows a feature from ask to announcement', { state: 'in_scope' }),
      row(94, 'Review is an event stream, not a queue of decisions', { state: 'in_scope' }),
      row(86, 'No nightly e2e runner for Send against production', { state: 'new' }),
    ];
    const out = derive(rows, { now: NOW });

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
    const out = derive(rows, { now: NOW, decideShown: 2 });

    expect(out.map(r => [r.id, r.meta.state])).toEqual([
      [13, 'Decide'],
      [12, 'Decide'],
      [14, 'Triaged'],
      [11, 'Staged'],
      [10, 'Staged'],
    ]);
    expect(out[3]!.meta.workLine).toMatch(/^Behind 2 decisions, moves up as they land · waiting \d+ days?$/);
    expect(out[4]!.meta.workLine).toMatch(/^Behind 3 decisions, moves up as they land · waiting \d+ days?$/);
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
    const out = derive(rows, { now: NOW });

    expect(out).toHaveLength(3);
    expect(out[0]!.meta.lane).toBe('Proposed');
    expect(out[0]!.meta.laneNote).toBe('3 to decide · about 19 min');
    expect(out[0]!.meta.waitingCount).toBe(3);
  });

  it('caps recently done, counts the whole lane, and points the rest at Activity', () => {
    const rows = Array.from({ length: 23 }, (_, i) => row(
      100 + i,
      `shipped ${i}`,
      { state: 'shipped', answeredAt: new Date(NOW.getTime() - i * 3_600_000).toISOString() },
    ));
    const out = derive(rows, { now: NOW });

    expect(out).toHaveLength(20);
    expect(out[0]!.meta.lane).toBe('Done');
    expect(out[0]!.meta.laneNote).toBe('3 more in Activity');
    expect(out[0]!.meta.doneCount).toBe(23);
    expect(out[0]!.meta.laneTotal).toBe(23);
    expect(out[0]!.title).toBe('shipped 0');
  });

  it('drops work that finished outside the window', () => {
    const old = row(1, 'ancient', { state: 'shipped', answeredAt: '2026-01-01T00:00:00Z' });

    expect(derive([old], { now: NOW })).toEqual([]);
  });

  it('orders the lanes In progress, Proposed, Done', () => {
    const rows = [
      row(1, 'done', { state: 'shipped', answeredAt: NOW.toISOString() }),
      row(2, 'waiting', { state: 'triaged', recommendationState: 'proposed' }),
      row(3, 'building', { state: 'building' }),
      row(4, 'queued', { state: 'new' }),
    ];
    const out = derive(rows, { now: NOW });

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
    const out = derive(rows, { now: NOW });

    expect(out[0]!.meta.laneNote ?? '').not.toContain('without a visual');
    expect(out.map(r => r.meta.visualGap)).toContain('no mock');
  });
});

describe('the contract between a person and the factory', () => {
  // A line a person marked met carries its proof; the count is featureProof's.
  const crit = (statement: string, met?: boolean) => (met === undefined ? { statement } : met ? { statement, met, evidence: `seen: https://app.example/${statement}` } : { statement, met });

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

    expect(acceptanceLine(building, 'progress')).toBe('2 of 3 proven');
    expect(acceptanceLine(building, 'done')).toBe('2 of 3 proven');
  });

  it('says all of them when a finished item met every one', () => {
    const done = row(6, 'f', { state: 'shipped', acceptance: [crit('a', true), crit('b', true)] });

    expect(acceptanceLine(done, 'done')).toBe('all 2 proven');
  });

  it('counts an unchecked criterion as unmet, never as met', () => {
    // Absent is not false and it is certainly not true: nobody has looked.
    const { total, proven } = acceptanceOf(row(7, 'g', { acceptance: [crit('a', true), crit('b'), crit('c', false)] }));

    expect(total).toBe(3);
    expect(proven).toBe(1);
  });

  it('counts the way the feature page does: a mark with no evidence is not proven, a verdict is', () => {
    // backlog 032: acceptanceOf read the request's `met` flags directly, so a
    // line marked met with nothing attached counted here and not on the page.
    const request = row(12, 'l', { state: 'shipped', acceptance: [{ statement: 'Search narrows the library as you type', met: true }, { statement: 'Filters read Live, Killed and Expiring soon' }] });

    expect(acceptanceOf(request).proven).toBe(0);

    const task = { id: 90, meta: { requestId: 12, verdict: { value: 'approve', criteria: [
      { criterion: 'Search narrows the library as you type', status: 'proven', evidence: 'https://app.example/shot-1.png' },
      { criterion: 'Filters read Live, Killed and Expiring soon', status: 'proven', evidence: 'https://app.example/shot-2.png' },
    ] } } };

    expect(acceptanceOf(request, { tasks: [task], shippedTaskIds: [90] })).toMatchObject({ total: 2, proven: 2 });

    const [drawn] = derive([{ ...request, meta: { ...request.meta, shippedAt: NOW.toISOString() } }], {
      now: NOW,
      tasks: [{ id: 90, title: 't', status: null, createdAt: NOW, meta: task.meta }],
      releases: [{ id: 5, title: 'r', status: null, createdAt: NOW, meta: { taskIds: [90] } }],
    });

    expect(drawn!.meta.contractGap).toBeUndefined();
    expect(drawn!.meta.acceptanceLine).toBe('all 2 proven');
  });

  it('knows whether the contract was frozen', () => {
    expect(acceptanceOf(row(8, 'h', { acceptance: [crit('a')] })).frozen).toBe(false);
    expect(acceptanceOf(row(9, 'i', { acceptance: [crit('a')], acceptanceFrozenAt: '2026-09-22T10:00:00Z' })).frozen).toBe(true);
  });

  it('asks nothing of work that is only being built with no contract recorded', () => {
    expect(acceptanceLine(row(10, 'j', { state: 'building' }), 'progress')).toBeNull();
  });

  it('carries the line onto the row', () => {
    const out = derive([row(11, 'k', { state: 'new', acceptance: [crit('x')] })], { now: NOW });

    expect(out[0]!.meta.acceptanceLine).toBe('1 criterion');
  });
});

describe('a finished outcome whose contract does not hold', () => {
  const crit = (statement: string, met?: boolean) => (met === undefined ? { statement } : met ? { statement, met, evidence: `seen: https://app.example/${statement}` } : { statement, met });

  it('says so, in code, rather than trusting a model to notice', () => {
    const shipped = row(1, 'a', { state: 'shipped', acceptance: [crit('a', true), crit('b', false), crit('c')] });

    // Shipped with one failed and one unchecked: that is a claim, not done.
    expect(contractGap(shipped, 'done')).toBe('1 of 3 proven');
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
    const out = derive([
      row(6, 'f', { state: 'shipped', answeredAt: NOW.toISOString(), acceptance: [crit('a', true), crit('b')] }),
    ], { now: NOW });

    expect(out[0]!.meta.contractGap).toBe('1 of 2 proven');
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
    expect(badge(row(1, 'a', { state: 'new' }))).toBe('Not triaged');
    // What it adds is the one thing the badge cannot: when it arrived.
    expect(lineOf(row(1, 'a', { state: 'new' }), NOW)).toBe('Filed today');
    expect(lineOf(row(2, 'b', { state: 'in_scope', askedAt: '2026-09-18T09:00:00Z' }), NOW)).toBe('Filed 3 days ago');
    expect(lineOf(row(3, 'c', { state: 'building', taskCount: 5, runningTaskCount: 2 }), NOW)).toBe('Building. No action needed from you · today');
    expect(lineOf(row(4, 'd', { state: 'shipped', shippedAt: '2026-09-20T16:00:00Z' }), NOW)).toBe('yesterday');
  });

  it('says what a decision is for, since the badge only says one is owed', () => {
    const waiting = row(5, 'e', { state: 'new', recommendationState: 'proposed', recommendedOutcome: 'build' });

    expect(badge(waiting)).toBe('Decide');
    // The action and how long it has waited, not who recommended it.
    expect(lineOf(waiting, NOW)).toMatch(/^Decide whether to build it( · waiting (since today|\d+ days?))?$/);
  });

  it('says money the way the lane makes sense of it', () => {
    expect(costLine(row(1, 'a', { estimateCents: 8500 }), 'proposed')).toBe('about $85.00');
    expect(costLine(row(2, 'b', { estimateCents: 8500, actualCents: 2412 }), 'progress')).toBe('$24.12 of about $85.00');
    expect(costLine(row(3, 'c', { actualCents: 84 }), 'done')).toBe('$0.84');
    expect(costLine(row(4, 'd', {}), 'proposed')).toBeNull();
  });

  it('shows a conditional fact only when it is true, and never twice', () => {
    expect(flagsOf(row(1, 'a', {}), place(row(1, 'a', {})))).toEqual([]);
    expect(flagsOf(row(2, 'b', { severity: 'p1', sizeClass: 'major' }), place(row(2, 'b', { severity: 'p1', sizeClass: 'major' })))).toEqual(['urgent', 'major']);
    expect(flagsOf(row(3, 'c', { kind: 'incident' }), place(row(3, 'c', { kind: 'incident' })))).toEqual(['urgent']);
    // The row's own badge already says whose move it is, so no flag repeats it.
    expect(flagsOf(row(4, 'd', { recommendationState: 'proposed' }), place(row(4, 'd', { recommendationState: 'proposed' })))).toEqual([]);

    const blocked = row(5, 'e', { status: 'building', blocker: { what: 'no staging account' } });

    expect(flagsOf(blocked, place(blocked))).toEqual(['blocked']);
  });

  it('leaves a row with nothing to say empty rather than writing "not recorded"', () => {
    const [only] = derive([row(1, 'bare', { state: 'new' })], { now: NOW });

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

  it('shows the drawn mockup, never the screenshot it was drawn on', () => {
    const meta = { surface: 'ui', state: 'new', visuals: { beforeArtifactIds: [11], mockupArtifactIds: [31, 32] } };

    expect(visualArtifactId(row(7, 'g', meta), 'proposed')).toBe(31);
    expect(visualGap(row(7, 'g', meta), 'proposed')).toBeNull();
  });

  it('has no picture for a row that names none', () => {
    expect(visualArtifactId(row(5, 'e', {}), 'proposed')).toBeNull();
    expect(visualArtifactId(row(6, 'f', { visuals: { beforeArtifactIds: [] } }), 'proposed')).toBeNull();
  });

  it('ignores an id that is not one', () => {
    expect(visualArtifactId(row(7, 'g', { visuals: { beforeArtifactIds: ['nope'] } }), 'proposed')).toBeNull();
  });

  it('puts the chosen picture on the row the page draws', () => {
    const [drawn] = derive([row(8, 'h', { state: 'new', visuals: { beforeArtifactIds: [11] } })], { now: NOW });

    expect(drawn!.meta.visual).toBe(11);
  });

  it('a row a gate sent back says so on its line, with the first missing thing; the badge stays its status', () => {
    const rows = [row(50, 'sent back', { state: 'triaged', recommendationState: 'proposed', returnedTo: 'product-manager', gate: { name: 'decision-ready', failed: [{ field: 'acceptance', why: 'acceptance has 1 item; at least 3 needed' }, { field: 'why', why: 'why is not on the record' }] } })];
    const out = derive(rows, { now: NOW });

    expect(out[0]!.meta.state).toBe('Decide');
    expect(out[0]!.meta.workLine).toBe('Sent back to PM by the "decision-ready" gate: acceptance has 1 item; at least 3 needed (+1 more) · today');
  });

  it('a row the judge sent back names the thing that failed', () => {
    const rows = [row(51, 'judged back', { state: 'triaged', returnedTo: 'product-manager', gate: { name: 'decision-ready', judged: 'return', reasonCode: 'untestable-criteria', example: '"done when it works"' } })];
    const out = derive(rows, { now: NOW });

    expect(out[0]!.meta.state).toBe('Triaged');
    expect(out[0]!.meta.workLine).toBe('Sent back to PM by the "decision-ready" gate: "done when it works" · today');
  });
});

describe('every row says what happened, and when (backlog 032)', () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

  it('stops promising "no action needed" once nothing has moved for a day', () => {
    const fresh = row(60, 'a', { status: 'building', statusLine: 'RUN-7 is building attempt 1.', statusAt: ago(0.2) });
    const still = row(61, 'b', { status: 'building', statusLine: 'RUN-8 is building attempt 1.', statusAt: ago(3) }, new Date(ago(9)));

    expect(lineOf(fresh, NOW)).toBe('RUN-7 is building attempt 1. No action needed from you · today');
    expect(lineOf(still, NOW)).toBe('RUN-8 is building attempt 1. Nothing has moved in 3 days · 3 days ago');
  });

  it('a line a person\'s move answers never says "no action needed"', () => {
    const stopped = row(62, 'Room order', { status: 'stopped', statusLine: 'Stopped after 3 attempts: the required checks failed (test).', statusAt: ago(4) });

    expect(lineOf(stopped, NOW)).toBe('Stopped after 3 attempts: the required checks failed (test) · 4 days ago');
  });

  it('says what a gate sent back in its first clause, with the day, never "no action needed" (#121)', () => {
    const why = '6 of 6 acceptance criteria are not met — Pressing Send mails the link to the address given; A note typed into the dialog arrives; …. Check each one against the running product and record the evidence';
    const returned = row(63, 'Send a file by email', { state: 'triaged', returnedTo: 'qa', gate: { name: 'contract-met', at: ago(3), failed: [{ field: 'acceptance', why }] } });

    expect(lineOf(returned, NOW)).toBe('Sent back to QA by the "contract-met" gate: 6 of 6 acceptance criteria are not met · 3 days ago');
  });

  it('dates a staged decision like a leading one', () => {
    const [, , , staged] = derive([1, 2, 3, 4].map(i => row(70 + i, `d${i}`, { state: 'new', recommendationState: 'proposed', recommendedOutcome: 'build', recommendedAt: ago(i) })), { now: NOW, decideShown: 3 });

    expect(staged!.meta.workLine).toBe('Behind 3 decisions, moves up as they land · waiting 4 days');
  });

  it('dates finished work by the day it shipped, never by the last recount (#39)', () => {
    const shipped = row(65, 'Multi-team membership', { state: 'shipped', shippedAt: ago(8), rollupsUpdatedAt: ago(4) });

    expect(lineOf(shipped, NOW)).toBe('8 days ago');
  });
});

describe('a dismissed proposal', () => {
  it('leaves the queue: out of scope or a rejected recommendation', () => {
    const open = row(50, 'open', { state: 'triaged', recommendationState: 'proposed', recommendedOutcome: 'build' });
    const outOfScope = row(51, 'oos', { state: 'out_of_scope', recommendationState: 'rejected' });
    const rejected = row(52, 'rej', { state: 'triaged', recommendationState: 'rejected' });

    expect(derive([open, outOfScope, rejected], { now: NOW }).map(r => r.id)).toEqual([50]);
  });
});

describe('a Build card already up (journey 4, 2026-09-28: #214\'s card #4945 pending, the row read as queued)', () => {
  it('makes the row a decision, says which card and how long it has waited, and leads the lane', () => {
    // Filing the card wrote the request's status (`build_card` → Decide).
    const filed = row(214, 'Download CSV of document viewers', { state: 'new', status: 'deciding' }, new Date('2026-09-20T10:00:00Z'));
    const older = row(213, 'Older queued request', { state: 'new' }, new Date('2026-09-10T10:00:00Z'));
    const out = derive([older, filed], { now: NOW, pendingBuilds: [{ requestId: 214, runId: 4945, at: new Date('2026-09-21T09:00:00Z') }] });
    const card = out.find(r => r.id === 214)!;

    expect(card.meta.state).toBe('Decide');
    expect(card.meta.workLine).toBe('Build card waiting on you (ACT-4945) · waiting since today');
    expect(card.meta.pendingBuildRunId).toBe(4945);
    // A decision leads the proposed lane, ahead of the older queued row.
    expect(out.filter(r => r.meta.laneKey === 'proposed').map(r => r.id)).toEqual([214, 213]);
  });

  it('leaves a row with no card as it was', () => {
    const out = derive([row(213, 'Queued', { state: 'new' })], { now: NOW, pendingBuilds: [{ requestId: 214, runId: 4945, at: NOW }] });

    expect(out[0]!.meta.state).toBe('Not triaged');
    expect(out[0]!.meta.pendingBuildRunId).toBeUndefined();
  });
});

describe('a duplicate is closed (#232, #234)', () => {
  it('leaves the queue once it names the request it duplicates, whatever its state', () => {
    expect(laneOf(row(232, 'Note on a send', { state: 'new', duplicateOf: 233 }), MODEL)).toBe('archived');
    expect(laneOf(row(233, 'Pin a note', { state: 'new' }), MODEL)).toBe('proposed');
  });
});

describe('the Now line on a Work row (Chris, 2026-09-30: "Live indicator. Streaming updates to the work table?")', () => {
  const building = row(265, 'Fix the header overflow', { state: 'building', taskCount: 1, runningTaskCount: 1 });
  const queued = { kind: 'queued' as const, label: 'Waiting for a worker', step: null, runRef: { type: 'worker_run' as const, id: '432' }, runHref: '/dashboard/p/runs/432', runLabel: 'Run #432', startedAt: '2026-09-21T15:57:00.000Z', since: 'queued' as const };
  const claimed = { ...queued, kind: 'building' as const, label: 'Engineer building', step: 'Running the checks', startedAt: '2026-09-21T15:56:00.000Z', since: 'claimed' as const };
  const nowOf = (rows: PageRow[], id: number) => rows.find(r => r.id === id)!.meta.now as { line: string; live: boolean; href: string | null };

  it('carries what is running for the row, and its line changes when the run does', () => {
    const waiting = derive([building], { now: NOW, live: new Map([[265, queued]]) });
    const going = derive([building], { now: NOW, live: new Map([[265, claimed]]) });
    const idle = derive([building], { now: NOW, live: new Map([[265, null]]) });

    expect(nowOf(waiting, 265)).toEqual({ line: 'Waiting for a worker · queued 3 min', live: true, href: '/dashboard/p/runs/432' });
    expect(nowOf(going, 265)).toEqual({ line: 'Engineer building · Running the checks · 4 min', live: true, href: '/dashboard/p/runs/432' });
    expect(nowOf(idle, 265)).toEqual({ line: 'Nothing running', live: false, href: null });
  });

  it('carries no Now line on a row that is not in progress, or when the page read none', () => {
    const proposed = row(300, 'Share a document', { state: 'in_scope' });

    expect(derive([proposed], { now: NOW, live: new Map() })[0]!.meta.now).toBeUndefined();
    expect(derive([building], { now: NOW })[0]!.meta.now).toBeUndefined();
  });

  it('leads the lane with the rows that need a person', () => {
    const older = row(1, 'Older, running', { state: 'building', taskCount: 1, runningTaskCount: 1 }, new Date('2026-09-20T10:00:00Z'));
    const merge = row(2, 'Newer, waiting on your merge', { status: 'awaiting_merge', taskCount: 1, acceptedTaskCount: 1 }, new Date('2026-09-21T10:00:00Z'));
    const out = derive([older, merge], { now: NOW });

    expect(out.filter(r => r.meta.laneKey === 'progress').map(r => r.id)).toEqual([2, 1]);
    expect(out.find(r => r.id === 2)!.meta.needsYou).toBe(true);
  });
});

describe('each status carries its tone, from the type (backlog 045)', () => {
  it('draws every declared status in the tone the type gives it, and an undeclared one muted', () => {
    for (const value of MODEL.groups.flatMap(g => g.in)) {
      expect(workStateOf(place(row(1, value, { status: value }))).tone).toBe(MODEL.tones[value]);
    }

    expect(workStateOf(place(row(2, 'x', { status: 'unheard_of' })))).toEqual({ label: 'unheard_of', tone: 'muted' });
  });

  it('writes the tone beside the state, where the badge reads it', () => {
    const [out] = derive([row(30, 'a', { status: 'awaiting_merge' })], { now: NOW });

    expect(out?.meta).toMatchObject({ state: 'Waiting on your merge', stateTone: 'warn', status: 'awaiting_merge' });
  });
});
