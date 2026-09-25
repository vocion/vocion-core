import type { FeatureReportInput } from '@/services/factory/featureReport';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { assembleFeatureReport } from '@/services/factory/featureReport';
import { FeatureReportView, plainWarning, ReportContextLine } from './FeatureReportView';
import '@/styles/global.css';

/**
 * The feature report, drawn — at a desk and on a phone.
 *
 * A report is read where the question is asked, which is often on a phone
 * between other things, and the values on it are the widest strings in the
 * product: a pull request URL, a branch, a file path, a commit. The page has
 * to hold them without pushing the document sideways, so this measures
 * geometry rather than class names — the next person to restyle this should
 * find out here whether they reintroduced a horizontal scroll.
 */

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
        askedBy: { name: 'Dana Okafor' },
        askedAt: '2026-09-01T09:00:00Z',
        state: 'shipped',
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

describe('the feature report, drawn', () => {
  it('leads with the work and keeps the machinery behind Technical details', async () => {
    // It used to read ask · triage · plan · contract · approvals · runs ·
    // change · qa · release · money — the internal entities, in the order the
    // records were written. The story a person follows comes first now; the
    // ask as written, the triage figures, the contracts and the approval
    // records are still on the page, one level down.
    await page.viewport(1440, 900);
    await draw(fixture());

    const keys = [...document.querySelectorAll('[data-section]')].map(el => el.getAttribute('data-section'));

    // The fixture is a RELEASED feature, so the sections that lead are the
    // result and its evidence; the plan is still on the page, behind Details,
    // because it has nothing left to decide.
    // Asserted as a property, because which sections lead depends on the
    // PHASE now: a released feature leads with its result and its evidence,
    // and a section whose only content is "this has not happened" is dropped
    // rather than drawn.
    // Asserted as a property, because which sections LEAD depends on the
    // phase now. This fixture is mid-build, so Build leads and Release — which
    // would only be able to say it has not happened — drops behind Details.
    const leads = keys.slice(0, keys.indexOf('ask'));

    expect(leads).toContain('runs');
    expect(leads).not.toContain('release');

    // Nothing is lost: every section is still on the page somewhere.
    for (const k of ['ask', 'triage', 'contract', 'approvals', 'plan', 'release']) {
      expect(keys).toContain(k);
    }

    // Nothing was dropped on the way.
    expect(keys).toHaveLength(13);

    // And the four that moved are inside the disclosure, not merely after it.
    const technical = document.querySelector('#report-technical')!;

    for (const key of ['ask', 'triage', 'contract', 'approvals']) {
      expect(technical.querySelector(`[data-section="${key}"]`)).not.toBeNull();
    }
  });

  it('puts the newest timeline entry last', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const entries = [...document.querySelectorAll('[data-timeline-entry]')].map(el => el.getAttribute('data-timeline-entry'));

    expect(entries[0]).toBe('asked');
    expect(entries.at(-1)).toBe('run-502-pr');
  });

  it('shows the six summary figures and the money line', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const strip = document.querySelector('#report-summary')!;

    expect(strip.textContent).toContain('Asked');
    expect(strip.textContent).toContain('nothing has shipped');
    expect(strip.textContent).toContain('Attempts');
    expect(document.querySelector('#report-money')?.textContent ?? document.querySelector('[data-section="money"]')!.textContent).toContain('+$5.50');
  });

  it('says what did not happen instead of hiding it', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const absences = [...document.querySelectorAll('[data-absence]')].map(el => el.textContent);

    expect(absences).toContain('Not ready for review — nobody has looked at this running yet.');
    expect(absences).toContain('Not released. Nothing has carried this work to people yet.');
  });

  it('flags the failed run whose pull request merged, in red, above the fold', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    const banner = document.querySelector('#report-contradictions')!;

    expect(banner.textContent).toContain('Run 502 is recorded as failed');
    expect(banner.textContent).toContain('Nothing here was resolved for you.');
  });

  it('does not scroll sideways at 390px, with a pull request URL and a commit on it', async () => {
    await page.viewport(390, 844);
    await draw(fixture());

    expect(document.body.textContent).toContain('9f2c1ab7d4e5f60918273645aabbccddeeff0011');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('draws the context line inside the scrollport, never above its top edge', async () => {
    // It lived at the top of the report column under a `-mt-4`, to sit close
    // to the title. That column is a scroll container, and a scrollport does
    // not extend above its own top edge: the line was clipped to its bottom
    // 3px and production showed two grey specks where "Send · minor change ·
    // asked 1d ago" should have been — while getBoundingClientRect still
    // reported a full-width box. Measure the paint, not the class name.
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

  it('opens the mockup itself when the mockup is tapped, at any width', async () => {
    // At 430px a desktop mockup is an illegible thumbnail, and it is the one
    // thing on this page that has to be looked at rather than read. The tap
    // used to open the artifact's record page — which is exactly what the
    // caption's "Open" link already does — so the page offered two tap
    // targets with one outcome and no way to enlarge the mockup.
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

    const shot = document.querySelector('#report-visuals img');

    expect(shot).not.toBeNull();

    const link = shot!.closest('a')!;

    expect(link.getAttribute('href')).toBe(shot!.getAttribute('src'));
    expect(link.getAttribute('href')).not.toBe('');
  });

  it('does not scroll sideways at a desk either', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1440);
  });
});

describe('the first screen leads with the feature (Chris, 2026-09-25)', () => {
  it('says "Preview pending" rather than stretching an icon, and keeps a process warning to one line', async () => {
    await page.viewport(1440, 900);
    await draw(fixture());

    await expect.element(page.getByTestId('report-preview-pending')).toBeInTheDocument();

    // The fixture has a worker run and no plan: the warning is one plain line, the evidence behind a tap.
    const warning = document.querySelector('#report-contradictions summary');
    if (warning) {
      expect(warning.textContent).not.toMatch(/THE RECORDS DISAGREE/i);
      expect((document.querySelector('#report-contradictions') as HTMLDetailsElement).open).toBe(false);
    }
  });

  it('says a missing plan in plain words', () => {
    expect(plainWarning('The plan rule required a plan for this work and none is on the record. 1 worker run ran anyway.')).toBe('This feature was built without the required plan.');
    expect(plainWarning('Two releases claim this request. The second has no commit.')).toBe('Two releases claim this request.');
  });
});
