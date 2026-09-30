import type { FeatureReportInput, ReportObject } from './featureReport';
import { describe, expect, it } from 'vitest';
import { nowLine } from '@/libs/factory/liveStatus';
import { assembleFeatureReport, featureStatusOf } from './featureReport';

/**
 * AFTER THE MERGE, THE PAGE SAYS WHAT IS CARRYING IT (Chris, 2026-09-30, on
 * #269: "the active state is merged … Something should be watching and go to
 * prod … I'm kind of stuck here, not knowing if it is going, or what's
 * watching it"). Fictional Northwind fixture.
 */

const NOW = new Date('2026-09-30T22:45:00Z');
const T = (iso: string) => new Date(iso);
const PR = 'https://github.com/northwind/share/pull/41';

function request(delivery: Record<string, unknown> | null): ReportObject {
  return {
    id: 269,
    title: 'Let visitors on a share link switch the theme',
    status: 'active',
    createdAt: T('2026-09-30T05:56:00Z'),
    meta: { state: 'building', ...(delivery ? { delivery } : {}), recovery: { stage: null, line: null, attempts: [], log: [] } },
  };
}

const task: ReportObject = { id: 275, title: 'Theme switch for visitors', status: 'accepted', createdAt: T('2026-09-30T15:05:00Z'), meta: { requestId: 269, status: 'accepted', prUrl: PR, verdict: { value: 'approve', proven: 7, total: 7 } } };

const deploying = {
  prUrl: PR,
  pr: 'PR #41',
  repo: 'northwind/share',
  mergedAt: '2026-09-30T22:38:05Z',
  mergedBy: 'Dana Reyes',
  mergeSha: 'a1b2c3d4',
  runs: [{ runId: 9001, name: 'Deploy', runNumber: 512, url: 'https://github.com/northwind/share/actions/runs/9001', status: 'in_progress', conclusion: null, startedAt: '2026-09-30T22:38:11Z' }],
  runsReadAt: '2026-09-30T22:40:00Z',
};

function input(over: Partial<FeatureReportInput> = {}): FeatureReportInput {
  return { request: request(deploying), tasks: [task], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [], now: NOW, watcher: 'Release engineer', ...over };
}

describe('merged: who, when, the run carrying it, and who is watching', () => {
  it('while the deploy the merge started runs, the stage is Deploying and the Now line is that run, on GitHub', () => {
    const report = assembleFeatureReport(input());

    expect(report.state).toMatchObject({ key: 'merge', label: 'Deploying', needsYou: false });
    expect(report.status.headline).toBe('Deploying');
    expect(report.status.sentence).toBe('Merged 30 Sep 2026, 22:38 UTC by Dana Reyes (PR #41). Deploy run #512 is running on GitHub, started 30 Sep 2026, 22:38 UTC. Release engineer is watching it until the release lands.');
    expect(report.status.action).toEqual({ kind: 'link', label: 'Watch the deploy', href: 'https://github.com/northwind/share/actions/runs/9001' });
    expect(report.live).toMatchObject({ kind: 'deploying', label: 'Deploying · Deploy run #512', runRef: null, runHref: 'https://github.com/northwind/share/actions/runs/9001', since: 'started' });
    expect(nowLine(report.live, NOW)).toBe('Deploying · Deploy run #512 · 6 min');
    expect(featureStatusOf(report, { objectType: 'request', href: '/dashboard/p/feature/269' }, NOW).next).toBe('When the deploy finishes, the release is recorded and checked live.');
  });

  it('once every run finished it reads Deployed; a failed run reads Deploy failed and opens it', () => {
    const done = assembleFeatureReport(input({ request: request({ ...deploying, runs: [{ ...deploying.runs[0], status: 'completed', conclusion: 'success' }] }) }));

    expect(done.status.headline).toBe('Deployed');
    expect(done.live).toBeNull();

    const failed = assembleFeatureReport(input({ request: request({ ...deploying, runs: [{ ...deploying.runs[0], status: 'completed', conclusion: 'failure' }] }) }));

    expect(failed.status).toMatchObject({ headline: 'Deploy failed', tone: 'warn', action: { kind: 'link', label: 'Open the failed run', href: deploying.runs[0]!.url } });
  });

  it('a merge whose runs are not read yet still names who merged it and who watches; with no delivery it reads as before', () => {
    const unread = assembleFeatureReport(input({ request: request({ ...deploying, runs: [], runsReadAt: null }) }));

    expect(unread.status.headline).toBe('Merged');
    expect(unread.status.sentence).toContain('by Dana Reyes (PR #41)');
    expect(unread.status.sentence).toContain('Release engineer is watching it');

    const bare = assembleFeatureReport(input({ request: request(null), pulls: new Map([[PR, { merged: true, closed: false, ci: null } as never]]) }));

    expect(bare.status.headline).toBe('Merged');
  });

  it('a release that landed takes over: the delivery is history, not the Now line', () => {
    const release: ReportObject = { id: 280, title: 'send 699f', status: 'active', createdAt: T('2026-09-30T22:50:00Z'), meta: { requestIds: [269], shippedAt: '2026-09-30T22:50:00Z' } };
    const report = assembleFeatureReport(input({ releases: [release] }));

    expect(report.live).toBeNull();
    expect(report.state.key).toBe('released');
  });
});
