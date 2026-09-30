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
 * The reader is a product owner (Chris, 2026-09-28): the introduction, where
 * it is and the one move, the gallery, the connected work, then Plan,
 * Implementation, Acceptance, Release and Activity as a few lines each, with
 * the full record one tap away in the preview pane. This measures geometry
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
  it('goes introduction, status, gallery, then plan, implementation, acceptance, release, activity', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const order = ['report-story', 'report-state', 'report-visuals', 'report-plan', 'report-implementation', 'report-acceptance', 'report-release', 'report-activity']
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

  it('keeps run completed, checks, merged, acceptance and released apart', async () => {
    await page.viewport(1440, 900);
    // Merged means the merge ran (a done git.merge), never a commit on the task.
    await draw(fixture({ actionRuns: [{ id: 4950, actionId: 'git.merge', status: 'done', input: { taskId: 77, externalRef: { url: LONG_PR } }, decidedBy: 'usr-owner', decidedAt: T('2026-09-05T10:00:00Z'), approvedByAgent: null, note: null, createdAt: T('2026-09-05T09:00:00Z'), executedAt: T('2026-09-05T10:00:00Z') }] }));

    const steps = [...document.querySelectorAll('[data-testid="report-ladder"] [data-step]')].map(el => [el.getAttribute('data-step'), el.getAttribute('data-state')]);

    expect(steps).toEqual([['run', 'no'], ['checks', 'yes'], ['merged', 'yes'], ['acceptance', 'unknown'], ['released', 'unknown']]);
    expect(document.querySelector('[data-testid="report-cost"]')!.textContent).toContain('$14.50 spent');
  });

  it('shows acceptance as N of M verified with no pass that has no evidence', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const acceptance = document.querySelector('#report-acceptance')!;

    expect(acceptance.textContent).toContain('0 of 1 verified');
    expect(acceptance.textContent).toContain('Unverified');
    expect(acceptance.textContent).not.toContain('Passed');
    expect(acceptance.querySelector('[data-preview-key="feature_section:41.criterion-0"]')).not.toBeNull();
  });

  it('opens a drawer in the one preview pane, in the URL so Back closes it', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    document.querySelector<HTMLButtonElement>('[data-preview-key="feature_section:41.activity"]')!.click();

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('feature_section:41.activity');

    closePreview();

    expect(new URLSearchParams(window.location.search).get('preview')).toBeNull();
  });

  it('does not scroll sideways at 390px, with a long pull request on it', async () => {
    await page.viewport(390, 844);
    await draw(fixture());

    expect(document.body.textContent).toContain('Pull request #1284');
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

    await expect.element(run).toHaveTextContent('Run #503');
    expect(run.element().getAttribute('data-preview-key')).toBe('worker_run:503');
    await expect.element(page.getByTestId('report-status')).toHaveTextContent('Current state');
    // The Implementation lists the live run as a row too.
    expect(document.querySelector('[data-testid="report-runs"] [data-run-row="503"][data-live="true"]')).not.toBeNull();
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

    await expect.element(page.getByTestId('report-status-sentence')).toHaveTextContent('A build card is waiting for your approval (action #4945).');

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

  it('says a missing plan in plain words', () => {
    expect(plainWarning('The plan rule required a plan for this work and none is on the record. 1 worker run ran anyway.')).toBe('This feature was built without the required plan.');
    expect(plainWarning('Two releases claim this request. The second has no commit.')).toBe('Two releases claim this request.');
  });
});
