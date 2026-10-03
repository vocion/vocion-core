import type { FeatureReportInput } from '@/services/factory/featureReport';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { closePreview } from '@/features/preview/previewState';
import { assembleFeatureReport } from '@/services/factory/featureReport';
import { FeatureReportView, plainWarning, ReportContextLine } from './FeatureReportView';
import '@/styles/global.css';

/**
 * The feature page, drawn — at a desk and on a phone.
 *
 * The reader is a product owner (Chris, 2026-09-28; 2026-10-02): the
 * introduction, where it is and the one move, the gallery, "Did it work?",
 * the Timeline and Related — each section answering one question, the full
 * record one tap away in the preview pane. This measures geometry
 * and order rather than class names — the next person to restyle it should
 * find out here whether they reintroduced a horizontal scroll, a red warning
 * over a record disagreement, or a Build button over a live build.
 */

// The pane's chat button reads the router, and the pane fetches its content;
// neither matters to the page's layout.
vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/p/feature/41',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
// A live build re-reads the page every few seconds through Next's router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
vi.mock('@/libs/Orpc', () => ({
  client: {
    preview: { get: vi.fn(async (input: { type: string; id: string }) => ({ ref: input, title: 'A drawer', sourceLabel: 'Feature', body: 'The full record.' })) },
    review: {
      propose: vi.fn(async () => ({ runId: 9, status: 'pending' })),
      decideAction: vi.fn(async () => ({ result: { workerRunId: 3 } })),
      undoAction: vi.fn(async () => ({})),
    },
  },
}));

const T = (iso: string) => new Date(iso);

const LONG_PR = 'https://github.com/example/northwind-portal/pull/1284';

function fixture(over: Partial<FeatureReportInput> = {}) {
  const input: FeatureReportInput = {
    request: {
      id: 41,
      title: 'Export a room as a PDF',
      status: 'shipped',
      createdAt: T('2026-09-01T09:00:00Z'),
      meta: {
        kind: 'gap',
        channel: 'dogfood',
        product: 'northwind-portal',
        body: 'I can read the room on screen but I cannot hand it to my board. Give me a PDF.',
        story: 'A room owner hands their board a PDF of the room from the share menu.',
        expectedResult: 'Board packs stop being screenshots.',
        askedBy: { name: 'Dana Okafor' },
        askedAt: '2026-09-01T09:00:00Z',
        state: 'building',
        severity: 'p2',
        decisionCost: 5,
        recommendedOutcome: 'build',
        recommendationState: 'approved',
        rankedAt: '2026-09-02T08:00:00Z',
      },
    },
    tasks: [{
      id: 77,
      title: 'Room PDF export',
      status: 'accepted',
      createdAt: T('2026-09-03T09:00:00Z'),
      meta: {
        requestId: 41,
        objective: 'Add a PDF export to the room share menu.',
        allowedPaths: ['packages/core/src/features/rooms/**/*.{ts,tsx}', 'packages/core/src/services/export/**'],
        acceptanceContract: ['The share menu offers PDF'],
        requiredChecks: ['npm run lint', 'npm run check:types'],
        riskClass: 'ui',
        estimateCents: 900,
        actualCents: 1450,
        prUrl: LONG_PR,
        commitSha: '9f2c1ab7d4e5f60918273645aabbccddeeff0011',
        branch: 'feat/room-pdf-export-with-a-deliberately-long-branch-name',
        filesChanged: ['packages/core/src/services/export/pdf.ts'],
        checks: [{ name: 'npm run lint', passed: true, exitCode: 0 }],
      },
    }],
    workerRuns: [{
      id: 502,
      agentSlug: 'task-engineer',
      kind: 'worker',
      status: 'failed',
      attempt: 2,
      cents: 830,
      model: 'claude-sonnet-4-6',
      summary: null,
      error: 'completion call timed out',
      createdAt: T('2026-09-04T10:00:00Z'),
      claimedAt: T('2026-09-04T10:05:00Z'),
      completedAt: T('2026-09-04T12:00:00Z'),
      input: { record: { type: 'engineering_task', id: 77 } },
      result: null,
      progress: { keptBranch: 'feat/room-pdf-export-with-a-deliberately-long-branch-name', prUrl: LONG_PR },
    }],
    plans: [],
    asks: [],
    actionRuns: [],
    releases: [],
    artifacts: [],
    now: T('2026-09-21T12:00:00Z'),
    ...over,
  };
  return assembleFeatureReport(input);
}

/**
 * Render the report inside the dashboard's own page padding, which is the
 * only thing between it and the viewport edge.
 * @param report - The assembled report.
 */
async function draw(report: ReturnType<typeof fixture>) {
  await render(
    <div className="px-6 py-4">
      <FeatureReportView report={report} />
    </div>,
  );
}

describe('the feature page, in the order a product owner reads it', () => {
  it('goes introduction and status, gallery, did it work, timeline — one question each (2026-10-02)', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    // One "Timeline", never two sections called "Activity" (FE-370).
    expect(document.querySelectorAll('#report-activity, #report-activity-list, #report-implementation')).toHaveLength(0);

    const order = ['report-story', 'report-state', 'report-visuals', 'report-outcome', 'report-timeline']
      .map(id => document.getElementById(id));

    expect(order.every(el => el !== null)).toBe(true);

    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    expect(document.querySelector('[data-testid="report-benefit"]')!.textContent).toContain('Board packs stop being screenshots.');
  });

  it('says where it is in one sentence with one action that follows the state', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    // Accepted by QA, not merged by a release: ready to merge, not live.
    expect(document.querySelector('[data-testid="report-status-sentence"]')!.textContent).toContain('It is not live until it merges.');
    expect(document.querySelector('[data-testid="report-primary-action"]')!.textContent).toBe('Review the merge');
  });

  it('draws a record disagreement quietly, never red, with what it blocks and one move', async () => {
    await page.viewport(1440, 900);
    // Merged means the merge ran (a done git.merge), never a commit on the task.
    await draw(fixture({ actionRuns: [{ id: 4950, actionId: 'git.merge', status: 'done', input: { taskId: 77, externalRef: { url: LONG_PR } }, decidedBy: 'usr-owner', decidedAt: T('2026-09-05T10:00:00Z'), approvedByAgent: null, note: null, createdAt: T('2026-09-05T09:00:00Z'), executedAt: T('2026-09-05T10:00:00Z') }] }));

    const notice = document.querySelector('#report-notices [data-severity="inconsistency"]')!;

    expect(notice.textContent).toContain('Run 502 is recorded as failed, but its pull request merged.');
    expect(notice.textContent).toContain('This does not block anything');
    expect(notice.querySelector('[data-preview-key="feature_section:41.status"]')).not.toBeNull();
    expect(document.querySelector('#report-notices .bg-brand-fail')).toBeNull();
  });

  it('says the pull request that shipped and its own checks under "Did it work?", and the cost at the timeline\'s foot', async () => {
    await page.viewport(1440, 900);
    // Merged means the merge ran (a done git.merge), never a commit on the task.
    await draw(fixture({ actionRuns: [{ id: 4950, actionId: 'git.merge', status: 'done', input: { taskId: 77, externalRef: { url: LONG_PR } }, decidedBy: 'usr-owner', decidedAt: T('2026-09-05T10:00:00Z'), approvedByAgent: null, note: null, createdAt: T('2026-09-05T09:00:00Z'), executedAt: T('2026-09-05T10:00:00Z') }] }));

    const pr = document.querySelector('[data-testid="report-shipped-pr"]')!.textContent;

    expect(pr).toContain('PR #1284');
    expect(pr).toContain('1/1 checks');
    expect(pr).toContain('merged');
    expect(document.querySelector('[data-testid="report-outcome-line"]')!.textContent).toContain('Release not verified');
    expect(document.querySelector('[data-testid="timeline-cost-foot"]')!.textContent).toBe('$8.30 in all · builds $8.30 · agents not recorded · chat not recorded');
    expect(document.querySelector('[data-testid="feature-timeline"] [data-testid="timeline-cost"]')!.textContent).toBe('$8.30');
  });

  // FE-392, 2026-10-03: "Live since" in Current state read a fixed-UTC
  // stamp ("03 Oct 2026, 01:27 UTC") while "Did it work?" and the Timeline
  // read the reader's own calendar off the same instant ("2 Oct") — three
  // clocks disagreeing on one page across a day boundary. Both now render
  // the live date through the same `LocalDate` component off the same
  // `report.release.at`, so they can never read a different calendar day.
  it('keeps the live date when the headline is not just "Live" (FE-398: "Shipped · seen live" lost it)', async () => {
    await page.viewport(390, 844);
    await draw(fixture({
      releases: [{
        id: 9,
        title: 'northwind-portal 2.4.0',
        status: 'shipped',
        createdAt: T('2026-10-03T01:00:00Z'),
        meta: { product: 'northwind-portal', version: '2.4.0', releasedAt: '2026-10-03T01:27:00Z', taskIds: [77], requestIds: [41], liveState: 'seen', liveSummary: 'Seen live: 3 of 3 states reached.' },
      }],
    }));

    const sentence = document.querySelector('[data-testid="report-status-sentence"]')!;

    expect(sentence.textContent).toMatch(/^Live since /);
    expect(sentence.querySelector('time')).not.toBeNull();
  });

  it('reads the same live date in Current state and in "Did it work?" (FE-392)', async () => {
    await page.viewport(1440, 900);
    await draw(fixture({
      releases: [{
        id: 9,
        title: 'northwind-portal 2.4.0',
        status: 'shipped',
        createdAt: T('2026-10-03T01:00:00Z'),
        meta: { product: 'northwind-portal', version: '2.4.0', releasedAt: '2026-10-03T01:27:00Z', taskIds: [77], requestIds: [41] },
      }],
    }));

    const stateTime = document.querySelector('[data-testid="report-status-sentence"] time')!;
    const outcomeTime = document.querySelector('[data-testid="report-outcome-line"] time')!;

    expect(stateTime.textContent).not.toBe('');
    expect(stateTime.textContent).toBe(outcomeTime.textContent);
    expect(stateTime.getAttribute('dateTime')).toBe(outcomeTime.getAttribute('dateTime'));
  });

  it('shows acceptance as N of M verified with no pass that has no evidence', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const acceptance = document.querySelector('#report-outcome')!;

    expect(acceptance.textContent).toContain('0 of 1 criteria verified');
    expect(acceptance.textContent).toContain('Unverified');
    expect(acceptance.textContent).not.toContain('Passed');
    expect(acceptance.querySelector('[data-preview-key="feature_section:41.criterion-0"]')).not.toBeNull();
  });

  it('says why a line is not passed under it, and nothing under a passed line (Walk 12)', async () => {
    await page.viewport(390, 844);
    const report = fixture({
      tasks: [{ id: 77, title: 'Room PDF export', status: 'changes_requested', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, acceptanceContract: ['The share menu offers PDF'], prUrl: LONG_PR, verdict: { value: 'changes', at: '2026-09-04T12:00:00Z', by: 'change-reviewer', criteria: [{ criterion: 'The share menu offers PDF', status: 'unchecked' }] } } }],
    });
    await draw(report);

    const note = document.querySelector('#report-outcome [data-testid="criterion-note"]');

    expect(note?.textContent).toBe('QA did not judge this line.');
  });

  it('opens a drawer in the one preview pane, in the URL so Back closes it', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    document.querySelector<HTMLButtonElement>('[data-testid="timeline-see-all"]')!.click();

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('feature_section:41.timeline');

    closePreview();

    expect(new URLSearchParams(window.location.search).get('preview')).toBeNull();
  });

  it('does not scroll sideways at 390px, with a long pull request on it', async () => {
    await page.viewport(390, 844);
    await draw(fixture());

    expect(document.body.textContent).toContain('PR #1284');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('does not scroll sideways at a desk either', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1440);
  });
});

describe('the action follows the state', () => {
  const proposal = (over: Partial<FeatureReportInput> = {}) => fixture({
    request: { id: 41, title: 'Export a room as a PDF', status: 'in_scope', createdAt: T('2026-09-01T09:00:00Z'), meta: { state: 'in_scope' } },
    tasks: [],
    workerRuns: [],
    ...over,
  });

  it('offers Build it and Dismiss on a proposal nothing has started', async () => {
    await page.viewport(1440, 900);
    await draw(proposal());

    await expect.element(page.getByTestId('feature-build')).toHaveTextContent('Build it');
    await expect.element(page.getByTestId('feature-dismiss')).toBeInTheDocument();
  });

  it('never draws Build over a live run: the Now line names the run and opens it (Chris, 2026-09-29/30)', async () => {
    await page.viewport(1440, 900);
    await draw(proposal({
      tasks: [{ id: 77, title: 'Room PDF export', status: 'running', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41 } }],
      workerRuns: [{ id: 503, agentSlug: 'task-engineer', kind: 'worker', status: 'running', attempt: 1, cents: null, model: null, summary: null, error: null, createdAt: T('2026-09-21T11:00:00Z'), claimedAt: T('2026-09-21T11:01:00Z'), completedAt: null, input: {}, result: null, progress: { step: 'Running the checks' } }],
    }));

    expect(document.querySelector('[data-testid="feature-build"]')).toBeNull();
    // The row is the move: no second "View progress" button beside it.
    expect(document.querySelector('[data-testid="report-primary-action"]')).toBeNull();

    // The Now line says what runs, its step, and opens the run (2026-09-30).
    const now = page.getByTestId('work-status-now');

    await expect.element(now).toHaveTextContent('Engineer building');
    await expect.element(now).toHaveTextContent('Running the checks');
    await expect.element(page.getByTestId('work-status-you')).toHaveTextContent('Nothing needs you');
    await expect.element(page.getByTestId('work-status-next')).toHaveTextContent('QA checks it');

    const run = page.getByTestId('work-status-run');

    await expect.element(run).toHaveTextContent('RUN-503');
    expect(run.element().getAttribute('data-preview-key')).toBe('worker_run:503');
    await expect.element(page.getByTestId('report-status')).toHaveTextContent('Current state');
    // The Timeline lists the live attempt as its newest row too.
    expect(document.querySelector('[data-testid="feature-timeline"] [data-testid="timeline-row"][data-live="true"]')?.textContent).toContain('Attempt 1 of 1 · building');
  });

  it('offers Build again, never Dismiss, once an attempt has run', async () => {
    await page.viewport(1440, 900);
    await draw(proposal({
      tasks: [{ id: 77, title: 'Room PDF export', status: 'rejected', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, status: 'dispatched' } }],
      workerRuns: [{ id: 503, agentSlug: 'task-engineer', kind: 'worker', status: 'failed', attempt: 1, cents: 120, model: null, summary: null, error: 'Claude produced no changes', createdAt: T('2026-09-20T11:00:00Z'), claimedAt: T('2026-09-20T11:01:00Z'), completedAt: T('2026-09-20T11:30:00Z'), input: {}, result: null, progress: {} }],
    }));

    await expect.element(page.getByTestId('feature-build')).toHaveTextContent('Build again');
    expect(document.querySelector('[data-testid="feature-dismiss"]')).toBeNull();
  });

  it('reads the build it just started in the headline, and Undo takes it back (backlog 032)', async () => {
    await page.viewport(390, 844);
    await draw(proposal({
      tasks: [{ id: 77, title: 'Room PDF export', status: 'rejected', createdAt: T('2026-09-03T09:00:00Z'), meta: { requestId: 41, status: 'dispatched' } }],
      workerRuns: [{ id: 503, agentSlug: 'task-engineer', kind: 'worker', status: 'failed', attempt: 1, cents: 120, model: null, summary: null, error: 'Claude produced no changes', createdAt: T('2026-09-20T11:00:00Z'), claimedAt: T('2026-09-20T11:01:00Z'), completedAt: T('2026-09-20T11:30:00Z'), input: {}, result: null, progress: {} }],
    }));
    const before = document.querySelector('[data-testid="report-headline"]')!.textContent;

    expect(before).not.toContain('Building');

    await page.getByTestId('feature-build').click();

    await expect.element(page.getByTestId('report-headline')).toHaveTextContent('Waiting for a worker');
    await expect.element(page.getByTestId('report-status-sentence')).toHaveTextContent('Queued for the engineer just now.');

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect.element(page.getByTestId('report-headline')).toHaveTextContent(before!);
  });

  it('with a Build card already waiting, Build it approves THAT card on the page — no second card (journey 4, #4945)', async () => {
    const { client } = await import('@/libs/Orpc');
    const propose = vi.mocked(client.review.propose);
    const decide = vi.mocked(client.review.decideAction);
    propose.mockClear();
    decide.mockClear();
    await page.viewport(1440, 900);
    await draw(proposal({
      actionRuns: [{ id: 4945, actionId: 'factory.dispatch_task', status: 'pending', input: { requestId: 41 }, decidedBy: null, decidedAt: null, approvedByAgent: null, note: null, createdAt: T('2026-09-21T10:00:00Z'), executedAt: null }],
    }));

    await expect.element(page.getByTestId('report-status-sentence')).toHaveTextContent('A build card is waiting for your approval (ACT-4945).');

    await page.getByTestId('feature-build').click();

    await expect.element(page.getByTestId('feature-building')).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith({ id: 4945, decision: 'approve' });
  });
});

describe('the pieces that carried over', () => {
  it('draws the context line inside the scrollport, never above its top edge', async () => {
    // It lived at the top of the report column under a `-mt-4`, and a
    // scrollport does not extend above its own top edge: production showed
    // two grey specks while getBoundingClientRect reported a full box.
    await page.viewport(390, 844);
    await render(
      <div className="h-[200px] overflow-x-hidden overflow-y-auto">
        <ReportContextLine bits={['Send', 'minor change', 'asked 1d ago']} />
      </div>,
    );

    const line = document.querySelector('p')!;
    const port = line.parentElement!;

    expect(line.textContent).toContain('minor change');
    expect(line.getBoundingClientRect().top).toBeGreaterThanOrEqual(port.getBoundingClientRect().top);
  });

  it('opens the mockup full screen when it is tapped, at any width', async () => {
    await page.viewport(390, 844);
    await draw(fixture({
      artifacts: [{
        id: 91,
        kind: 'mockup',
        title: 'The send dialog',
        recordType: 'object',
        recordId: '41',
        recordRole: 'proposal-visual',
        spec: { contentType: 'image/png' },
        url: 'https://files.example.test/send-dialog.png',
        createdAt: T('2026-09-20T09:00:00Z'),
      }],
    }));

    const slide = document.querySelector<HTMLButtonElement>('[data-testid="report-slide"]');

    expect(slide).not.toBeNull();

    slide!.click();
    await new Promise(r => setTimeout(r, 50));
    const big = document.querySelector('[data-testid="report-lightbox-image"]');

    expect(big).not.toBeNull();
    expect(big!.getAttribute('src')).toBe(slide!.querySelector('img')!.getAttribute('src'));
  });

  it('says "Preview pending" rather than stretching an icon', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    await expect.element(page.getByTestId('report-preview-pending')).toBeInTheDocument();
  });

  it('shows the drawn mockups, not "Preview pending", once draw_mockup has written them (request #224)', async () => {
    await page.viewport(390, 844);
    const png = (id: number) => `/api/artifacts/o-${id}/o-${id}.png`;
    await draw(fixture({
      request: { id: 41, title: 'Copy a file\'s link from the list', status: 'new', createdAt: T('2026-09-20T09:00:00Z'), meta: { surface: 'ui', state: 'in_scope', product: 'northwind-portal', visuals: { beforeArtifactIds: [81], mockupArtifactIds: [92, 93] } } },
      tasks: [],
      workerRuns: [],
      artifacts: [
        { id: 81, kind: 'link', title: 'Files · desktop · before', recordType: 'object', recordId: '77', recordRole: 'qa-screenshot', spec: {}, url: png(81), createdAt: T('2026-09-19T09:00:00Z') },
        { id: 92, kind: 'file', title: 'Copy a file\'s link · Default', recordType: 'object', recordId: '41', recordRole: 'mockup:default', spec: { contentType: 'image/png' }, url: png(92), createdAt: T('2026-09-20T09:00:00Z') },
        { id: 93, kind: 'file', title: 'Copy a file\'s link · Link copied', recordType: 'object', recordId: '41', recordRole: 'mockup:link-copied', spec: { contentType: 'image/png' }, url: png(93), createdAt: T('2026-09-20T09:00:01Z') },
      ],
    }));

    expect(document.querySelector('[data-testid="report-preview-pending"]')).toBeNull();

    const srcs = [...document.querySelectorAll<HTMLImageElement>('[data-testid="report-slide"] img')].map(i => i.getAttribute('src'));

    // Every drawn state, in order, beside the real screen it was drawn on.
    expect([...srcs].sort()).toEqual([png(81), png(92), png(93)]);
    expect(srcs.indexOf(png(92))).toBeLessThan(srcs.indexOf(png(93)));
  });

  it('shows what the person reported in chat as the screen before, not "Preview pending" (Chris, 2026-09-30, #268)', async () => {
    await page.viewport(1440, 900);
    const shot = '/api/artifacts/o-88/header-overflow.png';
    await draw(fixture({
      request: { id: 41, title: 'Fix header width overflow on mobile', status: 'new', createdAt: T('2026-09-30T08:05:00Z'), meta: { surface: 'ui', state: 'in_scope', product: 'northwind-portal' } },
      tasks: [],
      workerRuns: [],
      artifacts: [
        { id: 88, kind: 'file', title: 'header-overflow.png', recordType: 'object', recordId: '41', recordRole: 'reported', spec: { contentType: 'image/png' }, url: shot, createdAt: T('2026-09-30T08:00:00Z') },
      ],
    }));

    expect(document.querySelector('[data-testid="report-preview-pending"]')).toBeNull();

    const slide = document.querySelector('[data-testid="report-slide"]');

    expect(slide?.querySelector('img')?.getAttribute('src')).toBe(shot);

    const said = document.querySelector('[data-testid="report-carousel"]')?.textContent ?? '';

    // Its section, what it is, and who sent it when (2026-09-30).
    expect(document.querySelector('[data-testid="report-slide-section"]')?.textContent).toBe('Reported in chat');
    expect(said).toContain('header-overflow.png');
    expect(document.querySelector('[data-testid="report-slide-source"]')?.textContent).toBe('Reported in chat by a person · Sep 30');
  });

  it('gives every picture its section, caption and source, and the source opens where it came from', async () => {
    await page.viewport(1440, 900);
    await draw(fixture({
      request: { id: 41, title: 'Remind a reader who has not opened the room', status: 'new', createdAt: T('2026-09-25T08:05:00Z'), meta: { surface: 'ui', state: 'in_scope', product: 'northwind-portal', visuals: { mockupArtifactIds: [95] } } },
      tasks: [],
      workerRuns: [],
      artifacts: [
        { id: 95, kind: 'file', title: 'Mockup: Remind a reader · Default', recordType: 'object', recordId: '41', recordRole: 'mockup', author: 'Designer', spec: { contentType: 'image/png', url: '/api/artifacts/o-95/o-95.png', caption: 'Remind a person who has not opened it', source: { state: 'Default', html: '<div></div>' }, provenance: { drawnFrom: 'request', missionRunId: 5120 } }, url: null, createdAt: T('2026-09-25T10:00:00Z') },
      ],
    }));

    expect(document.querySelector('[data-testid="report-slide-section"]')?.textContent).toBe('Mockup');
    expect(document.querySelector('[data-testid="report-slide-caption"]')?.textContent).toContain('Remind a person who has not opened it');

    const source = document.querySelector<HTMLButtonElement>('[data-testid="report-slide-source"]');

    expect(source?.textContent).toBe('Designer · drawn from the request · Sep 25');
    expect(source?.tagName).toBe('BUTTON');
    // Never a native tooltip: the Tooltip component carries the hint.
    expect(source?.getAttribute('title')).toBeNull();
  });

  it('says the mockup is being drawn where it would be, instead of "Preview pending"', async () => {
    await page.viewport(1440, 900);
    await draw(fixture({
      request: { id: 41, title: 'Remind a reader who has not opened the room', status: 'new', createdAt: T('2026-09-30T08:05:00Z'), meta: { surface: 'ui', state: 'new', product: 'northwind-portal', visuals: { mockupDraw: { state: 'failed', attempt: 2, at: '2026-09-30T08:10:00Z', reason: 'the renderer is not available' } } } },
      tasks: [],
      workerRuns: [],
      artifacts: [],
    }));

    expect(document.querySelector('[data-testid="report-preview-pending"]')).toBeNull();
    expect(document.querySelector('[data-testid="report-mockup-status"]')?.textContent).toContain('The mockup was not drawn after 2 attempts');
  });

  it('says a missing plan in plain words', () => {
    expect(plainWarning('The plan rule required a plan for this work and none is on the record. 1 worker run ran anyway.')).toBe('This feature was built without the required plan.');
    expect(plainWarning('Two releases claim this request. The second has no commit.')).toBe('Two releases claim this request.');
  });
});

describe('where it started and what it is connected to (Chris, 2026-09-30, #269; 2026-10-02)', () => {
  it('closes its Timeline with the chat it was requested in, newest first, and draws Related with that chat first, after it', async () => {
    await page.viewport(1440, 900);
    const report = fixture({
      activity: [
        { kind: 'mission_run' as const, id: 901, title: 'tell-the-requester-check: Every asker hears back', at: T('2026-09-03T12:00:00Z'), status: 'completed', runStatus: 'completed', detail: null, label: 'Reply pass', doing: 'Reply pass', touched: [41] },
        { kind: 'conversation' as const, id: 812, title: 'Requested in chat by Dana Okafor', at: T('2026-09-01T09:00:00Z'), status: null, detail: 'Board pack as a PDF', origin: true },
      ],
    });
    await render(
      <div className="px-6 py-4">
        <FeatureReportView
          report={report}
          related={[
            { key: 'o', relation: 'origin', label: 'Started in chat', title: 'Board pack as a PDF', href: '/dashboard/chat?c=812', external: false, preview: { type: 'conversation', id: '812' }, kind: 'conversation', note: 'Dana Okafor', at: null },
            { key: 'p', relation: 'plans', label: 'Plan', title: '#52 Render the room to PDF', href: '/dashboard/objects/52', external: false, preview: { type: 'object', id: '52' }, kind: 'record', note: null, at: null },
          ]}
        />
      </div>,
    );

    await expect.element(page.getByTestId('report-timeline')).toHaveTextContent(/^Timeline/);

    const titles = [...document.querySelectorAll('[data-testid="feature-timeline"] [data-testid="timeline-title"]')].map(t => t.textContent);

    expect(titles).toEqual(['Attempt 1 of 1 · failed', 'Reply pass', 'Requested in chat by Dana Okafor']);
    // The run's code is metadata beside the time, never its title.
    expect(document.querySelector('[data-testid="feature-timeline"]')!.textContent).toContain('RUN-901');
    expect(document.getElementById('report-timeline')!.compareDocumentPosition(document.getElementById('report-related')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const labels = [...document.querySelectorAll('[data-testid="feature-related"] dt')].map(d => d.textContent);

    expect(labels).toEqual(['Started in chat', 'Plan']);
    await expect.element(page.getByRole('link', { name: 'Board pack as a PDF' })).toHaveAttribute('href', '/dashboard/chat?c=812');

    closePreview();
  });
});
