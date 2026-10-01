import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from '@/libs/repo-root';
import { keptShots, LIVE_STEP_VERBS, liveAfterRun, LiveFlowSchema, liveVerdict, orderedFlows, pickAnnouncementImage, readReleaseLive, readRequestLive, shotStatus } from './liveCheck';

const row = (status: 'reached' | 'not_reached', extra: Record<string, unknown> = {}) => ({ requestId: 41, flow: 'Last opened line', criterion: 'The line says when it was last opened.', viewport: 'desktop', artifactId: null, status, url: null, ...extra });

describe('the live flow', () => {
  it('speaks the runner\'s own step vocabulary — one contract both sides hold to', async () => {
    const runner = await import(pathToFileURL(fromRepoRoot('packages/runner/src/contract.mjs')).href) as { QA_STEP_VERBS: string[] };

    expect([...LIVE_STEP_VERBS]).toEqual(runner.QA_STEP_VERBS);
  });

  it('defaults to a signed-in check on desktop, and refuses a step that names no verb or two', () => {
    expect(LiveFlowSchema.parse({ name: 'Last opened line', path: '{{documentUrl}}' })).toMatchObject({ phase: 'check', signed_in: true, viewports: ['desktop'], steps: [] });
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ click: 'Share', shoot: 'Share' }] }).success).toBe(false);
    expect(LiveFlowSchema.safeParse({ name: 'x', path: '/', steps: [{ hover: 'Share' }] }).success).toBe(false);
  });

  it('runs setup, then the checks, then cleanup, each in the order written', () => {
    const flows = [{ name: 'c1', phase: 'check' }, { name: 'z', phase: 'cleanup' }, { name: 's1', phase: 'setup' }, { name: 'c2', phase: 'check' }, { name: 's2', phase: 'setup' }] as const;

    expect(orderedFlows(flows).map(f => f.name)).toEqual(['s1', 's2', 'c1', 'c2', 'z']);
  });
});

describe('what one shot shows', () => {
  it('is not reached when a step failed, when production sent it to sign-in, or when the page shows an app error', () => {
    expect(shotStatus('/documents/d1', { file: 'a.png', label: 'line', at: '/documents/d1', shortOf: 'step 2 (wait_for "Last opened") failed' })).toEqual({ status: 'not_reached', reason: 'step 2 (wait_for "Last opened") failed' });
    expect(shotStatus('/documents/d1', { file: 'a.png', label: '', at: '/sign-in?next=%2F' })).toEqual({ status: 'not_reached', reason: 'production sent the page to sign-in (/sign-in)' });
    expect(shotStatus('/documents/d1', { file: 'a.png', label: '', at: '/documents/d1', errorState: true }).status).toBe('not_reached');
    expect(shotStatus('/documents/d1', { file: 'a.png', label: 'line', at: '/documents/d1' })).toEqual({ status: 'reached' });
  });

  it('keeps each named shot, and the last picture only when nothing was named or a step failed', () => {
    const named = { shots: [{ file: '1', label: 'Last opened line', at: '/d' }, { file: '2', label: '', at: '/d' }], stepFailures: [] };

    expect(keptShots('/d', named).map(k => k.shot.file)).toEqual(['1']);
    expect(keptShots('/d', { ...named, stepFailures: [{}] }).map(k => k.shot.file)).toEqual(['1', '2']);
    expect(keptShots('/d', { shots: [{ file: '2', label: '', at: '/d' }], stepFailures: [] }).map(k => k.shot.file)).toEqual(['2']);
  });
});

describe('what the check concluded', () => {
  it('is seen only when every check state was reached', () => {
    expect(liveVerdict([row('reached'), row('reached', { viewport: 'phone' })])).toMatchObject({ state: 'seen', line: 'Seen live: 2 of 2 states reached', reason: null });
  });

  it('says a check that reached nothing could not reach the change, leading with what stopped it', () => {
    const v = liveVerdict([row('not_reached', { reason: 'step 1 (wait_for "Last opened") failed' })], ['setup "upload" (desktop) did not finish: step 2 (upload) failed']);

    expect(v).toMatchObject({ state: 'not_seen', reached: 0, total: 1 });
    expect(v.line).toBe('Live check could not reach the change: setup "upload" (desktop) did not finish: step 2 (upload) failed');
    expect(liveVerdict([], []).line).toBe('Live check could not reach the change: no check flow was run');
  });

  it('says partly seen, with what was not', () => {
    expect(liveVerdict([row('reached'), row('not_reached', { reason: 'the page shows an app error' })]).line).toBe('Partly seen live: 1 of 2 states reached; not reached: the page shows an app error');
  });

  it('leads the announcement with the first reached shot of a criterion, desktop first', () => {
    expect(pickAnnouncementImage([row('reached', { viewport: 'phone', artifactId: 9 }), row('reached', { artifactId: 8 }), row('not_reached', { artifactId: 7 })])).toBe(8);
    expect(pickAnnouncementImage([row('not_reached', { artifactId: 7 })])).toBeNull();
  });
});

describe('reading it back', () => {
  it('reads a release checked before liveState from its rows: 0 of 6 is not seen (release #280)', () => {
    const rows = Array.from({ length: 6 }, () => ({ flow: 'f', status: 'not_reached', reason: 'step 1 (wait_for "text=Last opened 2 hours ago by maya@acme.example") failed' }));

    expect(readReleaseLive({ liveEvidence: rows, liveSummary: '0 of 6 live states reached' })).toMatchObject({ state: 'not_seen' });
    expect(readReleaseLive({})).toBeNull();
    expect(readReleaseLive({ liveState: 'seen', liveSummary: 'Seen live: 1 of 1 state reached', liveCheckedAt: '2026-10-01T10:00:00Z' })).toEqual({ state: 'seen', line: 'Seen live: 1 of 1 state reached', checkedAt: '2026-10-01T10:00:00Z' });
  });

  it('reads a feature\'s own mark', () => {
    expect(readRequestLive({ liveCheck: { state: 'not_seen', line: 'Live check could not reach the change: x', releaseId: 280 } })).toMatchObject({ state: 'not_seen', releaseId: 280 });
    expect(readRequestLive({})).toBeNull();
  });
});

describe('when QA\'s fire ends', () => {
  const startedAt = new Date('2026-10-01T10:00:00Z');
  const after = '2026-10-01T10:05:00Z';

  it('is done when this fire saw the change', () => {
    expect(liveAfterRun({ liveState: 'seen', liveCheckedAt: after, liveAttempts: 1 }, { startedAt, reason: null })).toEqual({ do: 'done', why: 'seen live' });
  });

  it('checks once more, carrying why, when the first attempt did not see it', () => {
    expect(liveAfterRun({ liveState: 'not_seen', liveCheckedAt: after, liveAttempts: 1, liveReason: 'step 2 (wait_for "Last opened") failed' }, { startedAt, reason: null })).toEqual({ do: 'retry', attempt: 2, reason: 'step 2 (wait_for "Last opened") failed' });
  });

  it('counts a QA run that never checked, so a seat that never calls check_live cannot loop', () => {
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling check_live' })).toEqual({ do: 'retry', attempt: 2, reason: 'the QA run ended without calling check_live' });
    expect(liveAfterRun({}, { startedAt, reason: 'the QA run ended without calling check_live', attempt: 2 })).toEqual({ do: 'give-up', reason: 'the QA run ended without calling check_live' });
  });

  it('gives up once both attempts saw nothing, and reads an older check as no check', () => {
    expect(liveAfterRun({ liveState: 'not_seen', liveCheckedAt: after, liveAttempts: 2, liveReason: 'r' }, { startedAt, reason: null })).toEqual({ do: 'give-up', reason: 'r' });
    expect(liveAfterRun({ liveState: 'seen', liveCheckedAt: '2026-09-30T10:00:00Z' }, { startedAt, reason: null }).do).toBe('retry');
    expect(liveAfterRun({ liveState: 'partial', liveCheckedAt: after, liveAttempts: 2 }, { startedAt, reason: null }).do).toBe('done');
  });
});
