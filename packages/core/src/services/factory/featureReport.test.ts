import type { FeatureReportInput, ReportActionRun, ReportArtifact, ReportAsk, ReportObject, ReportSectionKey, ReportWorkerRun } from './featureReport';
import { describe, expect, it } from 'vitest';
import { assembleFeatureReport, formatDuration, moneyLine, qaEvidenceRole, REPORT_SECTION_KEYS, runChange } from './featureReport';

/**
 * The feature report, assembled from fixtures.
 *
 * Five shapes, because five shapes are what the factory actually produces: a
 * feature that went the whole way, a request nobody contracted, a task
 * nobody released, a run that says it failed whose pull request merged, and
 * a task with no QA evidence — which is every task today.
 *
 * The cast is the fixture cast (`libs/fixtures/realDataGuard.ts`).
 */

const T = (iso: string) => new Date(iso);
const NOW = T('2026-09-21T12:00:00Z');

function section(report: ReturnType<typeof assembleFeatureReport>, key: ReportSectionKey) {
  return report.sections.find(s => s.key === key)!;
}

const request: ReportObject = {
  id: 41,
  title: 'Export a room as a PDF',
  status: 'in_scope',
  createdAt: T('2026-09-01T09:00:00Z'),
  meta: {
    kind: 'gap',
    channel: 'dogfood',
    product: 'northwind-portal',
    body: 'I can read the room on screen but I cannot hand it to my board. Give me a PDF.',
    askedBy: { name: 'Dana Okafor', email: 'dana@northwind.example' },
    askedAt: '2026-09-01T09:00:00Z',
    severity: 'p2',
    sizeClass: 'minor',
    riskFloor: 'ui',
    decisionCost: 5,
    state: 'shipped',
    priority: 82,
    theme: 'sharing',
    priorityReason: 'Three dogfood notes in a fortnight; the workaround is a screenshot.',
    rankedAt: '2026-09-02T08:00:00Z',
    recommendedAt: '2026-09-02T10:00:00Z',
    recommendedOutcome: 'build',
    recommendationState: 'approved',
    decidedAt: '2026-09-02T16:30:00Z',
    decisionReason: 'Worth the week. Ship it behind the existing share menu.',
    estimateCents: 900,
    actualCents: 1450,
  },
};

const task: ReportObject = {
  id: 77,
  title: 'Room PDF export',
  status: 'accepted',
  createdAt: T('2026-09-03T09:00:00Z'),
  meta: {
    requestId: 41,
    repoSlug: 'northwind-portal',
    objective: 'Add a PDF export to the room share menu.',
    acceptanceContract: ['The share menu offers PDF', 'The PDF carries every section in order'],
    allowedPaths: ['src/features/rooms/**', 'src/services/export/**'],
    requiredChecks: ['npm run lint', 'npm run test'],
    riskClass: 'ui',
    sizeClass: 'minor',
    attempt: 2,
    estimateCents: 900,
    actualCents: 1450,
    costUpdatedAt: '2026-09-05T11:00:00Z',
    branch: 'feat/room-pdf',
    commitSha: 'abc1234',
    prUrl: 'https://github.com/example/northwind-portal/pull/12',
    filesChanged: ['src/features/rooms/ShareMenu.tsx', 'src/services/export/pdf.ts'],
    checks: [{ name: 'npm run lint', passed: true, exitCode: 0 }, { name: 'npm run test', passed: true, exitCode: 0 }],
  },
};

const release: ReportObject = {
  id: 9,
  title: 'northwind-portal 2.4.0',
  status: 'shipped',
  createdAt: T('2026-09-06T09:00:00Z'),
  meta: {
    product: 'northwind-portal',
    version: '2.4.0',
    releasedAt: '2026-09-06T10:00:00Z',
    taskIds: [77],
    requestIds: [41],
    prUrls: ['https://github.com/example/northwind-portal/pull/12'],
    notes: 'Rooms export as a PDF from the share menu.',
    announcement: 'You can now hand a room to someone who does not have a login.',
    announcedAt: '2026-09-06T11:00:00Z',
    announcedTo: ['changelog', 'email'],
  },
};

function run(over: Partial<ReportWorkerRun> = {}): ReportWorkerRun {
  return {
    id: 501,
    agentSlug: 'task-engineer',
    kind: 'worker',
    status: 'completed',
    attempt: 1,
    cents: 620,
    model: 'claude-sonnet-4-6',
    summary: 'Added the export and wired it into the share menu.',
    error: null,
    createdAt: T('2026-09-03T10:00:00Z'),
    claimedAt: T('2026-09-03T10:05:00Z'),
    completedAt: T('2026-09-03T11:35:00Z'),
    input: { record: { type: 'engineering_task', id: 77 } },
    result: {
      pr_url: 'https://github.com/example/northwind-portal/pull/12',
      branch: 'feat/room-pdf',
      commit_sha: 'abc1234',
      files_changed: ['src/services/export/pdf.ts'],
      checks: [{ name: 'npm run lint', passed: true, exitCode: 0 }],
    },
    progress: {},
    ...over,
  };
}

const ask: ReportAsk = {
  id: 301,
  kind: 'merge',
  title: 'Merge the room PDF export?',
  body: 'Two checks green, ui risk.',
  status: 'approved',
  decision: 'approve',
  decisionNote: 'Read the diff. Fine.',
  decidedBy: 'chris@metacto.example',
  decidedAt: T('2026-09-05T10:00:00Z'),
  decisionCost: 5,
  contextUrl: 'https://github.com/example/northwind-portal/pull/12',
  createdAt: T('2026-09-05T09:00:00Z'),
  objectRefs: [{ type: 'engineering_task', id: '77' }],
};

const handoff: ReportActionRun = {
  id: 88,
  actionId: 'release.announce',
  status: 'done',
  input: { taskId: 77 },
  decidedBy: 'chris@metacto.example',
  decidedAt: T('2026-09-06T10:30:00Z'),
  approvedByAgent: false,
  note: 'Send it to the changelog list too.',
  createdAt: T('2026-09-06T10:00:00Z'),
  executedAt: T('2026-09-06T11:00:00Z'),
};

const screenshot: ReportArtifact = {
  id: 700,
  kind: 'file',
  title: 'Share menu, PDF offered',
  recordType: 'object',
  recordId: '77',
  recordRole: 'qa-screenshot',
  spec: { url: 'https://files.example/qa/share-menu.png', caption: 'The share menu with the new PDF entry.' },
  url: null,
  createdAt: T('2026-09-05T08:00:00Z'),
};

function input(over: Partial<FeatureReportInput> = {}): FeatureReportInput {
  return {
    request,
    tasks: [task],
    workerRuns: [run()],
    asks: [ask],
    actionRuns: [handoff],
    releases: [release],
    artifacts: [screenshot],
    now: NOW,
    ...over,
  };
}

describe('the sections', () => {
  it('always renders all nine, in reading order', () => {
    const report = assembleFeatureReport(input());

    expect(report.sections.map(s => s.key)).toEqual([...REPORT_SECTION_KEYS]);
    expect(report.sections.map(s => s.key)).toEqual(['ask', 'triage', 'contract', 'approvals', 'runs', 'change', 'qa', 'release', 'money']);
  });

  it('a complete feature has every stage present and none of them absent', () => {
    const report = assembleFeatureReport(input());

    expect(report.sections.filter(s => s.absence !== null)).toEqual([]);
  });

  it('carries the ask in the asker\'s own words, with who asked and through which door', () => {
    const ask = section(assembleFeatureReport(input()), 'ask');

    expect(ask.facts.find(f => f.label === 'In their words')?.value).toContain('hand it to my board');
    expect(ask.facts.find(f => f.label === 'Asked by')?.value).toBe('Dana Okafor');
    expect(ask.facts.find(f => f.label === 'Channel')?.value).toBe('dogfood');
    expect(ask.facts.find(f => f.label === 'Asked')?.value).toBe('01 Sep 2026, 09:00 UTC');
  });

  it('carries the contract: objective, allowed paths, acceptance, checks, risk and the estimate', () => {
    const contract = section(assembleFeatureReport(input()), 'contract');
    const entry = contract.entries[0]!;

    expect(entry.title).toBe('Add a PDF export to the room share menu.');
    expect(entry.facts.find(f => f.label === 'Risk class')?.value).toBe('ui');
    expect(entry.facts.find(f => f.label === 'Estimate')?.value).toBe('$9.00');
    expect(entry.checks.map(c => c.name)).toEqual(['npm run lint', 'npm run test']);
    expect(contract.lists.find(l => l.label.startsWith('Acceptance'))?.items).toContain('The share menu offers PDF');
    expect(contract.lists.find(l => l.label.startsWith('Allowed'))?.items).toContain('src/features/rooms/**');
  });

  it('names who decided each approval, when, and what they said', () => {
    const approvals = section(assembleFeatureReport(input()), 'approvals');

    expect(approvals.entries.map(e => e.key)).toEqual(['ask-301', 'action-88']);
    expect(approvals.entries[0]!.facts.find(f => f.label === 'Decided by')?.value).toBe('chris@metacto.example');
    expect(approvals.entries[0]!.facts.find(f => f.label === 'Note')?.value).toBe('Read the diff. Fine.');
    expect(approvals.entries[1]!.facts.find(f => f.label === 'Decided by')?.value).toBe('chris@metacto.example');
  });

  it('says a hand-off the ladder released was not a person', () => {
    const report = assembleFeatureReport(input({ actionRuns: [{ ...handoff, approvedByAgent: true, decidedBy: 'agent:product-manager' }] }));

    expect(section(report, 'approvals').entries[1]!.facts.find(f => f.label === 'Decided by')?.value)
      .toBe('agent:product-manager — released by the trust ladder, not by a person');
    expect(report.summary.humanDecisions).toBe(1);
  });

  it('carries each run with its agent, attempt, duration, cost and checks', () => {
    const runs = section(assembleFeatureReport(input()), 'runs');
    const entry = runs.entries[0]!;

    expect(entry.facts.find(f => f.label === 'Agent')?.value).toBe('task-engineer');
    expect(entry.facts.find(f => f.label === 'Duration')?.value).toBe('1h 30m');
    expect(entry.facts.find(f => f.label === 'Cost')?.value).toBe('$6.20');
    expect(entry.checks).toEqual([{ name: 'npm run lint', passed: true, detail: 'exit 0' }]);
  });

  it('carries the change: the pull request, its checks, the merge commit and the files', () => {
    const change = section(assembleFeatureReport(input()), 'change');
    const entry = change.entries[0]!;

    expect(entry.facts.find(f => f.label === 'Pull request')?.value).toBe('https://github.com/example/northwind-portal/pull/12');
    expect(entry.facts.find(f => f.label === 'Merge commit')?.value).toBe('abc1234');
    expect(entry.facts.find(f => f.label === 'Files changed')?.value).toBe('2');
    expect(entry.checks.every(c => c.passed)).toBe(true);
  });

  it('carries the release: notes, announcement, when and to which surface', () => {
    const rel = section(assembleFeatureReport(input()), 'release');

    expect(rel.entries[0]!.facts.find(f => f.label === 'Announcement')?.value).toContain('does not have a login');
    expect(rel.entries[0]!.facts.find(f => f.label === 'Announced to')?.value).toBe('changelog, email');
    expect(rel.entries[0]!.facts.find(f => f.label === 'Shipped')?.value).toBe('06 Sep 2026, 10:00 UTC');
  });
});

describe('a stage that did not happen says so', () => {
  it('a request with no task has no contract, no run, no change and no release', () => {
    const report = assembleFeatureReport(input({ tasks: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] }));

    expect(section(report, 'contract').absence).toBe('No task contract was written for this request; nothing was dispatched.');
    expect(section(report, 'runs').absence).toBe('No worker run is recorded against this work.');
    expect(section(report, 'change').absence).toBe('No pull request is recorded for this work.');
    expect(section(report, 'release').absence).toBe('No release carries this task.');
  });

  it('a task with no release says no release carries it, and does not infer one from the merged PR', () => {
    const report = assembleFeatureReport(input({ releases: [] }));

    expect(section(report, 'release').absence).toBe('No release carries this task.');
    expect(section(report, 'change').absence).toBeNull();
    expect(report.summary.shippedAt).toBeNull();
    expect(report.summary.elapsedOpen).toBe(true);
  });

  it('work nobody approved that still ran reads as earned autonomy, and work nobody ran does not', () => {
    const ranAlone = assembleFeatureReport(input({ asks: [], actionRuns: [] }));
    const neverStarted = assembleFeatureReport(input({ asks: [], actionRuns: [], workerRuns: [] }));

    expect(section(ranAlone, 'approvals').absence).toBe('No person approved this; it ran under earned autonomy.');
    expect(section(neverStarted, 'approvals').absence).toBe('Nothing about this work was ever put in front of a person.');
  });

  it('an untriaged request says nobody triaged it', () => {
    const report = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'new' } } }));

    expect(section(report, 'triage').absence).toBe('No one triaged this request; it is still in `new`.');
  });
});

describe('QA evidence', () => {
  it('is a gallery with captions when a worker posted any', () => {
    const qa = section(assembleFeatureReport(input()), 'qa');

    expect(qa.absence).toBeNull();
    expect(qa.evidence).toEqual([{
      id: 700,
      role: 'qa-screenshot',
      title: 'Share menu, PDF offered',
      caption: 'The share menu with the new PDF entry.',
      url: 'https://files.example/qa/share-menu.png',
      at: T('2026-09-05T08:00:00Z'),
    }]);
  });

  it('says plainly that none was captured rather than hiding the section', () => {
    const qa = section(assembleFeatureReport(input({ artifacts: [] })), 'qa');

    expect(qa.absence).toBe('No QA evidence was captured for this task.');
    expect(qa.flags[0]).toContain('recordRole: qa-screenshot | qa-video | qa-report');
  });

  it('ignores an artifact on the task that is not QA evidence', () => {
    const brief: ReportArtifact = { ...screenshot, id: 701, recordRole: 'brief', spec: {} };
    const qa = section(assembleFeatureReport(input({ artifacts: [brief] })), 'qa');

    expect(qa.absence).toBe('No QA evidence was captured for this task.');
  });

  it('reads the marker off recordRole, or off spec.kind when a worker wrote it there', () => {
    expect(qaEvidenceRole({ recordRole: 'qa-video', spec: {} })).toBe('qa-video');
    expect(qaEvidenceRole({ recordRole: null, spec: { kind: 'qa-report' } })).toBe('qa-report');
    expect(qaEvidenceRole({ recordRole: 'brief', spec: {} })).toBeNull();
  });
});

describe('the contradiction: a failed run whose pull request merged', () => {
  const failed = run({
    id: 502,
    status: 'failed',
    cents: 830,
    summary: null,
    error: 'completion call timed out',
    completedAt: T('2026-09-04T12:00:00Z'),
    result: null,
    progress: { keptBranch: 'feat/room-pdf', prUrl: 'https://github.com/example/northwind-portal/pull/12', continue: 'git fetch && git switch feat/room-pdf' },
  });

  it('shows both facts and flags the disagreement', () => {
    const report = assembleFeatureReport(input({ workerRuns: [failed] }));

    expect(report.contradictions[0]).toContain('Run 502 is recorded as failed');
    expect(report.contradictions[0]).toContain('merged');
    expect(section(report, 'runs').entries[0]!.status).toBe('failed');
    expect(section(report, 'change').entries[0]!.facts.find(f => f.label === 'Merge commit')?.value).toBe('abc1234');
  });

  it('keeps the branch and the draft pull request on the failed run, so a person can pick it up', () => {
    const entry = section(assembleFeatureReport(input({ workerRuns: [failed] })), 'runs').entries[0]!;

    expect(entry.facts.find(f => f.label === 'Kept branch')?.value).toBe('feat/room-pdf');
    expect(entry.facts.find(f => f.label === 'Draft pull request')?.value).toBe('https://github.com/example/northwind-portal/pull/12');
    expect(entry.facts.find(f => f.label === 'How to continue')?.value).toBe('git fetch && git switch feat/room-pdf');
    expect(entry.flags[0]).toContain('completion call can time out');
  });

  it('does not flag a failed run whose pull request never merged', () => {
    const unmerged = { ...task, meta: { ...task.meta, commitSha: undefined, status: 'changes_requested' } };
    const report = assembleFeatureReport(input({ workerRuns: [failed], tasks: [unmerged], releases: [] }));

    expect(report.contradictions.filter(c => c.includes('Run 502'))).toEqual([]);
  });
});

describe('the timeline', () => {
  it('runs oldest first, so the newest entry is last', () => {
    const report = assembleFeatureReport(input());
    const stamps = report.timeline.map(e => e.at?.getTime() ?? Number.POSITIVE_INFINITY);

    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(report.timeline[0]!.key).toBe('asked');
    expect(report.timeline.at(-1)!.key).toBe('action-88');
  });

  it('stamps an entry with its cost where money was spent', () => {
    const report = assembleFeatureReport(input());

    expect(report.timeline.find(e => e.key === 'run-501')!.cents).toBe(620);
    expect(report.timeline.find(e => e.key === 'contract-77')!.cents).toBe(900);
    expect(report.timeline.find(e => e.key === 'asked')!.cents).toBeNull();
  });

  it('puts an undated entry last rather than at the epoch', () => {
    const openRun = run({ id: 503, status: 'running', completedAt: null, claimedAt: T('2026-09-20T09:00:00Z') });
    const report = assembleFeatureReport(input({ workerRuns: [openRun], releases: [] }));
    const pr = report.timeline.find(e => e.key === 'run-503-pr')!;

    expect(pr.at).toBeNull();
    expect(report.timeline.at(-1)!.key).toBe('run-503-pr');
  });

  it('carries every stage that happened and nothing that did not', () => {
    const report = assembleFeatureReport(input());

    expect(report.timeline.map(e => e.kind)).toEqual([
      'asked',
      'triaged',
      'decision',
      'decision',
      'contract',
      'run',
      'change',
      'qa',
      'decision',
      'release',
      'decision',
    ]);
  });
});

describe('the money line', () => {
  it('sums the task estimates and actuals and reports the variance both ways', () => {
    const report = assembleFeatureReport(input());

    expect(report.money.estimateCents).toBe(900);
    expect(report.money.actualCents).toBe(1450);
    expect(report.money.varianceCents).toBe(550);
    expect(report.money.variancePct).toBe(61);
    expect(section(report, 'money').facts.find(f => f.label === 'Variance')?.value).toBe('+$5.50 (+61%)');
  });

  it('falls back to what the runs charged when no task carries an actual', () => {
    const noActual = { ...task, meta: { ...task.meta, actualCents: undefined } };
    const line = moneyLine(request, [noActual], [run(), run({ id: 502, cents: 300 })]);

    expect(line.actualCents).toBe(920);
    expect(line.actualSource).toBe('summed over 2 worker runs');
  });

  it('says nobody estimated it rather than showing zero', () => {
    const line = moneyLine({ ...request, meta: {} }, [], []);

    expect(line.estimateCents).toBeNull();
    expect(line.estimateSource).toBe('nobody estimated this');
    expect(line.varianceCents).toBeNull();
  });

  it('flags a task rollup that disagrees with what the runs charged', () => {
    const report = assembleFeatureReport(input());

    expect(report.contradictions.find(c => c.includes('roll up'))).toBe('The tasks roll up $14.50 spent and the worker runs charged $6.20. One of the two is stale.');
  });
});

describe('the summary strip', () => {
  it('reads asked, shipped, elapsed, cost, decisions and attempts off the records', () => {
    const report = assembleFeatureReport(input({ workerRuns: [run(), run({ id: 502, attempt: 2, cents: 830 })] }));

    expect(report.summary.askedAt).toEqual(T('2026-09-01T09:00:00Z'));
    expect(report.summary.shippedAt).toEqual(T('2026-09-06T10:00:00Z'));
    expect(report.summary.elapsed).toBe('5d 1h');
    expect(report.summary.elapsedOpen).toBe(false);
    expect(report.summary.totalCents).toBe(1450);
    expect(report.summary.humanDecisions).toBe(2);
    expect(report.summary.attempts).toBe(2);
  });

  it('measures elapsed to now while nothing has shipped', () => {
    const report = assembleFeatureReport(input({ releases: [] }));

    expect(report.summary.elapsedOpen).toBe(true);
    expect(report.summary.elapsed).toBe('20d 3h');
  });
});

describe('the small parts', () => {
  it('formats a duration as the coarsest two units that are not zero', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(3_600_000 + 1_200_000)).toBe('1h 20m');
    expect(formatDuration(86_400_000 * 12 + 3_600_000 * 4)).toBe('12d 4h');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('reads a completed run\'s change off result and a failed one\'s off the heartbeat', () => {
    expect(runChange(run()).commitSha).toBe('abc1234');
    expect(runChange(run({ result: null, progress: { keptBranch: 'wip/x' } })).branch).toBe('wip/x');
    expect(runChange(run({ result: null, progress: {} })).prUrl).toBeNull();
  });
});
