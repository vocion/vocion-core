import type { FeatureReportInput, ReportActionRun, ReportArtifact, ReportAsk, ReportObject, ReportSectionKey, ReportWorkerRun } from './featureReport';
import { describe, expect, it } from 'vitest';
import { recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
import { assembleFeatureReport, executedRun, formatDuration, mockupStatusOf, moneyLine, personName, planStatusOf, qaEvidenceRole, REPORT_SECTION_KEYS, runChange, taskStatus } from './featureReport';

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
    // In plain words, with the reason — not the rule's "required, on 1 trigger" (2026-09-28).
    expect(s.facts.find(f => f.label === 'Was a plan required?')?.value).toMatch(/^Yes — the risk class is billing/);
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

    expect(section(report, 'contract').absence).toBe('No task was written for this feature; nothing was dispatched.');
    expect(section(report, 'runs').absence).toBe('Nothing has been built yet — no run is recorded against this work.');
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

    expect(section(report, 'triage').absence).toBe('No one triaged this feature; it is still in `new`.');
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
      // Its section and who made it: filed two days after the run ended, it
      // names no run, so none is claimed for it.
      section: 'QA after',
      source: { text: 'QA · after · Sep 5', ref: { type: 'artifact', id: '700' } },
    }]);
  });

  it('names the run a capture came from, and its side', () => {
    const during: ReportArtifact = { ...screenshot, id: 702, title: 'Share menu · desktop · before', createdAt: T('2026-09-03T11:00:00Z') };
    const qa = section(assembleFeatureReport(input({ artifacts: [during] })), 'qa');

    expect(qa.evidence[0]).toMatchObject({ section: 'QA before', source: { text: 'QA · run 501 · before · Sep 3', ref: { type: 'worker_run', id: '501' } } });
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
  it('links the release to its release page where the workspace declares one, the generic record where not', () => {
    const link = recordLinker(recordLinksOf([{ slug: 'releases', archetype: 'list', source: { kind: 'objects', objectType: 'release' }, recordPage: { kind: 'release', actions: {} } }] as never, 'northwind'));
    const linked = assembleFeatureReport(input({ link }));

    expect(linked.timeline.find(e => e.key === 'release-9')!.href).toBe('/w/northwind/dashboard/p/releases/9');
    expect(linked.timeline.find(e => e.key === 'contract-77')!.href).toBe('/w/northwind/dashboard/objects/77');
    expect(assembleFeatureReport(input()).timeline.find(e => e.key === 'release-9')!.href).toBe('/dashboard/objects/9');
  });

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
    expect(line.actualSource).toBe('summed over 2 runs');
  });

  it('says Not estimated rather than showing zero, and computes no variance against nothing', () => {
    const line = moneyLine({ ...request, meta: {} }, [], []);

    expect(line.estimateCents).toBeNull();
    expect(line.estimateSource).toBe('Not estimated');
    expect(line.varianceCents).toBeNull();
  });

  it('reads Not estimated with no variance on the page, and a real estimate gets one', () => {
    const noEstimate = { ...task, meta: { ...task.meta, estimateCents: undefined } };
    const bare = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, estimateCents: undefined } }, tasks: [noEstimate] }));

    expect(bare.implementation.costLine).toBe('$14.50 spent · Not estimated');
    expect(section(bare, 'money').detailLists[0]!.items.join(' ')).not.toContain('Variance');

    expect(assembleFeatureReport(input()).implementation.costLine).toBe('$14.50 spent · estimated $9.00, +$5.50 (+61%)');
  });

  it('flags a task rollup that disagrees with what the runs charged', () => {
    const report = assembleFeatureReport(input());

    expect(report.contradictions.find(c => c.includes('roll up'))).toBe('The tasks roll up $14.50 spent and the runs charged $6.20. One of the two is stale.');
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
    // run linked — which rendered as a confident "0 attempts" beside a
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

  it('is empty, not invented, when neither the work nor a task wrote a contract', () => {
    const bare = { ...task, meta: { ...task.meta, acceptanceContract: [] } };
    const report = assembleFeatureReport(input({ tasks: [bare] }));

    expect(report.acceptance.total).toBe(0);
    expect(report.acceptance.items).toEqual([]);
    expect(report.acceptance.source).toBeNull();
  });

  it('reads the task\'s contract when the work carries none, every criterion Unverified (2026-09-28)', () => {
    const report = assembleFeatureReport(input({}));

    expect(report.acceptance.source).toBe('task');
    expect(report.acceptance.items.map(i => [i.statement, i.state])).toEqual([
      ['The share menu offers PDF', 'unverified'],
      ['The PDF carries every section in order', 'unverified'],
    ]);
    // The plan's own verification is the review procedure.
    expect(report.acceptance.procedure).toMatch(/^Export the fixture room/);
  });

  it('shows no pass without evidence: met with nothing to open is Unverified, met: false is Failed', () => {
    const req = { ...request, meta: { ...request.meta, acceptance: [
      { statement: 'Backed', met: true, evidenceUrl: '/dashboard/artifacts/700' },
      { statement: 'Claimed', met: true },
      { statement: 'Broken', met: false },
      { statement: 'Unchecked' },
    ] } };
    const a = assembleFeatureReport(input({ request: req })).acceptance;

    expect(a.items.map(i => i.state)).toEqual(['passed', 'unverified', 'failed', 'unverified']);
    expect(a.verified).toBe(1);
    expect(a.items[1]!.note).toBe('Marked met, with no evidence attached.');
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
    expect(build.entries[0]!.title).toContain('Run #3');
    expect(build.entries[1]!.title).toContain('superseded');
    expect(build.entries).toHaveLength(3);
  });

  it('does not call a single run an attempt among others', () => {
    const report = assembleFeatureReport(input({ workerRuns: [run(7, '2026-09-20T10:00:00Z')] }));
    const build = report.sections.find(x => x.key === 'runs')!;

    expect(build.entries[0]!.title).toBe('Latest attempt · Run #7');
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

  it('reads the proposal off mockupArtifactIds, and the screenshot it was drawn on as the screen today', () => {
    const shot = { id: 81, kind: 'link', title: 'Files · desktop · before', recordType: 'object', recordId: '12', recordRole: 'qa-screenshot', spec: {}, url: '/api/artifacts/o-a/o-a.png', createdAt: new Date('2026-09-21T10:00:00Z') } as never;
    const mock = (id: number, title: string) => ({ id, kind: 'file', title, recordType: 'object', recordId: '7', recordRole: `mockup:${id}`, spec: { contentType: 'image/png' }, url: `/api/artifacts/o-${id}/o-${id}.png`, createdAt: new Date('2026-09-22T10:00:00Z') }) as never;
    const r = { ...req({ surface: 'ui', visuals: { beforeArtifactIds: [81], mockupArtifactIds: [92, 93] } }), artifacts: [shot, mock(92, 'Files · Default'), mock(93, 'Files · Link copied')] } as never;
    const report = assembleFeatureReport(r);
    const preview = report.sections.find(x => x.key === 'visuals')!;
    const today = report.sections.find(x => x.key === 'today')!;

    expect(preview.evidence.map(e => [e.id, e.role, e.imageUrl])).toEqual([[92, 'proposed', '/api/artifacts/o-92/o-92.png'], [93, 'proposed', '/api/artifacts/o-93/o-93.png']]);
    expect(today.evidence.map(e => [e.id, e.role])).toEqual([[81, 'today']]);
    // Every picture carries its section and who made it (2026-09-30).
    expect(preview.evidence.map(e => e.section)).toEqual(['Mockup', 'Mockup']);
    expect(today.evidence[0]).toMatchObject({ section: 'Today', source: { text: 'QA · Sep 21' } });
  });

  it('captions a mockup with the line written when it was drawn, and says who drew it from what', () => {
    const drawnMock = { id: 95, kind: 'file', title: 'Mockup: Remind a reader · Default', recordType: 'object', recordId: '7', recordRole: 'mockup', author: 'Designer', spec: { contentType: 'image/png', url: '/api/artifacts/o-95/o-95.png', caption: 'Remind a person who has not opened it', source: { state: 'Default', html: '<div></div>' }, provenance: { drawnFrom: 'request', missionRunId: 5120 } }, url: null, createdAt: new Date('2026-09-25T10:00:00Z') } as never;
    const s = visuals({ ...req({ surface: 'ui', visuals: { mockupArtifactIds: [95] } }), artifacts: [drawnMock] } as never);

    expect(s.evidence[0]).toMatchObject({ caption: 'Remind a person who has not opened it', section: 'Mockup', source: { text: 'Designer · drawn from the request · Sep 25', ref: { type: 'mission_run', id: '5120' } } });
  });

  it('says where the default mockup stands while it is not there', () => {
    const at = '2026-09-30T11:50:00Z';
    const now = new Date('2026-09-30T12:00:00Z');

    expect(mockupStatusOf({ id: 7, title: 't', status: null, createdAt: null, meta: { visuals: { mockupDraw: { state: 'drawing', attempt: 1, at } } } }, now)).toEqual({ line: 'The mockup is being drawn — started 10 min ago.', tone: 'info' });
    expect(mockupStatusOf({ id: 7, title: 't', status: null, createdAt: null, meta: { visuals: { mockupDraw: { state: 'failed', attempt: 2, at, reason: 'the renderer is not available' } } } }, now)?.line).toBe('The mockup was not drawn after 2 attempts (30 Sep 2026, 11:50 UTC): the renderer is not available. Asking for a mockup in chat draws it again.');
    expect(mockupStatusOf({ id: 7, title: 't', status: null, createdAt: null, meta: { visuals: { mockupArtifactIds: [3], mockupDraw: { state: 'drawing', attempt: 1, at } } } }, now)).toBeNull();
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

describe('a task QA sent back', () => {
  const sentBack = { ...task, status: 'changes_requested', meta: { ...task.meta, status: 'changes_requested', verdict: { value: 'changes', proven: 0, total: 8, note: 'One screenshot cannot show five states.' } } };

  // The count is the request's own two lines judged on this attempt (`featureProof`),
  // the figure the acceptance section shows, not the verdict's stored 0 of 8.
  it('reads as Changes asked, with the count and the sentence, and offers Build again', () => {
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building' } }, tasks: [sentBack], releases: [], asks: [], actionRuns: [], workerRuns: [run({ status: 'completed' })] }));

    expect(r.state).toMatchObject({ key: 'changes', label: 'Changes asked', needsYou: true, detail: 'QA proved 0 of 2: One screenshot cannot show five states.', action: { label: 'Build again' } });
    expect(r.canBuild).toBe(true);
  });

  it('reads as QA could not finish when QA ended without a verdict, and offers Build again', () => {
    const failed = { ...task, status: 'review_failed', meta: { ...task.meta, status: 'review_failed', reviewFailure: { at: '2026-09-27T16:50:00Z' } } };
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building' } }, tasks: [failed], releases: [], asks: [], actionRuns: [], workerRuns: [run({ status: 'completed' })] }));

    expect(r.state).toMatchObject({ key: 'stuck', label: 'QA could not finish', needsYou: true, detail: 'QA ended without a verdict; Build again starts a fresh attempt', action: { label: 'Build again' } });
    expect(r.canBuild).toBe(true);
  });

  it('reads Engineering stopped with the run\'s reason when the newest run failed, and offers Build even if a stale copy says dispatched (#126 attempt 194)', () => {
    const stopped = { ...task, status: 'rejected', meta: { ...task.meta, status: 'dispatched' } };
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building' } }, tasks: [stopped], releases: [], asks: [], actionRuns: [], workerRuns: [run({ status: 'failed', error: 'verification failed: Claude produced no changes in the working tree (checks on the base: typecheck=passed)' })] }));

    expect(r.state).toMatchObject({ key: 'stuck', label: 'Engineering stopped', needsYou: false, detail: 'the last run failed: Claude produced no changes in the working tree (checks on the base: typecheck=passed); next, the factory sends it again if the contract has changed since, and asks you if it has not — or Build again starts a fresh attempt now', action: { label: 'Build again' } });
    expect(r.canBuild).toBe(true);
  });

  it('says a refusal as a sentence with what happens next, never the label twice or the raw refusal (#201, 2026-09-28)', () => {
    const stopped = { ...task, status: 'rejected', meta: { ...task.meta, status: 'dispatched' } };
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building' } }, tasks: [stopped], releases: [], asks: [], actionRuns: [], workerRuns: [run({ status: 'failed', error: 'contract refused: 1 problem: plan is required: allowed_paths spans 2 packages (apps/web, packages/core), over the 1 the rule allows without a plan.. Nothing was cloned.' })] }));

    expect(r.status.headline).toBe('Engineering stopped');
    expect(r.status.sentence).toBe('The last run failed: the change needs a plan first: the change spans 2 packages (apps/web, packages/core); next, the factory writes the plan first, and the build starts once it is approved — or Build again starts a fresh attempt now. Nothing from this attempt has merged.');
    expect(r.status.sentence).not.toMatch(/Engineering stopped|contract refused|\.\./);
  });

  it('says what the factory is doing about it: planning, recovering, stopped (backlog 038)', () => {
    const at = '2026-09-28T12:00:00.000Z';
    const stopped = { ...task, status: 'rejected', meta: { ...task.meta, status: 'dispatched' } };
    const failed = run({ status: 'failed', error: 'verification failed: required checks failed: test' });
    const planning = { stage: 'planning', line: 'Planning — the allowed paths span 2 packages (apps/web, packages/core)', attempts: [{ n: 1, kind: 'plan', trigger: 'recovery', line: 'x', at, runId: null, taskId: null, failure: null }], log: [{ at, text: 'Recovered: planning first because the allowed paths span 2 packages', runId: 12 }] };
    const planned = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building', recovery: planning } }, tasks: [stopped], releases: [], asks: [], actionRuns: [], workerRuns: [failed] }));

    expect(planned.state).toMatchObject({ key: 'planning', label: 'Planning', detail: 'the allowed paths span 2 packages (apps/web, packages/core)', needsYou: false });
    expect(planned.status.sentence).toBe('A plan comes first because the allowed paths span 2 packages (apps/web, packages/core). The build starts on its own once the plan is approved.');
    expect(planned.timeline.some(e => e.title === 'Recovered: planning first because the allowed paths span 2 packages' && e.href === '/dashboard/p/runs/12')).toBe(true);

    const recovering = { ...planning, stage: 'recovering', line: 'Recovering (attempt 2 of 3): the required checks failed (test)', attempts: [...planning.attempts, { ...planning.attempts[0], n: 2, kind: 'build' }, { ...planning.attempts[0], n: 3, kind: 'build' }] };
    const live = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building', recovery: recovering } }, tasks: [stopped], releases: [], asks: [], actionRuns: [], workerRuns: [failed, run({ id: 999, status: 'running' })] }));

    expect(live.state).toMatchObject({ key: 'recovering', label: 'Recovering (attempt 2 of 3)', detail: 'the required checks failed (test)' });
    expect(live.status.sentence).toMatch(/^The required checks failed \(test\)\./);
    expect(live.status.sentence).not.toContain('Recovering (attempt');

    const halted = { ...recovering, stage: 'stopped', line: 'Stopped after 3 attempts: the required checks failed (test). What would unblock it: read the failing check.' };
    const done = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building', recovery: halted } }, tasks: [stopped], releases: [], asks: [], actionRuns: [], workerRuns: [failed] }));

    expect(done.state).toMatchObject({ key: 'stuck', label: 'Stopped after 3 attempts', needsYou: true });
    expect(done.status.headline).toBe('Stopped after 3 attempts');
    expect(done.status.sentence).toBe('The required checks failed (test). What would unblock it: read the failing check. A person decides what happens next; nothing from these attempts has merged.');
  });

  it('reads the record\'s status column first, the metadata copy only under a generic lifecycle value', () => {
    const accepted = { ...task, status: 'active', meta: { ...task.meta, status: 'accepted' } };
    const columnWins = { ...task, status: 'awaiting_review', meta: { ...task.meta, status: 'accepted' } };

    expect(taskStatus(columnWins)).toBe('awaiting_review');

    expect(assembleFeatureReport(input({ tasks: [accepted], releases: [], asks: [], actionRuns: [], workerRuns: [run({ status: 'completed' })] })).state.key).toBe('merge');
  });
});

// ---------------------------------------------------------------------------
// The overview the page leads with (Chris, 2026-09-28)
// ---------------------------------------------------------------------------

const proposal = (over: Partial<FeatureReportInput> = {}) => assembleFeatureReport(input({
  request: { ...request, meta: { ...request.meta, state: 'in_scope', estimateCents: undefined } },
  tasks: [],
  plans: [],
  workerRuns: [],
  asks: [],
  actionRuns: [],
  releases: [],
  artifacts: [],
  ...over,
}));

describe('the status sentence and its one action', () => {
  it('offers Build it, and Dismiss beside it, on a proposal nothing has started', () => {
    const r = proposal();

    expect(r.status).toMatchObject({ headline: 'Proposed', action: { kind: 'build', label: 'Build it' }, secondary: { kind: 'dismiss' } });
    expect(r.canBuild).toBe(true);
    expect(r.canDismiss).toBe(true);
  });

  it('says Approve build when a plan is waiting for approval, and that building approves it', () => {
    const waiting = { ...plan, status: 'candidate', meta: { ...plan.meta, approvedAt: undefined, approvedBy: undefined } };
    const r = proposal({ plans: [waiting] });

    expect(r.status.action).toEqual({ kind: 'build', label: 'Approve build' });
    expect(r.status.sentence).toContain('Building it approves the plan.');
  });

  it('never offers Build while a run is live: the state names that run as its row, and the row is the move', () => {
    const dispatched = { ...task, status: 'running', meta: { ...task.meta, status: 'running' } };
    const r = proposal({ tasks: [dispatched], workerRuns: [run({ status: 'running', completedAt: null, result: null })] });

    expect(r.canBuild).toBe(false);
    // Chris, 2026-09-29: "is that 'current state'?" — one line, and the run as a row.
    expect(r.status.action).toBeNull();
    expect(r.status.activeRun).toMatchObject({ of: 1, attempt: { live: true, n: 1, outcome: 'Running' } });
    expect(r.status.sentence).toMatch(/not established until it finishes/);
  });

  it('never offers Build over a live run even when the task record still reads ready', () => {
    const ready = { ...task, status: 'ready', meta: { ...task.meta, status: 'ready' } };
    const r = proposal({ tasks: [ready], workerRuns: [run({ status: 'claimed', completedAt: null, result: null })] });

    expect(r.canBuild).toBe(false);
    expect(r.status.action?.kind).not.toBe('build');
  });

  it('numbers each attempt oldest first, and a settled state names no active run', () => {
    const r = proposal({ tasks: [task], workerRuns: [run({ id: 401, status: 'failed', error: 'refused' }), run({ id: 419, status: 'failed', error: 'Claude produced no changes' })] });

    expect(r.implementation.attempts.map(a => [a.runId, a.n, a.live])).toEqual([[419, 2, false], [401, 1, false]]);
    expect(r.status.activeRun).toBeNull();
  });

  it('offers Build again, never Dismiss, once work has started', () => {
    const stopped = { ...task, status: 'rejected', meta: { ...task.meta, status: 'dispatched' } };
    const r = proposal({ tasks: [stopped], workerRuns: [run({ status: 'failed', error: 'Claude produced no changes' })] });

    expect(r.status.action).toEqual({ kind: 'build', label: 'Build again' });
    expect(r.canDismiss).toBe(false);
    expect(r.status.secondary).not.toMatchObject({ kind: 'dismiss' });
  });

  it('says Review requested changes when QA sent it back, with Build again beside it', () => {
    const sentBack = { ...task, status: 'changes_requested', meta: { ...task.meta, status: 'changes_requested', verdict: { proven: 2, total: 5, note: 'The empty state is missing' } } };
    const r = proposal({ tasks: [sentBack], workerRuns: [run()] });

    expect(r.status.action).toEqual({ kind: 'drawer', label: 'Review requested changes', drawer: 'acceptance' });
    expect(r.status.secondary).toEqual({ kind: 'build', label: 'Build again' });
    expect(r.status.sentence).toBe('QA found problems and sent it back; it proved 2 of 5. The empty state is missing. Nothing from this attempt has merged.');
  });

  it('says Review the merge when a merge is waiting on a person', () => {
    const merge: ReportActionRun = { ...handoff, id: 90, actionId: 'git.merge', status: 'pending', decidedAt: null, executedAt: null };
    const r = proposal({ tasks: [task], workerRuns: [run()], actionRuns: [merge] });

    expect(r.status.action).toEqual({ kind: 'link', label: 'Review the merge', href: '/dashboard/inbox/proposal-90' });
    expect(r.status.sentence).toContain('It is not live until it merges.');
  });

  it('a Build card waiting on a person is the page\'s status and its Build approves THAT card (journey 4, #214 / card #4945)', () => {
    // Undecided: approvedByAgent is null, not false, until someone decides.
    const card: ReportActionRun = { ...handoff, id: 4945, actionId: 'factory.dispatch_task', status: 'pending', input: { requestId: request.id, reason: 'Ready to build.' }, decidedBy: null, decidedAt: null, approvedByAgent: null, executedAt: null };
    const r = proposal({ actionRuns: [card] });

    expect(r.status.headline).toBe('Build proposed');
    expect(r.status.sentence).toBe('A build card is waiting for your approval (action #4945). Building it approves that card; nothing has run yet.');
    expect(r.status.action).toEqual({ kind: 'build', label: 'Build it', runId: 4945 });
    expect(r.status.secondary).toEqual({ kind: 'link', label: 'Open the card', href: '/dashboard/inbox/proposal-4945' });
    expect(r.state.needsYou).toBe(true);
    // Never "Not being built · It is not open for a build" over a waiting card.
    expect(r.status.headline).not.toBe('Not being built');
  });

  it('a merge waiting on a person reads as waiting whether approvedByAgent is false or not yet set', () => {
    const merge: ReportActionRun = { ...handoff, id: 91, actionId: 'git.merge', status: 'pending', decidedAt: null, approvedByAgent: null, executedAt: null };
    const r = proposal({ tasks: [task], workerRuns: [run()], actionRuns: [merge] });

    expect(r.status.action).toEqual({ kind: 'link', label: 'Review the merge', href: '/dashboard/inbox/proposal-91' });
  });

  it('says Open feature once it is live, pointing at the running product', () => {
    const req = { ...request, meta: { ...request.meta, visuals: { surfaceUrl: 'https://portal.northwind.example/rooms' } } };
    const r = assembleFeatureReport(input({ request: req }));

    expect(r.status).toMatchObject({ headline: 'Live', action: { kind: 'link', label: 'Open feature', href: 'https://portal.northwind.example/rooms' } });
  });

  it('says Review delivery status when the records disagree about whether it was built', () => {
    const r = proposal({ request: { ...request, meta: { ...request.meta, state: 'in_scope', taskCount: 3 } } });

    expect(r.status).toMatchObject({ headline: 'Records disagree', action: { label: 'Review delivery status', drawer: 'status' } });
    expect(r.status.sentence).toContain('is not established');
  });

  it('is red only for a confirmed blocker', () => {
    const blocked = proposal({ request: { ...request, meta: { ...request.meta, state: 'in_scope', blocker: { what: 'The DNS record is not delegated', owner: 'Dana', next: 'delegate it' } } } });

    expect(blocked.status.tone).toBe('bad');
    expect(proposal().status.tone).not.toBe('bad');
    expect(assembleFeatureReport(input()).notices.every(n => n.severity === 'inconsistency')).toBe(true);
  });

  // #130, 2026-09-29: "Chris to approve plan 136" stayed Blocked after plan 136 was approved.
  it('is not Blocked once the plan the blocker waits on is approved', () => {
    const waiting = { what: 'The replanned plan cannot be filed', owner: 'dana@northwind.example', next: 'Decide the pending review item #4068 / approve plan 32' };
    const plan32 = (meta: Record<string, unknown>): ReportObject => ({ ...plan, id: 32, meta: { ...plan.meta, ...meta } });
    const still = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, blocker: waiting } }, plans: [plan32({ status: 'in_review', approvedAt: null })] }));
    const moved = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, blocker: waiting } }, plans: [plan32({ status: 'approved', approvedAt: '2026-09-29T14:20:00Z' })] }));

    expect(still.state.key).toBe('blocked');
    expect(moved.state.key).not.toBe('blocked');
    expect(moved.status.headline).not.toBe('Blocked');
  });

  it('is not Blocked once the typed ask it waits on is answered', () => {
    const blocker = { what: 'Which region hosts the export', owner: 'dana@northwind.example', next: 'answer it', waitsOn: [{ kind: 'ask', id: ask.id }] };
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, blocker } } }));

    expect(r.state.key).not.toBe('blocked');
  });
});

describe('record problems, said plainly', () => {
  it('turns each disagreement into what is known, whether it blocks, and one move, keeping the raw sentence as evidence', () => {
    const late = { ...plan, meta: { ...plan.meta, approvedAt: '2026-09-09T09:00:00Z' } };
    const notice = assembleFeatureReport(input({ plans: [late] })).notices.find(n => n.key === `plan-late-${plan.id}`)!;

    expect(notice).toMatchObject({
      severity: 'inconsistency',
      known: 'The plan was approved after building had already begun.',
      action: { label: 'Review approval history', drawer: 'plan' },
    });
    expect(notice.blocks).toMatch(/^It does not block/);
    expect(notice.evidence).toContain('A plan approved after the work is a record, not a gate.');
  });

  it('does not count a refused attempt as work that ran before the plan was approved', () => {
    const refused = run({ id: 499, status: 'failed', claimedAt: T('2026-09-02T17:30:00Z'), completedAt: T('2026-09-02T17:31:00Z'), error: 'refused: this contract requires an approved plan', cents: 0, result: null });
    const onTime = run({ claimedAt: T('2026-09-03T10:05:00Z') });
    const late = { ...plan, meta: { ...plan.meta, approvedAt: '2026-09-02T18:00:00Z' } };
    const r = assembleFeatureReport(input({ plans: [late], workerRuns: [refused, onTime] }));

    expect(executedRun(refused)).toBe(false);
    expect(r.notices.some(n => n.key.startsWith('plan-late'))).toBe(false);
  });

  it('does not call a queued task with no run yet "incomplete history"', () => {
    const queued = { ...task, status: 'dispatched', meta: { ...task.meta, status: 'dispatched' } };
    const r = proposal({ tasks: [queued] });

    expect(r.notices.some(n => n.key === 'runs-unlinked')).toBe(false);
    expect(r.status.headline).toBe('Queued');
  });
});

describe('the plan, summarised', () => {
  it('resolves a candidate status carrying an approval to Approved', () => {
    expect(planStatusOf({ ...plan, status: 'candidate' })).toBe('Approved');
    expect(planStatusOf({ ...plan, status: 'candidate', meta: { ...plan.meta, approvedAt: undefined, approvedBy: undefined } })).toBe('Awaiting approval');
    expect(planStatusOf({ ...plan, meta: { ...plan.meta, supersededBy: 44 } })).toBe('Superseded');
    expect(planStatusOf({ ...plan, status: 'draft', meta: { requestId: 41 } })).toBe('Draft');
    // A plan filed done for you marks the ROW approved; the plan's own status says it is in review (backlog 038).
    expect(planStatusOf({ ...plan, status: 'approved', meta: { requestId: 41, status: 'in_review' } })).toBe('Awaiting approval');
  });

  it('names the approver, never a raw user id', () => {
    const byId = { ...plan, meta: { ...plan.meta, approvedBy: 'user_2x9Qk7Lm4Np8Rt' } };

    expect(assembleFeatureReport(input()).planSummary).toMatchObject({ status: 'Approved', approver: 'Chris' });
    expect(assembleFeatureReport(input({ plans: [byId] })).planSummary.approver).toBe('Approver unavailable');
    expect(assembleFeatureReport(input({ plans: [byId], people: { user_2x9Qk7Lm4Np8Rt: 'Dana Okafor' } })).planSummary.approver).toBe('Dana Okafor');
    expect(personName('agent:task-planner')).toBe('an agent (task-planner)');
  });

  it('summarises scope and the first risk, and says why a plan was needed in plain words', () => {
    const s = assembleFeatureReport(input()).planSummary;

    expect(s.scope).toBe('Render server side from the room model, not from the DOM, so the PDF matches what the room holds rather than what a browser drew.');
    expect(s.risk).toMatch(/^A long room times out/);
    expect(s.steps).toBe(2);
  });
});

describe('implementation — build and the change in one', () => {
  it('leads with the latest attempt, counts the earlier ones, and keeps each delivery fact separate', () => {
    const first = run({ id: 500, status: 'failed', error: 'verification failed: typecheck failed\nmore', claimedAt: T('2026-09-02T10:05:00Z'), completedAt: T('2026-09-02T11:00:00Z'), result: null });
    const impl = assembleFeatureReport(input({ workerRuns: [first, run()] })).implementation;

    expect(impl.latest).toMatchObject({ runId: 501, outcome: 'Completed', executed: true });
    expect(impl.earlier).toBe(1);
    expect(impl.prUrl).toBe('https://github.com/example/northwind-portal/pull/12');
    expect(impl.ladder.map(s => [s.key, s.value])).toEqual([
      ['run', 'Yes'],
      ['checks', 'Passed'],
      ['merged', 'Yes'],
      ['acceptance', '0 of 2'],
      ['released', 'Live'],
    ]);
  });

  it('never makes a completed run into a merge, or a merge into a release', () => {
    const unmerged = { ...task, status: 'awaiting_review', meta: { ...task.meta, commitSha: undefined } };
    const r = assembleFeatureReport(input({ request: { ...request, meta: { ...request.meta, state: 'building' } }, tasks: [unmerged], releases: [] }));
    const ladder = Object.fromEntries(r.implementation.ladder.map(s => [s.key, s.value]));

    expect(ladder.run).toBe('Yes');
    expect(ladder.merged).toBe('Not recorded as merged');
    expect(ladder.released).toBe('No');
  });

  it('names a refused attempt as not executed', () => {
    const refused = run({ status: 'failed', error: 'Refused: plan required', result: null });

    expect(assembleFeatureReport(input({ workerRuns: [refused] })).implementation.latest?.outcome).toBe('Refused — not executed');
  });
});

describe('the release, read honestly', () => {
  it('is Live with its date when a release shipped it', () => {
    expect(assembleFeatureReport(input()).release).toMatchObject({ state: 'live', label: 'Live' });
  });

  it('is Release not verified — never Not released — when the change merged and nothing records a release', () => {
    expect(assembleFeatureReport(input({ releases: [] })).release).toMatchObject({ state: 'unverified', label: 'Release not verified' });
  });

  it('is Not released only when nothing has merged', () => {
    expect(proposal().release).toMatchObject({ state: 'not_released', label: 'Not released' });
  });
});

describe('the activity preview', () => {
  it('is a few meaningful events, newest first, without the contract bookkeeping', () => {
    const r = assembleFeatureReport(input());

    expect(r.activityPreview.length).toBeLessThanOrEqual(4);
    expect(r.activityPreview.every(e => e.kind !== 'contract' && e.kind !== 'triaged')).toBe(true);

    const times = r.activityPreview.map(e => e.at!.getTime());

    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe('merged means merged (#201: "Merged: Yes" beside "Ready to merge")', () => {
  it('reads a done merge or a release, never a head commit on the task', async () => {
    const { mergedPullRequests } = await import('./featureReport');
    const pr = 'https://github.com/acme/northwind/pull/127';
    const merge = (status: string) => ({ id: 1, actionId: 'git.merge', status, input: { externalRef: { url: pr } }, decidedBy: null, decidedAt: null, approvedByAgent: null, note: null, createdAt: new Date() }) as never;

    expect(mergedPullRequests([], []).has(pr)).toBe(false);
    expect(mergedPullRequests([], [merge('pending')]).has(pr)).toBe(false);
    expect(mergedPullRequests([], [merge('done')]).has(pr)).toBe(true);
    expect(mergedPullRequests([{ id: 9, title: 'send@abc', status: null, meta: { prUrls: [pr] } } as never], []).has(pr)).toBe(true);
  });
});
