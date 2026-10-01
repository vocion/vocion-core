import type { FeatureReportInput, ReportObject, ReportWorkerRun } from './featureReport';
import type { LiveMissionRunInput } from '@/libs/factory/liveStatus';
import { describe, expect, it } from 'vitest';
import { nowLine, pickLive } from '@/libs/factory/liveStatus';
import { assembleFeatureReport, featureStatusOf } from './featureReport';

/**
 * YOU, NOW, NEXT (Chris, 2026-09-30, request #265 on a phone): "Is a plan run
 * happening? I have no way to see that or click in." The page read "Planning
 * — See the plan" with no plan yet, while the planning run worked unseen; and
 * later "Building now … started 3 min ago" over a run no worker had claimed.
 */

const NOW = new Date('2026-09-30T10:05:00Z');
const T = (iso: string) => new Date(iso);

const planning = { stage: 'planning', line: 'Planning — the change spans two packages', attempts: [], log: [] };

const request: ReportObject = {
  id: 265,
  title: 'Fix the header overflow on the Northwind portal',
  status: 'active',
  createdAt: T('2026-09-30T10:00:00Z'),
  meta: { state: 'building', recovery: planning },
};

const planRun: LiveMissionRunInput = { id: 6414, status: 'running', title: 'Write the plan the build needs', startedAt: T('2026-09-30T10:03:30Z'), step: null, forRecord: true };

const plan: ReportObject = { id: 266, title: 'Plan for #265', status: 'active', createdAt: T('2026-09-30T10:04:50Z'), meta: { requestId: 265, status: 'in_review' } };

const task: ReportObject = { id: 267, title: 'Header overflow', status: 'dispatched', createdAt: T('2026-09-30T10:05:00Z'), meta: { requestId: 265 } };

function worker(over: Partial<ReportWorkerRun> = {}): ReportWorkerRun {
  return {
    id: 432,
    agentSlug: 'task-engineer',
    kind: 'worker',
    status: 'queued',
    attempt: 0,
    cents: null,
    model: null,
    summary: null,
    error: null,
    createdAt: T('2026-09-30T10:02:00Z'),
    claimedAt: null,
    completedAt: null,
    input: { record: { type: 'engineering_task', id: 267 } },
    result: null,
    progress: {},
    ...over,
  };
}

function input(over: Partial<FeatureReportInput> = {}): FeatureReportInput {
  return { request, tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [], now: NOW, ...over };
}

describe('the Now line: what is running for this work, and true', () => {
  it('a running planning run is the live line, and the move opens it — never "See the plan" before a plan exists', () => {
    const report = assembleFeatureReport(input({ missionRuns: [planRun] }));

    expect(report.live).toMatchObject({ kind: 'planning', label: 'Writing the plan', runRef: { type: 'mission_run', id: '6414' }, runHref: '/dashboard/p/runs/agent-6414', since: 'started' });
    expect(nowLine(report.live, NOW)).toBe('Writing the plan · 1 min');
    expect(report.state.action).toEqual({ label: 'Watch the plan being written', href: '/dashboard/p/runs/agent-6414' });
    expect(report.status.action).toEqual({ kind: 'link', label: 'Watch the plan being written', href: '/dashboard/p/runs/agent-6414' });
    expect(report.you).toEqual({ needsYou: false, line: 'Nothing needs you', why: null });
    expect(report.status.next).toBe('The build starts when the plan is approved.');
  });

  it('with no plan yet and nothing running, offers nothing to open rather than a plan that is not there', () => {
    const report = assembleFeatureReport(input());

    expect(report.live).toBeNull();
    expect(report.state.action).toBeNull();
    expect(report.status.action).toBeNull();
  });

  it('once the planning run finished and a plan exists, offers the plan', () => {
    const report = assembleFeatureReport(input({ plans: [plan], missionRuns: [{ ...planRun, status: 'completed' }] }));

    expect(report.live).toBeNull();
    expect(report.state.action).toEqual({ label: 'See the plan', href: '#report-plan' });
    expect(report.status.action).toEqual({ kind: 'drawer', label: 'See the plan', drawer: 'plan' });
  });

  it('a run no worker has claimed reads "Waiting for a worker", counted from when it was queued — never "Building now … started"', () => {
    const report = assembleFeatureReport(input({ request: { ...request, meta: { state: 'building' } }, tasks: [task], workerRuns: [worker()] }));

    expect(report.live).toMatchObject({ kind: 'queued', label: 'Waiting for a worker', since: 'queued', startedAt: '2026-09-30T10:02:00.000Z', runLabel: 'Run #432' });
    expect(nowLine(report.live, NOW)).toBe('Waiting for a worker · queued 3 min');
    expect(report.state.label).toBe('Waiting for a worker');
    expect(report.status.headline).toBe('Waiting for a worker');
    expect(report.status.sentence).not.toMatch(/Building now|started/);
    expect(report.status.next).toBe('A worker picks it up, then the engineer builds it and QA checks it.');
  });

  it('a claimed run reads "Engineer building" with its step, counted from the claim', () => {
    const report = assembleFeatureReport(input({ request: { ...request, meta: { state: 'building' } }, tasks: [task], workerRuns: [worker({ status: 'running', claimedAt: T('2026-09-30T10:01:00Z'), progress: { step: 'Running the checks' } })] }));

    expect(report.live).toMatchObject({ kind: 'building', label: 'Engineer building', step: 'Running the checks', since: 'claimed' });
    expect(nowLine(report.live, NOW)).toBe('Engineer building · Running the checks · 4 min');
    expect(report.status.headline).toBe('Building');
    expect(report.status.next).toBe('QA checks it, then it merges and deploys.');
  });

  it('an agent run over a change waiting on QA reads as QA reviewing its pull request', () => {
    const inReview = { ...task, status: 'awaiting_review' };
    const done = worker({ status: 'completed', claimedAt: T('2026-09-30T09:30:00Z'), completedAt: T('2026-09-30T09:50:00Z'), result: { pr_url: 'https://github.com/example/northwind-portal/pull/135' } });
    const review: LiveMissionRunInput = { id: 6420, status: 'running', title: 'Green checks are not the same as a proven contract', startedAt: T('2026-09-30T10:00:00Z'), step: 'Read the diff', forRecord: false };
    const report = assembleFeatureReport(input({ request: { ...request, meta: { state: 'building' } }, tasks: [inReview], workerRuns: [done], missionRuns: [review] }));

    expect(report.live).toMatchObject({ kind: 'reviewing', label: 'QA reviewing PR #135', step: 'Read the diff' });
    expect(report.status.next).toBe('Once QA passes it, it merges and deploys.');
  });

  it('a person holding it up reads "Needs you" with the move and why', () => {
    const inReview = { ...task, status: 'changes_requested', meta: { requestId: 265, verdict: { proven: 2, total: 5, note: 'the header still wraps at 390px' } } };
    const failed = worker({ status: 'completed', claimedAt: T('2026-09-30T09:30:00Z'), completedAt: T('2026-09-30T09:50:00Z') });
    const report = assembleFeatureReport(input({ request: { ...request, meta: { state: 'building' } }, tasks: [inReview], workerRuns: [failed] }));
    const status = featureStatusOf(report, { objectType: 'request', href: '/dashboard/p/feature/265' }, NOW);

    expect(status.you.needsYou).toBe(true);
    expect(status.you.line).toBe('Needs you: Review requested changes');
    expect(status.you.why).toContain('the header still wraps at 390px');
    expect(status.you.move).toEqual({ label: 'Review requested changes', href: `/dashboard/p/feature/265?preview=${encodeURIComponent('feature_section:265.acceptance')}` });
    expect(status.live).toBeNull();
  });
});

describe('pickLive', () => {
  it('prefers a claimed build over an agent run, and an agent run over a queued build', () => {
    const queued = { id: 1, status: 'queued', createdAt: T('2026-09-30T10:00:00Z'), claimedAt: null, progress: {}, n: 1 };
    const claimed = { ...queued, id: 2, status: 'running', claimedAt: T('2026-09-30T10:01:00Z') };
    const ctx = { planning: false, reviewing: null };

    expect(pickLive({ workerRuns: [queued, claimed], missionRuns: [planRun], context: ctx })?.runRef).toEqual({ type: 'worker_run', id: '2' });
    expect(pickLive({ workerRuns: [queued], missionRuns: [planRun], context: ctx })?.runRef).toEqual({ type: 'mission_run', id: '6414' });
    expect(pickLive({ workerRuns: [queued], missionRuns: [], context: ctx })?.kind).toBe('queued');
    expect(pickLive({ workerRuns: [], missionRuns: [{ ...planRun, status: 'awaiting_review' }], context: ctx })).toBeNull();
  });
});

describe('blocked is a state you can see (2026-10-01, #294)', () => {
  const blocker = { what: 'Nothing says which repository Lantern is built in, so it cannot be built', owner: 'eli@northwind.example', next: 'add a repo record for Lantern', cause: 'no_repo' };
  const blockedRequest: ReportObject = { ...request, meta: { state: 'new', product: 'lantern', blocker } };

  it('You says what is wrong, who fixes it and the move; Next says it moves on by itself; never "Nothing needs you"', () => {
    const report = assembleFeatureReport(input({ request: blockedRequest }));
    const status = featureStatusOf(report, { objectType: 'request', href: '/dashboard/p/feature/265' }, NOW);

    expect(status.stage.label).toBe('Blocked');
    expect(status.you).toMatchObject({ needsYou: true, line: 'Blocked: eli@northwind.example to add a repo record for Lantern', why: blocker.what, blocked: { who: 'eli@northwind.example', next: 'add a repo record for Lantern' } });
    expect(status.you.line).not.toBe('Nothing needs you');
    expect(status.next).toBe('Once eli@northwind.example does, it moves on by itself: the factory reads the records again every hour.');
  });

  it('Build is drawn disabled with the reason when it would hit the refusal; a missing plan keeps Build', () => {
    const refused = assembleFeatureReport(input({ request: blockedRequest }));

    expect(refused.status.action).toMatchObject({ kind: 'drawer' });
    expect(refused.status.secondary).toMatchObject({ kind: 'build', disabledReason: expect.stringContaining('Nothing says which repository Lantern is built in') });

    const plannable = assembleFeatureReport(input({ request: { ...blockedRequest, meta: { ...blockedRequest.meta, blocker: { ...blocker, cause: 'needs_plan' } } } }));

    expect(plannable.status.action).toMatchObject({ kind: 'build' });
    expect((plannable.status.action as { disabledReason?: string }).disabledReason).toBeUndefined();
  });
});

describe('the Now line says the step in a person\'s words (2026-10-01)', () => {
  it('an agent run an automation started for this record reads as the automation\'s name, not the mission\'s charter', () => {
    const run: LiveMissionRunInput = { id: 6732, status: 'running', title: 'show-it-first: Every visible change is seen before it is decided', startedAt: T('2026-09-30T10:04:00Z'), step: null, forRecord: true, label: 'Draw the mockup a request owes' };
    const live = pickLive({ workerRuns: [], missionRuns: [run], context: { planning: false, reviewing: null } });

    expect(live).toMatchObject({ kind: 'working', label: 'Draw the mockup a request owes', step: null, runLabel: 'Agent run #6732' });
    expect(pickLive({ workerRuns: [], missionRuns: [{ ...run, label: null }], context: { planning: false, reviewing: null } })!.label).toBe(run.title);
  });
});
