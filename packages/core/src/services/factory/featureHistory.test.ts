import type { FeatureReportInput, HistoryRow, ReportActivity } from './featureReport';
import { describe, expect, it } from 'vitest';
import { assembleFeatureReport } from './featureReport';

/**
 * THE TIMELINE (Chris, 2026-10-02, FE-370): one list, newest first, each run
 * titled by what it did and found, each attempt a group with its build and
 * QA's reviews under it, a cost on every row and the split at the foot, and
 * no line said twice. Fictional fixture (Northwind), shaped like the request
 * that showed the problems: three attempts, QA sending one back, a merge, a
 * deploy, a release and a live check.
 */

const T = (iso: string) => new Date(iso);
const PR = (n: number) => `https://github.com/example/northwind-portal/pull/${n}`;

const agent = (over: Partial<ReportActivity> & Pick<ReportActivity, 'id'>): ReportActivity => ({
  kind: 'mission_run',
  title: 'contract-red-team-evidence: Green checks are not the same as a proven contract',
  at: T('2026-10-02T08:00:00Z'),
  status: 'completed',
  runStatus: 'completed',
  detail: null,
  label: 'QA reviewed',
  doing: 'QA reviewing',
  touched: [],
  cents: null,
  ...over,
});

function input(): FeatureReportInput {
  const run = (id: number, task: number, status: string, at: string, cents: number, extra: Record<string, unknown> = {}) => ({
    id,
    agentSlug: 'northwind-engineer',
    kind: 'worker',
    status,
    attempt: 1,
    cents,
    model: null,
    summary: `Task nw-t${task} (logic): changed 1 file(s), 6/6 checks passed, opened ${PR(id - 304)}`,
    error: status === 'failed' ? 'verification failed: required checks failed: test.' : null,
    createdAt: T(at),
    claimedAt: T(at),
    completedAt: new Date(T(at).getTime() + 10 * 60_000),
    input: { record: { type: 'engineering_task', id: task } },
    result: status === 'completed' ? { pr_url: PR(id - 304), checks: Array.from({ length: 6 }, (_, i) => ({ name: `check-${i}`, passed: true })) } : null,
    progress: {},
    failures: status === 'failed' ? [{ scope: 'check:test' }] : [],
    ...extra,
  });
  return {
    request: {
      id: 370,
      title: 'Show the upload date on each library row',
      status: 'shipped',
      createdAt: T('2026-10-02T07:13:00Z'),
      meta: {
        state: 'shipped',
        liveCheck: { state: 'seen', line: 'Seen live: 4 of 4 states reached', releaseId: 375, checkedAt: '2026-10-02T08:31:53Z', attempt: 1 },
        delivery: { prUrl: PR(175), pr: 'PR #175', repo: 'example/northwind-portal', mergedAt: '2026-10-02T08:22:25Z', mergedBy: 'dana', mergeSha: 'abc123', runs: [{ runId: 9001, name: 'Deploy', runNumber: 70, url: 'https://github.com/example/northwind-portal/actions/runs/9001', status: 'in_progress', conclusion: null, startedAt: '2026-10-02T08:22:28Z' }], runsReadAt: null },
        recovery: {
          log: [
            { at: '2026-10-02T07:39:20Z', text: 'Attempt 1 of 3 started.', runId: 477 },
            { at: '2026-10-02T08:22:26.878Z', text: 'Would have run "Write the standard", but it is paused by usr-0001.', runId: null },
            { at: '2026-10-02T08:22:27Z', text: 'Merged PR #175 by dana; the runs it started carry it to the release.', runId: null },
            { at: '2026-10-02T08:30:32Z', text: 'Shipped in release #375.', runId: null },
            { at: '2026-10-02T08:31:53.647Z', text: 'Seen live: 4 of 4 states reached (release #375, attempt 1).', runId: null },
          ],
        },
      },
    },
    tasks: [
      { id: 372, title: 'Attempt 1', status: 'rejected', createdAt: T('2026-10-02T07:39:00Z'), meta: { requestId: 370 } },
      { id: 373, title: 'Attempt 2', status: 'abandoned', createdAt: T('2026-10-02T07:48:00Z'), meta: { requestId: 370, verdict: { value: 'changes', at: '2026-10-02T08:09:25Z', proven: 4, total: 6, note: 'Four tests passed.', criteria: [{ criterion: 'Rows show the upload date', status: 'proven' }, { criterion: 'A document with no upload date keeps its layout', status: 'unproven' }] } } },
      { id: 374, title: 'Attempt 3', status: 'accepted', createdAt: T('2026-10-02T08:09:00Z'), meta: { requestId: 370, prUrl: PR(175), verdict: { value: 'approve', at: '2026-10-02T08:22:22Z', proven: 6, total: 6, note: 'All proven.' } } },
    ],
    plans: [{ id: 371, title: 'Plan', status: 'active', createdAt: T('2026-10-02T07:13:53Z'), meta: { requestId: 370, status: 'approved', approvedAt: '2026-10-02T07:14:00Z', approvedBy: 'agent:product-manager' } }],
    workerRuns: [
      run(477, 372, 'failed', '2026-10-02T07:39:00Z', 96),
      run(478, 373, 'completed', '2026-10-02T07:54:00Z', 106),
      run(479, 374, 'completed', '2026-10-02T08:08:00Z', 75),
    ],
    asks: [],
    actionRuns: [],
    releases: [{ id: 375, title: 'northwind 2ad2e85', status: 'active', createdAt: T('2026-10-02T08:30:30Z'), meta: { requestIds: [370], releasedAt: '2026-10-02T08:30:32.748Z', product: 'northwind', version: '2ad2e85', liveEvidence: [370, 370, 370, 370].map(requestId => ({ requestId, status: 'reached' })) } }],
    artifacts: [],
    now: T('2026-10-02T12:00:00Z'),
    people: { 'usr-0001': 'Dana Okafor' },
    codes: new Map([[371, 'PL-371'], [372, 'ET-372'], [373, 'ET-373'], [374, 'ET-374'], [375, 'REL-375']]),
    activity: [
      // The planning run and a mockup run were both running when PL-371 was
      // filed; the call at that second says which one filed it.
      agent({ id: 7093, label: 'Planned it', doing: 'Writing the plan', startedAt: T('2026-10-02T07:13:14Z'), endedAt: T('2026-10-02T07:14:27Z'), touched: [370], calls: [T('2026-10-02T07:13:20Z'), T('2026-10-02T07:13:53.100Z')] }),
      agent({ id: 7096, label: 'Drew the mockup', doing: 'Drawing the mockup', startedAt: T('2026-10-02T07:13:32Z'), endedAt: T('2026-10-02T07:14:18Z'), touched: [370], calls: [T('2026-10-02T07:13:40Z'), T('2026-10-02T07:14:10Z')] }),
      // A review its pull request started names no record; its verdict call says which attempt.
      agent({ id: 7114, startedAt: T('2026-10-02T08:08:23Z'), endedAt: T('2026-10-02T08:08:55Z'), touched: [], calls: [T('2026-10-02T08:09:25Z')], cents: 40 }),
      agent({ id: 7117, startedAt: T('2026-10-02T08:21:47Z'), endedAt: T('2026-10-02T08:21:59Z'), touched: [374], calls: [T('2026-10-02T08:22:22Z')] }),
      agent({ id: 7119, label: 'Drafted the release note', startedAt: T('2026-10-02T08:30:34Z'), endedAt: T('2026-10-02T08:31:24Z'), touched: [370], calls: [T('2026-10-02T08:31:20Z')] }),
      // The live check read the shipped task after the merge: not a review of it.
      agent({ id: 7121, label: 'Checked it live', startedAt: T('2026-10-02T08:30:51Z'), endedAt: T('2026-10-02T08:32:08Z'), touched: [370, 374], calls: [T('2026-10-02T08:31:53.500Z')] }),
      { kind: 'conversation', id: 405, title: 'Requested in chat by Dana Okafor', at: T('2026-10-02T07:12:00Z'), status: null, detail: null, origin: true },
    ],
  };
}

const titles = (rows: HistoryRow[]) => rows.map(r => r.title);

describe('the feature\'s Timeline', () => {
  const report = assembleFeatureReport(input());
  const rows = report.history;

  it('titles every run by what it did and found, never by a slug, a charter line or a log line', () => {
    const all = rows.flatMap(r => [r, ...(r.children ?? [])]).map(r => r.title);

    expect(all).toEqual(expect.arrayContaining([
      'Checked it live · seen 4 of 4',
      'Drafted the release note',
      'Planned it · PL-371',
      'Drew the mockup',
      'Built attempt 3 · 6/6 checks · PR #175',
      'Built attempt 1 · failed `test`',
      'QA reviewed attempt 3 · approved 6 of 6',
      'QA reviewed attempt 2 · sent back: A document with no upload date keeps its layout',
    ]));
    expect(all.join('\n')).not.toMatch(/contract-red-team|release-live-check|Task nw-t|Green checks are not|Checked it live attempt/);
    expect(all).not.toContain('Drew the mockup · PL-371');
  });

  it('groups each attempt, newest first, its cost the sum of its rows', () => {
    const attempts = rows.filter(r => r.kind === 'attempt');

    expect(titles(attempts)).toEqual(['Attempt 3 of 3 · passed', 'Attempt 2 of 3 · sent back', 'Attempt 1 of 3 · failed']);
    expect(attempts[1]!.cents).toBe(106 + 40);
    expect(titles(attempts[0]!.children!)).toEqual(['QA reviewed attempt 3 · approved 6 of 6', 'Built attempt 3 · 6/6 checks · PR #175']);
    expect(titles(attempts[1]!.children!)[0]).toBe('QA reviewed attempt 2 · sent back: A document with no upload date keeps its layout');
  });

  it('reads newest first, where it started last', () => {
    const times = rows.map(r => r.at).filter((t): t is string => t !== null).map(t => Date.parse(t));

    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(rows.at(-1)!.title).toBe('Requested in chat by Dana Okafor');
  });

  it('says the merge, the deploy and the release once each, and folds a note beside one under it', () => {
    const all = titles(rows);

    // The deploy run was read in progress at the merge; the release after it says it finished.
    expect(all).toEqual(expect.arrayContaining(['Merged PR #175 · by dana', 'Deployed', 'Released']));
    expect(rows.find(r => r.kind === 'deploy')!.live).toBe(false);
    // A note written while a run ran is that run's.
    expect(rows.find(r => r.title === 'Checked it live · seen 4 of 4')!.notes).toEqual(['Seen live: 4 of 4 states reached (release #375, attempt 1).']);
    expect(all.filter(t => /Shipped in release|Merged PR #175 by/.test(t))).toEqual([]);
    // A note beside a typed row is that row's: folded under it, said in the side panel only.
    expect(all.join('\n')).not.toContain('Would have run');
    expect(rows.flatMap(r => r.notes ?? [])).toContain('Would have run "Write the standard", but it is paused by Dana Okafor.');
    expect(rows.find(r => r.kind === 'release')!.notes).toEqual(['Shipped in release #375.']);
    expect(rows.find(r => r.kind === 'release')!.code).toBe('REL-375');
  });

  it('feet the cost: the total and its split, agents not recorded when no agent run is costed', () => {
    expect(report.historyCost.totalCents).toBe(96 + 106 + 75 + 40);
    expect(report.historyCost.split).toEqual([
      { key: 'builds', label: 'Builds', cents: 277 },
      { key: 'agents', label: 'Agents', cents: 40 },
      { key: 'chat', label: 'Chat', cents: null },
    ]);
  });

  it('reads the shipped attempt\'s checks, never an earlier one\'s, and no estimate is not $0.00', () => {
    expect(report.implementation.shipped?.runId).toBe(479);
    expect(report.implementation.ladder.find(s => s.key === 'checks')).toMatchObject({ value: 'Passed', state: 'yes' });
    expect(report.implementation.costLine).not.toContain('$0.00');
    expect(report.release).toMatchObject({ code: 'REL-375', seen: { state: 'seen', reached: 4, total: 4 } });
  });
});
