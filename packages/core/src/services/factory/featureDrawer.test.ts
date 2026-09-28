import type { FeatureReportInput } from './featureReport';
import { describe, expect, it } from 'vitest';
import { evidenceHref, featureDrawer, featureDrawerId, parseFeatureDrawerId } from './featureDrawer';
import { assembleFeatureReport } from './featureReport';

/**
 * The feature page's drawers: every section the report assembles is
 * reachable from one, and each says what the page only summarises. Fixtures
 * are fictional (the cast in `libs/fixtures/realDataGuard.ts`).
 */

const T = (iso: string) => new Date(iso);
const NOW = T('2026-09-21T12:00:00Z');

function report(over: Partial<FeatureReportInput> = {}) {
  const base: FeatureReportInput = {
    request: {
      id: 41,
      title: 'Export a room as a PDF',
      status: 'in_scope',
      createdAt: T('2026-09-01T09:00:00Z'),
      meta: { state: 'building', body: 'Give me a PDF of the room.', askedBy: { name: 'Dana Okafor' }, acceptance: [{ statement: 'The share menu offers PDF', met: true, evidenceUrl: '/dashboard/artifacts/700' }, { statement: 'Every section is in order' }] },
    },
    tasks: [{ id: 77, title: 'Room PDF export', status: 'awaiting_review', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, objective: 'Add a PDF export.', allowedPaths: ['src/features/rooms/**'], prUrl: 'https://github.com/example/northwind-portal/pull/12' } }],
    plans: [{ id: 31, title: 'Render server side', status: 'candidate', createdAt: T('2026-09-02T17:00:00Z'), meta: { requestId: 41, approach: 'Render from the room model. Not the DOM.', approvedBy: 'Chris', approvedAt: '2026-09-02T18:00:00Z', components: ['a renderer', 'a menu entry'], verification: 'Export the fixture room and diff the sections.' } }],
    workerRuns: [
      { id: 500, agentSlug: 'task-engineer', kind: 'worker', status: 'failed', attempt: 1, cents: 120, model: 'claude-sonnet-4-6', summary: null, error: 'typecheck failed', createdAt: T('2026-09-03T10:00:00Z'), claimedAt: T('2026-09-03T10:01:00Z'), completedAt: T('2026-09-03T10:30:00Z'), input: {}, result: null, progress: {} },
      { id: 501, agentSlug: 'task-engineer', kind: 'worker', status: 'completed', attempt: 2, cents: 309, model: 'claude-sonnet-4-6', summary: 'Added the export.', error: null, createdAt: T('2026-09-04T10:00:00Z'), claimedAt: T('2026-09-04T10:01:00Z'), completedAt: T('2026-09-04T11:00:00Z'), input: {}, result: { pr_url: 'https://github.com/example/northwind-portal/pull/12' }, progress: {} },
    ],
    asks: [],
    actionRuns: [],
    releases: [],
    artifacts: [],
    now: NOW,
  };
  return { ...assembleFeatureReport({ ...base, ...over }), activity: [{ kind: 'conversation' as const, id: 12, title: 'Scoping the export', at: T('2026-09-02T09:00:00Z'), status: 'wrote', detail: null }] };
}

describe('drawer ids', () => {
  it('round-trips, and refuses anything that is not a known drawer', () => {
    expect(parseFeatureDrawerId(featureDrawerId(41, 'plan'))).toEqual({ requestId: 41, key: 'plan' });
    expect(parseFeatureDrawerId('41.criterion-2')).toEqual({ requestId: 41, key: 'criterion-2' });
    expect(parseFeatureDrawerId('41.everything')).toBeNull();
    expect(parseFeatureDrawerId('abc.plan')).toBeNull();
  });
});

describe('what each drawer carries', () => {
  it('plan: the status resolved, the approver, the steps, the rationale and the approval history', () => {
    const d = featureDrawer(report(), 'plan', NOW)!;

    expect(d.facts).toContainEqual({ label: 'Status', value: 'Approved' });
    expect(d.facts).toContainEqual({ label: 'Approved by', value: 'Chris' });
    expect(d.body).toContain('1. a renderer');
    expect(d.body).toContain('Render from the room model.');
    expect(d.body).toContain('## Approval history');
    expect(d.body).toContain('Plan approved by Chris');
    // The contract's boundaries ride along.
    expect(d.body).toContain('src/features/rooms/**');
  });

  it('implementation: every attempt newest first, each one peekable, with the delivery facts kept apart', () => {
    const d = featureDrawer(report(), 'implementation', NOW)!;

    expect(d.subtitle).toMatch(/^Latest run · Completed · .* · \$3\.09 · 1 earlier attempt$/);
    expect(d.body.indexOf('run 501')).toBeLessThan(d.body.indexOf('run 500'));
    expect(d.body).toContain('?preview=worker_run:501');
    expect(d.facts?.map(f => f.label)).toEqual(['Run completed', 'Checks passed', 'Merged', 'Acceptance verified', 'Released', 'Cost']);
  });

  it('acceptance: each criterion with its state, the evidence as a peek, and how it is reviewed', () => {
    const d = featureDrawer(report(), 'acceptance', NOW)!;

    expect(d.subtitle).toBe('1 of 2 verified · still a draft');
    expect(d.body).toContain('**Passed** — The share menu offers PDF ([evidence](?preview=artifact:700))');
    expect(d.body).toContain('**Unverified** — Every section is in order');
    expect(d.body).toContain('Export the fixture room and diff the sections.');
  });

  it('one criterion: its evidence, or plainly none', () => {
    expect(featureDrawer(report(), 'criterion-0', NOW)!.body).toContain('[open it](?preview=artifact:700)');
    expect(featureDrawer(report(), 'criterion-1', NOW)!.body).toContain('No evidence is attached');
    expect(featureDrawer(report(), 'criterion-9', NOW)).toBeNull();
  });

  it('work: every conversation and run, each a peek in the same pane', () => {
    expect(featureDrawer(report(), 'work', NOW)!.body).toContain('[Scoping the export](?preview=conversation:12)');
  });

  it('activity: the whole timeline, oldest first', () => {
    const d = featureDrawer(report(), 'activity', NOW)!;

    expect(d.body.indexOf('Asked by Dana Okafor')).toBeLessThan(d.body.indexOf('Run 501'));
  });

  it('release: Not released while nothing has merged, Release not verified once it merged and nothing records a release', () => {
    expect(featureDrawer(report(), 'release', NOW)!.facts).toContainEqual({ label: 'Release', value: 'Not released' });

    const merged = report({ tasks: [{ id: 77, title: 'Room PDF export', status: 'accepted', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, prUrl: 'https://github.com/example/northwind-portal/pull/12', commitSha: 'abc1234' } }] });

    expect(featureDrawer(merged, 'release', NOW)!.facts).toContainEqual({ label: 'Release', value: 'Release not verified' });
  });

  it('details: the ask, triage, the contracts and the approvals — nothing dropped', () => {
    const d = featureDrawer(report(), 'details', NOW)!;

    for (const heading of ['## The ask', '## Triage', '## The contract', '## Approvals']) {
      expect(d.body).toContain(heading);
    }
  });
});

describe('evidence links', () => {
  it('become peeks when the pane can show them, and stay links otherwise', () => {
    expect(evidenceHref('/dashboard/artifacts/700')).toBe('?preview=artifact:700');
    expect(evidenceHref('/dashboard/p/runs/501')).toBe('?preview=worker_run:501');
    expect(evidenceHref('https://files.example/qa.png')).toBe('https://files.example/qa.png');
  });
});
