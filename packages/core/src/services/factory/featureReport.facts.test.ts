import type { FeatureReportInput, ReportObject, ReportWorkerRun } from './featureReport';
import type { PullSignals } from '@/libs/factory/workFacts';
import { describe, expect, it } from 'vitest';
import { ciFact, nextForAttempt, NO_PULL_SIGNALS, pullFact, requestStageOf, verdictFact } from '@/libs/factory/workFacts';
import { assembleFeatureReport, featureStatusOf } from './featureReport';

/**
 * THE PM SAYS ONLY WHAT THE RECORDS SAY (backlog 044).
 *
 * Conversation 392 (2026-09-30): "#248 already shipped clean, green and
 * merged" — QA had sent it back (5 of 6 proven) and its pull request was
 * unmerged. A later "Stuck?" on #269 was answered "QA is checking it" while CI
 * had failed and no review ran. Each fact is now its own typed field, read
 * from the record that holds it. Fixtures are fictional (Northwind).
 */

const NOW = new Date('2026-09-30T18:00:00Z');
const T = (iso: string) => new Date(iso);
const PR = 'https://github.com/northwind/portal/pull/128';

const request: ReportObject = { id: 248, title: 'Theme toggle on the Northwind portal', status: 'active', createdAt: T('2026-09-30T12:00:00Z'), meta: { state: 'building' } };

function task(over: Partial<ReportObject> & { meta?: Record<string, unknown> } = {}): ReportObject {
  return { id: 301, title: 'Theme toggle', status: 'awaiting_review', createdAt: T('2026-09-30T13:00:00Z'), ...over, meta: { requestId: 248, prUrl: PR, commitSha: 'abc1234def', riskClass: 'ui', ...over.meta } };
}

function completedRun(over: Partial<ReportWorkerRun> = {}): ReportWorkerRun {
  return {
    id: 424,
    agentSlug: 'task-engineer',
    kind: 'worker',
    status: 'completed',
    attempt: 1,
    cents: 210,
    model: null,
    summary: '6/6 checks passed',
    error: null,
    createdAt: T('2026-09-30T13:00:00Z'),
    claimedAt: T('2026-09-30T13:01:00Z'),
    completedAt: T('2026-09-30T17:49:00Z'),
    input: { record: { type: 'engineering_task', id: 301 } },
    result: { pr_url: PR, commit_sha: 'abc1234def', checks: Array.from({ length: 6 }, (_, i) => ({ name: `check-${i}`, passed: true })) },
    progress: {},
    ...over,
  };
}

function input(over: Partial<FeatureReportInput> = {}): FeatureReportInput {
  return { request, tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [], now: NOW, ...over };
}

const signals = (over: Partial<PullSignals> = {}): Map<string, PullSignals> => new Map([[PR, { ...NO_PULL_SIGNALS, ...over }]]);

describe('a completed run is not a shipped feature', () => {
  it('conversation 392: QA sent it back and the PR is unmerged — every fact says so on its own field', () => {
    const sentBack = task({ status: 'changes_requested', meta: { status: 'changes_requested', verdict: { value: 'changes', proven: 5, total: 6, commitSha: 'abc1234def', at: '2026-09-30T17:55:00Z', note: 'The toggle does not persist.' } } });
    const report = assembleFeatureReport(input({ tasks: [sentBack], workerRuns: [completedRun()], pulls: signals({ checks: { conclusion: 'success', failedChecks: null, headSha: 'abc1234def', at: '2026-09-30T17:50:00Z' } }) }));

    expect(report.facts.verdict).toMatchObject({ value: 'changes', proven: 5, total: 6, line: 'QA sent it back: 5 of 6 proven' });
    expect(report.facts.pullRequest).toMatchObject({ merge: 'not_merged', label: 'PR #128' });
    expect(report.facts.ci).toMatchObject({ state: 'passed' });
    expect(report.facts.request).toMatchObject({ id: 248, stage: 'changes_asked', recordState: 'building' });
    expect(report.facts.shipped).toBe(false);
    expect(report.facts.next).toBe('The next attempt builds with what QA found');
  });

  it('the portable status carries the same facts (API, MCP and read_object read one shape)', () => {
    const report = assembleFeatureReport(input({ tasks: [task({ status: 'changes_requested', meta: { verdict: { value: 'changes', proven: 5, total: 6 } } })], workerRuns: [completedRun()] }));
    const status = featureStatusOf(report, { objectType: 'request', href: '/dashboard/p/feature/248' }, NOW);

    expect(status.facts).toEqual(report.facts);
  });
});

describe('"Stuck?": the stage reads CI, and QA only while a review runs', () => {
  it('#269: awaiting review with CI failed and no review running reads CI failed, never "QA is checking"', () => {
    const report = assembleFeatureReport(input({ tasks: [task()], workerRuns: [completedRun()], pulls: signals({ checks: { conclusion: 'failure', failedChecks: 'integration', headSha: 'abc1234def', at: '2026-09-30T17:52:00Z' } }) }));

    expect(report.state).toMatchObject({ key: 'qa', label: 'CI failed', needsYou: false });
    expect(report.status.headline).toBe('CI failed');
    expect(report.status.sentence).not.toContain('QA is checking');
    expect(report.facts.ci).toMatchObject({ state: 'failed', failedChecks: 'integration', line: 'CI failed on PR #128 (integration)' });
    expect(report.facts.verdict.value).toBeNull();
    expect(report.facts.next).toBe('CI failed, so QA does not start; the factory sends it back to the engineer with what failed');
  });

  it('with no CI report on this commit, it is waiting for CI — not a pass', () => {
    const report = assembleFeatureReport(input({ tasks: [task()], workerRuns: [completedRun()], pulls: signals({ checks: { conclusion: 'success', failedChecks: null, headSha: '9999999aaa', at: '2026-09-30T12:00:00Z' } }) }));

    expect(report.state.label).toBe('Waiting for CI');
    expect(report.facts.ci.state).toBe('not_reported');
  });

  it('with CI green, it is in QA', () => {
    const report = assembleFeatureReport(input({ tasks: [task()], workerRuns: [completedRun()], pulls: signals({ checks: { conclusion: 'success', failedChecks: null, headSha: 'abc1234', at: '2026-09-30T17:50:00Z' } }) }));

    expect(report.status.headline).toBe('In QA');
    expect(report.facts.request.stage).toBe('awaiting_qa');
  });
});

describe('who merges it is the trust rule\'s word', () => {
  const approved = task({ status: 'accepted', meta: { verdict: { value: 'approve', proven: 6, total: 6 } } });

  it('a class whose rule runs within bounds merges on its own; nobody is waited on, and no merge card is promised', () => {
    const report = assembleFeatureReport(input({ tasks: [approved], workerRuns: [completedRun()], mergeRule: { runsItself: true, riskClass: 'ui' } }));

    expect(report.state).toMatchObject({ key: 'merge', label: 'Merging', needsYou: false });
    expect(report.you.needsYou).toBe(false);
    expect(report.facts.mergeRule).toMatchObject({ runsItself: true, riskClass: 'ui' });
    expect(report.facts.next).toBe('It merges on its own on its trust rule');
  });

  it('a class at approval waits on a person', () => {
    const report = assembleFeatureReport(input({ tasks: [approved], workerRuns: [completedRun()], mergeRule: { runsItself: false, riskClass: 'auth' } }));

    expect(report.state).toMatchObject({ label: 'Ready to merge', needsYou: true });
    expect(report.facts.request.stage).toBe('ready_to_merge');
  });

  it('GitHub\'s pr.merged makes it merged, and merged is not shipped', () => {
    const report = assembleFeatureReport(input({ tasks: [approved], workerRuns: [completedRun()], pulls: signals({ merged: { at: '2026-09-30T17:58:00Z' } }) }));

    expect(report.state).toMatchObject({ label: 'Merged', needsYou: false });
    expect(report.facts.pullRequest.merge).toBe('merged');
    expect(report.facts.request.stage).toBe('merged');
    expect(report.facts.shipped).toBe(false);
  });
});

describe('the facts, one at a time', () => {
  it('a verdict nobody recorded is not a pass', () => {
    expect(verdictFact({ status: 'awaiting_review', meta: {} })).toMatchObject({ value: null, line: 'QA has not judged it yet' });
    expect(verdictFact({ status: 'changes_requested', meta: { ciFailure: { at: '2026-09-30T17:52:00Z', checks: 'integration' } } }).line).toBe('QA has not judged it: CI failed and sent it back to the engineer first');
    expect(verdictFact(null).line).toBe('No task on record, so no QA verdict');
  });

  it('"not merged" says nothing records a merge, rather than asserting the PR is open', () => {
    expect(pullFact(PR, NO_PULL_SIGNALS).line).toBe('PR #128 is not merged (nothing records a merge)');
    expect(pullFact(null, NO_PULL_SIGNALS).merge).toBe('no_pull_request');
    expect(pullFact(PR, { ...NO_PULL_SIGNALS, closed: { at: null } }).merge).toBe('closed');
  });

  it('CI recorded as failed on the task stands when GitHub reported nothing for this commit', () => {
    expect(ciFact(NO_PULL_SIGNALS, { commit: 'abc1234', ciFailure: { at: '2026-09-30T17:52:00Z', checks: 'integration' } }, 'PR #128')).toMatchObject({ state: 'failed', failedChecks: 'integration' });
  });

  it('what is next never reads a finished run alone', () => {
    const verdict = verdictFact({ status: 'awaiting_review', meta: {} });
    const pull = pullFact(PR, NO_PULL_SIGNALS);
    const ci = ciFact(NO_PULL_SIGNALS, { commit: null, ciFailure: null }, 'PR #128');

    expect(nextForAttempt({ verdict, pullRequest: pull, ci, mergeRule: { runsItself: null, riskClass: null, line: '' }, shipped: false, taskStage: 'awaiting_review' })).toBe('Waiting for CI; QA starts when it is green');
    expect(nextForAttempt({ verdict, pullRequest: pull, ci, mergeRule: { runsItself: null, riskClass: null, line: '' }, shipped: false, taskStage: 'awaiting_review', superseded: true })).toBe('A newer attempt replaced this one; read that attempt');
  });

  it('the request stage: shipped only on a live release, merged on a recorded merge', () => {
    expect(requestStageOf('merge', { merged: false, shipped: false, closed: false, decidingMerge: false })).toBe('ready_to_merge');
    expect(requestStageOf('merge', { merged: true, shipped: false, closed: false, decidingMerge: false })).toBe('merged');
    expect(requestStageOf('released', { merged: true, shipped: true, closed: false, decidingMerge: false })).toBe('shipped');
    expect(requestStageOf('changes', { merged: false, shipped: false, closed: false, decidingMerge: false })).toBe('changes_asked');
    expect(requestStageOf('waiting', { merged: false, shipped: false, closed: true, decidingMerge: false })).toBe('closed');
  });
});
