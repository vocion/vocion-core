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
    // The outcome, not just the delivery (review, 2026-09-24).
    expectedResult: 'A room owner can hand their board a PDF of the room without a screenshot.',
    howWeCheck: 'Dogfood notes asking for a PDF stop; export count in PostHog over 14 days.',
    checkAfter: '2026-09-20T00:00:00Z',
    result: 'helped',
    resultNote: '14 exports in the first week; no new dogfood note asked for a PDF.',
    resultCheckedAt: '2026-09-21T09:00:00Z',
    told: { at: '2026-09-07T10:00:00Z', channel: 'dogfood', what: 'shipped in 1.4', status: 'sent' },
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
    plan: { planId: 'plan-31', approvedBy: 'Chris', approvedAt: '2026-09-02T18:00:00Z' },
  },
};

const plan: ReportObject = {
  id: 31,
  title: 'Render the PDF server side from the room model',
  status: 'approved',
  createdAt: T('2026-09-02T17:00:00Z'),
  meta: {
    requestId: 41,
    approach: 'Render server side from the room model, not from the DOM, so the PDF matches what the room holds rather than what a browser drew.',
    writtenBy: 'agent:task-planner',
    approvedBy: 'Chris',
    approvedAt: '2026-09-02T18:00:00Z',
    components: ['src/services/export: a renderer that takes the room model', 'src/features/rooms: one entry on the share menu'],
    interfaces: ['POST /rooms/:id/export returns a PDF stream'],
    dataImpact: 'No migration. The export reads the room model as it stands.',
    risks: ['A long room times out the request: cap it at 200 sections and say so'],
    alternatives: ['Print the DOM to PDF in the browser: rejected, it ships whatever the viewport happened to render'],
    verification: 'Export the fixture room and diff the section list against the room model.',
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
    plans: [plan],
    workerRuns: [run()],
    asks: [ask],
    actionRuns: [handoff],
    releases: [release],
    artifacts: [screenshot],
    now: NOW,
    ...over,
  };
}

describe('the plan stage', () => {
  const noPlan = (over: Partial<ReportObject['meta']> = {}) => ({ ...task, meta: { ...task.meta, plan: undefined, ...over } });

  it('comes after triage and before the contract, because a plan reviewed after the run is a record and not a gate', () => {
    const keys = assembleFeatureReport(input()).sections.map(s => s.key);

    expect(keys.indexOf('plan')).toBeGreaterThan(keys.indexOf('triage'));
    expect(keys.indexOf('plan')).toBe(keys.indexOf('contract') - 1);
  });

  it('leads with the steps a person approves and keeps the reasoning behind them', () => {
    const s = section(assembleFeatureReport(input()), 'plan');
    const entry = s.entries[0]!;

    expect(s.absence).toBeNull();
    expect(entry.title).toBe('Render the PDF server side from the room model');
    // What is being approved: the steps, and who approved it.
    expect(entry.steps?.length).toBeGreaterThan(0);
    expect(entry.facts.find(f => f.label === 'Approved by')?.value).toBe('Chris');
    // Four paragraphs of reasoning is a document, not a decision — it is one
    // tap away rather than in front of the person saying yes.
    expect(entry.facts.some(f => f.label === 'The approach, and why this one')).toBe(false);
    expect(entry.detailFacts?.find(f => f.label === 'The approach, and why this one')?.value).toContain('not from the DOM');
    expect(entry.detailFacts?.find(f => f.label === 'Data or migration impact')?.value).toContain('No migration');
    expect(entry.detailFacts?.find(f => f.label === 'How it will be verified')?.value).toContain('diff the section list');
    expect(s.detailLists.find(l => l.label === 'Interfaces added or altered')?.items).toContain('POST /rooms/:id/export returns a PDF stream');
    expect(s.detailLists.find(l => l.label === 'Considered and rejected, and why')?.items[0]).toContain('rejected');
  });

  it('says a plan was required and none exists, rather than drawing a blank stage', () => {
    const crossing = { ...task, meta: { ...task.meta, plan: undefined, riskClass: 'billing' } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [crossing] })), 'plan');

    expect(s.absence).toContain('A plan was required and none is on the record');
    expect(s.absence).toContain('the risk class is billing');
    expect(s.absence).toContain('The work ran anyway.');
    expect(s.facts.find(f => f.label === 'Was a plan required?')?.value).toBe('required, on 1 trigger');
  });

  it('says a plan was offered and nothing was recorded, which is not the same as declined', () => {
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [noPlan()] })), 'plan');

    expect(s.absence).toContain('A plan was offered for this work');
    expect(s.absence).toContain('nothing says it was declined');
  });

  it('says no plan was needed when the rule asked for none', () => {
    const docs = { ...task, meta: { ...task.meta, plan: undefined, riskClass: 'docs', allowedPaths: ['docs/EXPORT.md'] } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [docs] })), 'plan');

    expect(s.absence).toBe('No plan was needed for this work under the plan rule, and none was written.');
  });

  it('renders a skipped plan as "plan skipped: <reason>" and never as a blank', () => {
    const skipped = { ...task, meta: { ...task.meta, plan: { skipped: true, skipReason: 'one string on one page, the approach is the change' } } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [skipped] })), 'plan');

    expect(s.absence).toBeNull();
    expect(s.lists.find(l => l.label.startsWith('What each task recorded'))?.items)
      .toEqual(['Task 77: plan skipped: one string on one page, the approach is the change']);
    expect(s.flags).toEqual([]);
  });

  it('flags a skip with no reason, because a skip with no reason reads exactly like a step nobody took', () => {
    const skipped = { ...task, meta: { ...task.meta, plan: { skipped: true } } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [skipped] })), 'plan');

    expect(s.lists.find(l => l.label.startsWith('What each task recorded'))?.items)
      .toEqual(['Task 77: plan skipped: no reason was recorded']);
    expect(s.flags.join(' ')).toContain('cannot be told apart from a step nobody took');
  });

  it('flags a skip the rule did not allow', () => {
    const skipped = { ...task, meta: { ...task.meta, riskClass: 'schema', plan: { skipped: true, skipReason: 'it is small' } } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [skipped] })), 'plan');

    expect(s.flags.join(' ')).toContain('skipped the plan and the rule required one');
  });

  it('names why the plan was required, one line per trigger, in the rule\'s order', () => {
    const crossing = { ...task, meta: { ...task.meta, plan: undefined, riskClass: 'infra', allowedPaths: ['apps/web/src/**', 'packages/core/src/routes/**'] } };
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [crossing] })), 'plan');

    expect(s.lists.find(l => l.label === 'Why a plan was required')?.items).toEqual([
      'the risk class is infra, which is irreversible, trust bearing or an externally visible promise',
      'the allowed paths span 2 packages (apps/web, packages/core), so an architectural boundary is being crossed',
      'the allowed paths reach an HTTP route',
    ]);
  });

  it('shows the contradiction when work that needed a plan ran without one', () => {
    const crossing = { ...task, meta: { ...task.meta, plan: undefined, riskClass: 'auth' } };
    const report = assembleFeatureReport(input({ plans: [], tasks: [crossing] }));

    expect(report.contradictions.join(' ')).toContain('required a plan for this work and none is on the record');
  });

  it('shows the contradiction when the plan was approved after the work already ran', () => {
    const late = { ...plan, meta: { ...plan.meta, approvedAt: '2026-09-09T09:00:00Z' } };
    const report = assembleFeatureReport(input({ plans: [late] }));

    expect(report.contradictions.join(' ')).toContain('A plan approved after the work is a record, not a gate.');
  });

  it('puts the plan on the timeline, written then approved, and the skip too', () => {
    const report = assembleFeatureReport(input());

    expect(report.timeline.filter(t => t.kind === 'plan').map(t => t.key)).toEqual(['plan-written-31', 'plan-approved-31']);

    const skipped = { ...task, meta: { ...task.meta, plan: { skipped: true, skipReason: 'no design to make' } } };
    const withSkip = assembleFeatureReport(input({ plans: [], tasks: [skipped] }));

    expect(withSkip.timeline.find(t => t.kind === 'plan')?.title).toBe('Task 77: plan skipped: no design to make');
  });

  it('says what the rule could not check rather than guessing at it', () => {
    const s = section(assembleFeatureReport(input({ plans: [], tasks: [{ ...noPlan(), meta: { ...task.meta, plan: undefined, estimateCents: undefined } }] })), 'plan');

    expect(s.lists.find(l => l.label.startsWith('What the rule could not check'))?.items)
      .toEqual(['what the work was estimated at']);
  });
});

describe('the sections', () => {
  it('always renders every stage, in reading order, with what it looks like beside the triage that classified it', () => {
    const report = assembleFeatureReport(input());

    expect(report.sections.map(s => s.key)).toEqual([...REPORT_SECTION_KEYS]);
    expect(report.sections.map(s => s.key)).toEqual(['ask', 'triage', 'visuals', 'today', 'plan', 'contract', 'approvals', 'runs', 'change', 'qa', 'release', 'result', 'money']);
  });

  it('a complete feature has every stage present and none of them absent', () => {
    const report = assembleFeatureReport(input());

    // Visuals and today are the exceptions the fixture cannot satisfy: its
    // artifacts are QA evidence on a task, and both of those read artifacts
    // filed against the request. A feature with no mockup is a real state,
    // not a broken one.
    expect(report.sections.filter(s => s.absence !== null && s.key !== 'visuals' && s.key !== 'today')).toEqual([]);
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
    const report = assembleFeatureReport(input({ tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] }));

    expect(section(report, 'contract').absence).toBe('No task contract was written for this request; nothing was dispatched.');
    expect(section(report, 'runs').absence).toBe('Nothing has been built yet — no worker run is recorded against this work.');
    expect(section(report, 'change').absence).toBe('No pull request is recorded for this work.');
    expect(section(report, 'release').absence).toBe('Not released. Nothing has carried this work to people yet.');
  });

  it('a task with no release says no release carries it, and does not infer one from the merged PR', () => {
    const report = assembleFeatureReport(input({ releases: [] }));

    expect(section(report, 'release').absence).toBe('Not released. Nothing has carried this work to people yet.');
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
      // The kind rides along so a gallery can draw a picture as a picture —
      // and so does the picture itself, because a tile naming the type is not
      // evidence of anything.
      kind: 'file',
      imageUrl: 'https://files.example/qa/share-menu.png',
      body: null,
      role: 'qa-screenshot',
      title: 'Share menu, PDF offered',
      caption: 'The share menu with the new PDF entry.',
      url: 'https://files.example/qa/share-menu.png',
      at: T('2026-09-05T08:00:00Z'),
    }]);
  });

  it('says plainly that none was captured rather than hiding the section', () => {
    const qa = section(assembleFeatureReport(input({ artifacts: [] })), 'qa');

    expect(qa.absence).toBe('Not ready for review — nobody has looked at this running yet.');
    // It names what a person owes, not what the column is called: the old
    // line printed the artifact's recordRole enum at a reader.
    expect(qa.checks.map(c => c.name)).toContain('A shot of it working, on a phone');
    expect(qa.checks.every(c => c.passed === null)).toBe(true);
  });

  it('ignores an artifact on the task that is not QA evidence', () => {
    const brief: ReportArtifact = { ...screenshot, id: 701, recordRole: 'brief', spec: {} };
    const qa = section(assembleFeatureReport(input({ artifacts: [brief] })), 'qa');

    expect(qa.absence).toBe('Not ready for review — nobody has looked at this running yet.');
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
      'plan',
      'plan',
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

    // One line in front: what it cost, against what it was expected to cost.
    // The variance is part of the workings, one tap down.
    const cost = section(report, 'money');

    expect(cost.facts).toHaveLength(1);
    expect(cost.facts[0]!.value).toBe('$14.50 · estimated $9.00');
    expect(cost.detailLists[0]!.items.join(' ')).toContain('Variance: +$5.50 (+61%)');
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

describe('a zero is a claim', () => {
  it('will not count attempts or decisions out of an empty join, and says the history is incomplete', () => {
    // The shape Chris met: tasks written, a plan on the record, and not one
    // worker run linked — which rendered as a confident "0 attempts" beside a
    // real cost, on a page listing five of them.
    const report = assembleFeatureReport(input({ workerRuns: [], asks: [], actionRuns: [] }));

    expect(report.summary.attempts).toBeNull();
    expect(report.summary.humanDecisions).toBeNull();
    expect(report.contradictions.join(' ')).toMatch(/Execution history is incomplete/);
  });

  it('still counts a real zero when nothing was ever written to run', () => {
    const report = assembleFeatureReport(input({ tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] }));

    expect(report.summary.attempts).toBe(0);
    expect(report.summary.humanDecisions).toBe(0);
  });
});

describe('the goal, as a subtitle', () => {
  const withBody = (body: string) => {
    const base = input({});
    return assembleFeatureReport({ ...base, request: { ...base.request, meta: { ...base.request.meta, body } } });
  };

  it('takes the first sentence, so a body full of criteria does not become the subtitle', () => {
    const report = withBody('Launch the product as Stamp at stampsend.com without breaking existing links. 1. Every screen shows Stamp. 2. Old URLs redirect.');

    expect(report.goal).toBe('Launch the product as Stamp at stampsend.com without breaking existing links.');
  });

  it('reads the outcome first, the line every surface leads with (2026-09-25)', () => {
    const base = input({});
    const report = assembleFeatureReport({ ...base, request: { ...base.request, meta: { ...base.request.meta, body: 'The document page offers only Copy link.', outcome: 'Send a link by email and use the phone share sheet.' } } });

    expect(report.goal).toBe('Send a link by email and use the phone share sheet.');
  });

  it('does not end a sentence inside a domain name', () => {
    expect(withBody('Serve it at stampsend.com from Monday.').goal).toBe('Serve it at stampsend.com from Monday.');
  });

  it('caps a single enormous sentence rather than printing it whole', () => {
    const long = `Do ${'a very long clause '.repeat(20)}thing.`;
    const goal = withBody(long).goal!;

    expect(goal.length).toBeLessThanOrEqual(180);
    expect(goal.endsWith('…')).toBe(true);
  });

  it('cuts a capped sentence at a word, not mid-word', () => {
    // A hard slice ended the only sentence under the outcome mid-word —
    // "…and keep a record that it we…" — which reads as a rendering fault
    // rather than as an abbreviation.
    // A 9-character cycle, so the 179th character lands INSIDE a word rather
    // than on a space — which is the only case the cut has to get right, and
    // the case a prettier-looking fixture silently misses.
    const long = `Do ${'abcdefgh '.repeat(40)}end.`;
    const goal = withBody(long).goal!;

    expect(goal.length).toBeLessThanOrEqual(180);
    expect(goal.endsWith('…')).toBe(true);

    // What was kept is a whole-word prefix of the body: the source continues
    // with a space, so no word was cut through.
    const kept = goal.slice(0, -1);
    const oneLine = long.replace(/\s+/g, ' ');

    expect(oneLine.startsWith(kept)).toBe(true);
    expect(oneLine.charAt(kept.length)).toBe(' ');
  });

  it('still cuts hard when the sentence has no space to cut at', () => {
    const goal = withBody(`${'z'.repeat(400)}.`).goal!;

    expect(goal.length).toBeLessThanOrEqual(180);
    expect(goal.endsWith('…')).toBe(true);
  });

  it('is null when nobody wrote one', () => {
    expect(withBody('   ').goal).toBeNull();
  });
});

describe('not started is a claim too', () => {
  const withRollup = (taskCount: number) => {
    const base = input({ tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] });
    return assembleFeatureReport({ ...base, request: { ...base.request, meta: { ...base.request.meta, taskCount } } });
  };

  it('refuses to say "not started" when the record says work was written and none is linked', () => {
    const report = withRollup(5);

    expect(report.state.label).toBe('Unreadable');
    expect(report.state.question).toMatch(/5 tasks were written/);
    expect(report.contradictions.join(' ')).toMatch(/not one is linked/);
  });

  it('still says not started when nothing was ever written', () => {
    expect(withRollup(0).state.label).toBe('Not started');
  });
});

describe('the story, and the machinery behind it', () => {
  it('puts the ask, triage, contracts and approvals one level down, and keeps the rest in the story', () => {
    const report = assembleFeatureReport(input({}));
    const detail = report.sections.filter(s => s.group === 'detail').map(s => s.key);
    const story = report.sections.filter(s => s.group === 'story').map(s => s.key);

    expect(detail).toEqual(['ask', 'triage', 'contract', 'approvals']);
    // Nothing is dropped: every section still belongs to exactly one half.
    expect([...story, ...detail].sort()).toEqual([...report.sections.map(s => s.key)].sort());
    expect(story).toContain('plan');
    expect(story).toContain('qa');
    expect(story).toContain('release');
  });
});

describe('done when', () => {
  it('reads the contract off the work, counts what holds, and keeps unchecked separate from failed', () => {
    const req = {
      ...input({}).request,
      meta: {
        ...input({}).request.meta,
        acceptanceFrozenAt: '2026-09-20T09:00:00.000Z',
        acceptance: [
          { statement: 'Every screen shows Stamp', met: true, evidenceUrl: '/runs/1' },
          { statement: 'Old links still resolve', met: false },
          { statement: 'Emails name the product' },
        ],
      },
    };
    const report = assembleFeatureReport({ ...input({}), request: req });

    expect(report.acceptance.total).toBe(3);
    expect(report.acceptance.met).toBe(1);
    expect(report.acceptance.items[2]!.met).toBeNull();
    expect(report.acceptance.frozenAt).not.toBeNull();
  });

  it('is empty, not invented, when nobody wrote a contract', () => {
    const report = assembleFeatureReport(input({}));

    expect(report.acceptance.total).toBe(0);
    expect(report.acceptance.items).toEqual([]);
  });
});

describe('what this piece of work cost', () => {
  const req = (meta: Record<string, unknown>) => ({ ...input({}).request, meta: { ...input({}).request.meta, ...meta } });
  const task = (estimate: number) => ({ id: 1, title: 't', status: 'accepted', meta: { estimateCents: estimate }, createdAt: new Date() }) as never;

  it('will not compare against a sum of attempt contracts', () => {
    // Five attempts at one rename summed to $85 and read as a 72% saving
    // against $24.12 actually spent. The sum is reported; nothing divides by it.
    const line = moneyLine(req({ estimateCents: null }), [task(1700), task(1700), task(1700), task(1700), task(1700)], []);

    expect(line.estimateCents).toBe(8500);
    expect(line.varianceCents).toBeNull();
    expect(line.variancePct).toBeNull();
    expect(line.estimateSource).toContain('not an estimate of this work');
  });

  it('compares against the work\'s own estimate when one was written before it started', () => {
    const line = moneyLine(req({ estimateCents: 2000, actualCents: 2412 }), [task(1700), task(1700)], []);

    expect(line.estimateCents).toBe(2000);
    expect(line.varianceCents).toBe(412);
    expect(line.estimateSource).toContain('before it started');
  });

  it('compares against a single contract, because one contract is the work', () => {
    const line = moneyLine(req({ estimateCents: null, actualCents: 1500 }), [task(1700)], []);

    expect(line.varianceCents).toBe(-200);
  });
});

describe('the goal, when the body opens with a label', () => {
  const withBody = (body: string) => {
    const base = input({});
    return assembleFeatureReport({ ...base, request: { ...base.request, meta: { ...base.request.meta, body } } });
  };

  it('says nothing rather than printing a label with a stray numeral', () => {
    // The real body on the Stamp rename. Its first full stop is inside "1.",
    // so the sentence rule kept it and the subtitle read
    // "Acceptance criteria — each one a person can check: 1."
    const report = withBody('Acceptance criteria — each one a person can check: 1. Every screen shows Stamp. 2. Old links resolve.');

    expect(report.goal).toBeNull();
  });

  it('still takes a real opening sentence', () => {
    expect(withBody('Launch as Stamp without breaking links. 1. Every screen shows Stamp.').goal)
      .toBe('Launch as Stamp without breaking links.');
  });
});

describe('build reads as a story', () => {
  const run = (id: number, at: string) => ({ id, kind: 'worker', status: 'completed', attempt: null, agentSlug: 'eng', model: 'm', cents: 10, createdAt: new Date(at), claimedAt: new Date(at), completedAt: new Date(at), summary: null, error: null, meta: {} }) as never;

  it('leads with the latest attempt and names the rest as superseded', () => {
    // Five equal rows in the order they happened put the attempt that decided
    // the work at the bottom, under four already superseded.
    const report = assembleFeatureReport(input({ workerRuns: [run(1, '2026-09-20T10:00:00Z'), run(2, '2026-09-20T11:00:00Z'), run(3, '2026-09-20T12:00:00Z')] }));
    const build = report.sections.find(x => x.key === 'runs')!;

    expect(build.title).toBe('Build');
    expect(build.entries[0]!.title).toContain('Latest attempt');
    expect(build.entries[0]!.title).toContain('run 3');
    expect(build.entries[1]!.title).toContain('superseded');
    expect(build.entries).toHaveLength(3);
  });

  it('does not call a single run an attempt among others', () => {
    const report = assembleFeatureReport(input({ workerRuns: [run(7, '2026-09-20T10:00:00Z')] }));
    const build = report.sections.find(x => x.key === 'runs')!;

    expect(build.entries[0]!.title).toBe('Latest attempt · run 7');
  });
});

describe('what it looks like', () => {
  const art = (id: number, title: string) => ({ id, kind: 'markdown', title, recordType: 'object', recordId: '7', recordRole: 'proposal-visual', spec: {}, url: null, createdAt: new Date('2026-09-22T10:00:00Z') }) as never;
  const req = (meta: Record<string, unknown>) => {
    const base = input({});
    return { ...base, request: { ...base.request, id: 7, meta: { ...base.request.meta, ...meta } } };
  };
  const visuals = (r: ReturnType<typeof req>) => assembleFeatureReport(r).sections.find(s => s.key === 'visuals')!;

  it('draws a mockup filed against the request, which nothing on this page used to do', () => {
    const s = visuals({ ...req({ surface: 'ui', visuals: { beforeArtifactIds: [91] } }), artifacts: [art(91, 'Proposed flow')] } as never);

    expect(s.evidence.map(e => e.title)).toEqual(['Proposed flow']);
    expect(s.evidence[0]!.url).toBe('/dashboard/artifacts/91');
    expect(s.absence).toBeNull();
  });

  it('says a decision is being made against a sentence when a visible change has no mockup', () => {
    expect(visuals(req({ surface: 'ui', state: 'triaged' })).absence).toMatch(/approving this is approving a sentence/);
  });

  it('asks for the after-shot once the work says it is done', () => {
    expect(visuals(req({ surface: 'flow', state: 'shipped' })).absence).toMatch(/not finished until somebody has looked at it/);
  });

  it('owes nothing when the work changes nothing a person looks at', () => {
    expect(visuals(req({ surface: 'infra', state: 'shipped' })).absence).toMatch(/No visual is owed/);
  });

  it('takes a written reason instead of a picture, because a recorded way out is not a silent skip', () => {
    expect(visuals(req({ surface: 'ui', state: 'shipped', visuals: { noVisualReason: 'Text-only change.' } })).absence).toMatch(/on purpose: Text-only change/);
  });

  it('flags work that was proposed with a visual and closed without one', () => {
    const s = visuals({ ...req({ surface: 'ui', state: 'shipped', visuals: { beforeArtifactIds: [91] } }), artifacts: [art(91, 'Proposed flow')] } as never);

    expect(s.flags.join(' ')).toMatch(/What was agreed can be seen; what shipped cannot/);
  });
});

describe('the plan speaking for itself', () => {
  const planned = (meta: Record<string, unknown>) => {
    const base = input({ tasks: [] });
    const plan = { id: 9, title: 'A plan', status: 'proposed', createdAt: new Date('2026-09-22T10:00:00Z'), meta: { requestId: base.request.id, ...meta } } as never;
    return assembleFeatureReport({ ...base, plans: [plan] }).sections.find(s => s.key === 'plan')!;
  };

  it('answers the rule question from the plan when no task has been contracted yet', () => {
    // The rule reads allowed paths and estimates off the TASKS, and before a
    // plan is approved there are none — so the page printed "not recorded"
    // directly above a plan that says why it was required.
    const s = planned({ ruleLevel: 'required', ruleTriggers: ['the estimate is $22, over the $10 threshold'] });

    expect(s.facts.find(f => f.label === 'Was a plan required?')?.value).toMatch(/^Yes —/);
    expect(s.lists.find(l => l.label === 'Why the plan says it was required')?.items).toEqual(['the estimate is $22, over the $10 threshold']);
  });

  it('says nothing rather than guessing when the plan recorded no level', () => {
    expect(planned({}).facts.find(f => f.label === 'Was a plan required?')?.value).toBeNull();
  });
});

describe('one decision at a time', () => {
  it('is proposed while nothing has been contracted, and the lifecycle says where it is', () => {
    const r = assembleFeatureReport(input({ tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] }));

    // The fixture's request is `shipped` on the record with nothing carrying
    // it; with no plan or task written, the records say "decided" at most.
    expect(['asked', 'decided']).toContain(r.phase);
    expect(r.lifecycle.map(l => l.label)).toEqual(['Asked', 'Decided', 'Planned', 'Building', 'QA', 'Released']);
    expect(r.lifecycle.filter(l => l.state === 'now')).toHaveLength(1);
  });

  it('moves to building once there is work to watch', () => {
    const r = assembleFeatureReport(input({ releases: [], artifacts: [] }));

    expect(r.phase).toBe('qa');
    expect(r.lifecycle.find(l => l.label === 'Building')?.state).toBe('done');
  });

  it('is released once something carried it to people', () => {
    expect(assembleFeatureReport(input()).phase).toBe('released');
  });
});

describe('a date is not a list marker', () => {
  const goalOf = (body: string) => {
    const base = input({});
    return assembleFeatureReport({ ...base, request: { ...base.request, meta: { ...base.request.meta, summary: undefined, body } } }).goal;
  };

  it('keeps a date that ends the first sentence', () => {
    // This rendered as "Correction, 2026-09-" under the title.
    expect(goalOf('Correction, 2026-09-23. This was filed twice on a wrong premise.')).toBe('Correction, 2026-09-23.');
  });

  it('still drops a real list marker', () => {
    expect(goalOf('Acceptance criteria, each checkable: 1. Every screen shows Stamp.')).toBeNull();
  });
});

describe('which work this is', () => {
  it('names the product, the size, the spend and the age — and only what is recorded', () => {
    const r = assembleFeatureReport(input({}));

    expect(r.context.some(b => b.endsWith('change'))).toBe(true);
    expect(r.context.some(b => b.includes('spent'))).toBe(true);
    expect(r.context.every(b => !b.includes('not recorded'))).toBe(true);
  });

  it('drops what is not recorded rather than padding the line with it', () => {
    const base = input({ tasks: [], plans: [], workerRuns: [], asks: [], actionRuns: [], releases: [], artifacts: [] });
    const r = assembleFeatureReport({ ...base, request: { ...base.request, meta: {} } });

    // No product, no size, nothing spent. When the row was created is still a
    // real fact, so it is the only thing the line carries.
    expect(r.context).toHaveLength(1);
    expect(r.context[0]).toMatch(/^asked /);
  });
});
