import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * The Factory floor's rows, in a real browser, at the two widths the owner
 * actually looks at them (#522).
 *
 * The bug: fourteen columns at 1440px wrapped the task title to four lines
 * in a narrow column while the pull request and the date were cut off the
 * right edge; Repository and Product repeated one value down every row;
 * Size and Decision min were a column of dashes; Asked by was a bare id;
 * and Verified painted a red `false` on tasks that had no verification
 * record at all.
 *
 * Asserted here rather than described: the title is one line at 1440, the
 * constant columns are said once above the table, "not recorded" is not
 * the word "false", the figures share a right edge, the phone drops the
 * low-priority columns instead of clipping them, and the title column
 * stays put while the table scrolls sideways.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
}));

const { PageTable } = await import('./PageTable');

function field(over: Partial<PageField> & Pick<PageField, 'key'>): PageField {
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, detail: false, hideWhenEmpty: true, ...over };
}

/** The floor's fields, as templates/plugins/software-factory declares them. */
const FIELDS: PageField[] = [
  field({ key: 'title', label: 'Task' }),
  field({ key: 'repo', label: 'Repository', from: 'meta.repoSlug', format: 'mono', hideWhenConstant: true }),
  field({ key: 'product', label: 'Product', from: 'meta.productSlug', format: 'mono', hideWhenConstant: true, priority: 3 }),
  field({ key: 'size', label: 'Size', from: 'meta.sizeClass', format: 'badge', tones: { patch: 'muted', minor: 'info' } }),
  field({ key: 'risk', label: 'Risk', from: 'meta.riskClass', format: 'badge', tones: { auth: 'bad', ui: 'info' } }),
  field({ key: 'status', label: 'Status', from: 'status', format: 'badge', tones: { accepted: 'ok', running: 'info' } }),
  field({ key: 'attempt', label: 'Attempt', from: 'meta.attempt', format: 'mono' }),
  field({ key: 'request', label: 'Asked by', from: 'meta.requestId', format: 'link', to: 'request' }),
  field({ key: 'verified', label: 'Verified', from: 'meta.verification.0.passed', format: 'badge', tones: { true: 'ok', false: 'bad' } }),
  field({ key: 'estimate', label: 'Estimated', from: 'meta.estimateCents', format: 'money', total: true, priority: 2 }),
  field({ key: 'actual', label: 'Actual', from: 'meta.actualCents', format: 'money', total: true, priority: 2 }),
  field({ key: 'pr', label: 'PR', from: 'meta.prUrl', format: 'link', priority: 2 }),
  field({ key: 'created', label: 'Opened', from: 'createdAt', format: 'date', priority: 2 }),
];

const PRIMARY = { field: 'title', subtitle: ['repo', 'size', 'risk', 'attempt', 'request'] };

const LONG_TITLE = 'Stop the Safari sign-in loop by setting SameSite=None on the session cookie';

const ROWS: PageRow[] = [
  {
    id: 83,
    title: LONG_TITLE,
    status: 'accepted',
    createdAt: new Date('2026-09-12T10:00:00Z'),
    meta: {
      repoSlug: 'squatch-core',
      productSlug: 'send',
      sizeClass: 'patch',
      riskClass: 'auth',
      attempt: 2,
      requestId: 41,
      estimateCents: 400,
      actualCents: 512,
      prUrl: 'https://github.com/squatch/squatch-core/pull/318',
      verification: [{ passed: true }],
    },
  },
  {
    id: 84,
    title: 'Rename the Send tile on the dashboard',
    status: 'running',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    meta: {
      repoSlug: 'squatch-core',
      productSlug: 'send',
      riskClass: 'ui',
      attempt: 1,
      requestId: 42,
      estimateCents: 100,
    },
  },
];

const LINKS = {
  'request:41': { href: '/dashboard/objects/41', label: 'Signing in on my iPhone loops forever' },
  'request:42': { href: '/dashboard/objects/42', label: '"Send" is not a clear name' },
};

async function floor() {
  const screen = render(
    <div className="mx-auto max-w-[1200px] p-6">
      <PageTable rows={ROWS} fields={FIELDS} primary={PRIMARY} rowLink="/dashboard/objects/{id}" now={Date.parse('2026-09-14T00:00:00Z')} links={LINKS} />
    </div>,
  );

  await expect.element(page.getByRole('table')).toBeInTheDocument();

  return screen;
}

describe('the factory floor at 1440', () => {
  it('leads with the task on one line, not four', async () => {
    await page.viewport(1440, 900);
    await floor();

    const cell = [...document.querySelectorAll('td')].find(td => td.textContent?.includes(LONG_TITLE))!;
    const title = cell.firstElementChild as HTMLElement;

    // One line of the app's own body text, not a four-line stack.
    expect(title.textContent).toBe(LONG_TITLE);
    expect(title.getBoundingClientRect().height).toBeLessThan(30);
    expect(title.getBoundingClientRect().width).toBeGreaterThan(450);
  });

  it('says the repository and the product once, above the table, instead of once per row', async () => {
    await page.viewport(1440, 900);
    await floor();

    const line = document.querySelector('[data-testid="constant-line"]')!;

    expect(line.textContent).toContain('Repository');
    expect(line.textContent).toContain('squatch-core');
    expect(line.textContent).toContain('Product');
    expect(line.textContent).toContain('send');
    // And the columns they were are gone.
    expect([...document.querySelectorAll('th')].map(th => th.textContent?.trim())).not.toContain('Repository');
    // Not once per row: no cell is the repository any more.
    expect([...document.querySelectorAll('td')].filter(td => td.textContent?.trim() === 'squatch-core')).toHaveLength(0);
  });

  it('reads the request by its title, as a link, not as the number 41', async () => {
    await page.viewport(1440, 900);
    await floor();

    const link = document.querySelector('a[href="/dashboard/objects/41"]')!;

    expect(link.textContent).toBe('Signing in on my iPhone loops forever');
    expect(document.body.textContent).not.toContain('Asked by 41');
  });

  it('says "not recorded" for a task with no verification, and never the red word false', async () => {
    await page.viewport(1440, 900);
    await floor();

    expect(document.body.textContent).toContain('not recorded');
    expect(document.body.textContent).not.toMatch(/\bfalse\b/);
  });

  it('puts the money against a right edge, with its header', async () => {
    await page.viewport(1440, 900);
    await floor();

    const headers = [...document.querySelectorAll('th')];
    const actual = headers.find(th => th.textContent?.trim() === 'Actual')!;
    const task = headers.find(th => th.textContent?.trim() === 'Task')!;

    expect(getComputedStyle(actual).textAlign).toBe('right');
    expect(getComputedStyle(task).textAlign).toBe('left');
  });

  it('draws every column it has room for — the pull request and the date are not cut off', async () => {
    await page.viewport(1440, 900);
    await floor();

    const shown = [...document.querySelectorAll('th')].filter(th => th.getBoundingClientRect().width > 0).map(th => th.textContent?.trim()).filter(Boolean);

    expect(shown).toEqual(['Task', 'Status', 'Verified', 'Estimated', 'Actual', 'PR', 'Opened']);

    const table = document.querySelector('table')!;
    const scroller = table.parentElement!;

    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
  });
});

describe('the factory floor at 390', () => {
  it('drops the low-priority columns rather than clipping the row', async () => {
    await page.viewport(390, 844);
    await floor();

    const shown = [...document.querySelectorAll('th')].filter(th => th.getBoundingClientRect().width > 0).map(th => th.textContent?.trim()).filter(Boolean);

    expect(shown).toContain('Task');
    expect(shown).toContain('Status');
    expect(shown).not.toContain('Estimated');
    expect(shown).not.toContain('Opened');
    expect(shown).not.toContain('Product');
  });

  it('keeps the whole task readable — the title still leads, and the page itself does not scroll sideways', async () => {
    await page.viewport(390, 844);
    await floor();

    const cell = [...document.querySelectorAll('td')].find(td => td.textContent?.includes(LONG_TITLE))!;

    expect(cell.getBoundingClientRect().width).toBeGreaterThan(0);

    // The table may scroll inside its own box; the document may not.
    const doc = document.scrollingElement!;

    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
  });

  it('pins the task column while the rest of the table scrolls under it', async () => {
    await page.viewport(390, 844);
    await floor();

    const lead = [...document.querySelectorAll('td')].find(td => td.textContent?.includes(LONG_TITLE))!;

    expect(getComputedStyle(lead).position).toBe('sticky');
    expect(getComputedStyle(lead).left).toBe('0px');
  });
});

describe('row actions', () => {
  it('reach the feature report from a task row, through the request it serves', async () => {
    await page.viewport(1440, 900);
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable
          rows={ROWS}
          fields={FIELDS}
          primary={PRIMARY}
          rowLink="/dashboard/objects/{id}"
          rowActions={[{ label: 'Report', href: '/dashboard/p/feature/{meta.requestId}' }]}
          now={Date.parse('2026-09-14T00:00:00Z')}
          links={LINKS}
        />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    const hrefs = [...document.querySelectorAll('tbody a')]
      .map(a => a.getAttribute('href'))
      .filter(h => h?.includes('/p/feature/'));

    expect(hrefs).toEqual(['/dashboard/p/feature/41', '/dashboard/p/feature/42']);
  });

  it('draw a dash, not a link to nowhere, when the row cannot fill the token', async () => {
    await page.viewport(1440, 900);
    const orphan: PageRow = { ...ROWS[1]!, id: 99, meta: { ...ROWS[1]!.meta, requestId: undefined } };
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable
          rows={[orphan]}
          fields={FIELDS}
          primary={PRIMARY}
          rowActions={[{ label: 'Report', href: '/dashboard/p/feature/{meta.requestId}' }]}
          now={Date.parse('2026-09-14T00:00:00Z')}
        />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    expect([...document.querySelectorAll('tbody a')].some(a => a.getAttribute('href')?.includes('/p/feature/'))).toBe(false);
  });

  it('falls back to the task record when the row named a task but no request of its own', async () => {
    await page.viewport(1440, 900);
    // A probe or a smoke test: the run has an engineering_task, but that
    // task serves no request. The Outcome action lands on the task record
    // instead of drawing no link at all.
    const probe: PageRow = { ...ROWS[1]!, id: 100, meta: { ...ROWS[1]!.meta, requestId: undefined, taskRecordId: 100 } };
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable
          rows={[probe]}
          fields={FIELDS}
          primary={PRIMARY}
          rowActions={[{ label: 'Outcome', href: ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'] }]}
          now={Date.parse('2026-09-14T00:00:00Z')}
        />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    const hrefs = [...document.querySelectorAll('tbody a')].map(a => a.getAttribute('href'));

    expect(hrefs).toContain('/dashboard/objects/100');
    expect(hrefs.some(h => h?.includes('/p/feature/'))).toBe(false);
  });

  it('draws nothing when neither the request nor the task can be named, the way run 349 could not', async () => {
    await page.viewport(1440, 900);
    // The exact shape that reached production: no requestId, no
    // taskRecordId (the run named no `input.record` at all).
    const unresolvable: PageRow = { ...ROWS[1]!, id: 101, meta: { ...ROWS[1]!.meta, requestId: undefined, taskRecordId: undefined } };
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable
          rows={[unresolvable]}
          fields={FIELDS}
          primary={PRIMARY}
          rowActions={[{ label: 'Outcome', href: ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'] }]}
          now={Date.parse('2026-09-14T00:00:00Z')}
        />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    expect([...document.querySelectorAll('tbody a')].length).toBe(0);
  });
});

/**
 * Activity's rows, which are the reason `detail` exists. The page carries
 * twenty six declared fields and the row shows eleven of them; the other
 * fifteen are evidence and read inside the row, where an investigator opens
 * them without leaving the timeline.
 */
const ACTIVITY_FIELDS: PageField[] = [
  field({ key: 'headline', label: 'What happened' }),
  field({ key: 'execution', label: 'Execution', from: 'meta.execution', format: 'badge', tones: { completed: 'ok', failed: 'bad' } }),
  field({ key: 'verification', label: 'Verification', from: 'meta.verification', format: 'badge', tones: { passed: 'ok', failed: 'bad', not_run: 'muted' } }),
  field({ key: 'output', label: 'Output', from: 'meta.output', format: 'badge', tones: { pull_request: 'ok', work_preserved: 'warn' } }),
  field({ key: 'recovery', label: 'Recovery', from: 'meta.recoveryNote' }),
  field({ key: 'cents', label: 'Cost', from: 'meta.cents', format: 'money' }),
  field({ key: 'duration', label: 'Duration', from: 'meta.durationSeconds', format: 'duration' }),
  field({ key: 'agent', label: 'Agent', from: 'meta.agentSlug', format: 'mono', detail: true }),
  field({ key: 'tokens', label: 'Tokens', from: 'meta.tokens', format: 'mono', detail: true }),
  field({ key: 'heartbeat', label: 'Heartbeat', from: 'meta.heartbeatAt', format: 'relative', detail: true }),
  field({ key: 'lease', label: 'Lease', from: 'meta.leaseExpiresAt', format: 'relative', detail: true }),
  field({ key: 'summary', label: 'Worker\'s own report', from: 'meta.summary', detail: true }),
];

const ACTIVITY_PRIMARY = { field: 'headline', subtitle: ['execution', 'verification', 'output', 'recovery'] };

const ACTIVITY_ROWS: PageRow[] = [
  {
    id: 344,
    title: '1 file changed, work preserved on #13',
    status: 'failed',
    createdAt: new Date('2026-09-21T10:00:00Z'),
    meta: {
      headline: '1 file changed, work preserved on #13',
      execution: 'completed',
      verification: 'failed',
      output: 'work_preserved',
      recoveryNote: 'retried as attempt 2, accepted 2m later',
      cents: 11,
      durationSeconds: 185,
      agentSlug: 'send-engineer',
      tokens: 373_613,
      summary: 'Task T-kept-work-smoke (docs): changed 1 file(s) inside allowed_paths, 0/1 checks passed.',
    },
  },
  {
    id: 346,
    title: '1 file changed, 1/1 checks passed, #14',
    status: 'completed',
    createdAt: new Date('2026-09-21T10:04:00Z'),
    meta: {
      headline: '1 file changed, 1/1 checks passed, #14',
      execution: 'completed',
      verification: 'passed',
      output: 'pull_request',
      cents: 5,
      durationSeconds: 20,
      agentSlug: 'send-engineer',
      tokens: 12_004,
      summary: 'Task T-kept-work-smoke (docs): changed 1 file(s), 1/1 checks passed.',
    },
  },
];

describe('Activity, where the evidence is in the row rather than in the columns', () => {
  it('draws the default row and keeps the forensic fields out of it', async () => {
    await page.viewport(1440, 900);
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable rows={ACTIVITY_ROWS} fields={ACTIVITY_FIELDS} primary={ACTIVITY_PRIMARY} now={Date.parse('2026-09-21T11:00:00Z')} />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    const headers = [...document.querySelectorAll('thead th')].map(th => th.textContent?.trim());

    expect(headers).toEqual(['What happened', 'Cost', 'Duration']);
    // The agent, the tokens, the heartbeat and the lease are not columns and
    // are not the subtitle either.
    expect(headers).not.toContain('Tokens');
    expect(headers).not.toContain('Heartbeat');
    // A duration reads as the length a person compares, not as an integer.
    expect(document.body.textContent).toContain('3m 5s');
  });

  it('opens the run\'s own evidence in place, and only the parts the run has', async () => {
    await page.viewport(1440, 900);
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable rows={ACTIVITY_ROWS} fields={ACTIVITY_FIELDS} primary={ACTIVITY_PRIMARY} now={Date.parse('2026-09-21T11:00:00Z')} />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    const disclosures = [...document.querySelectorAll('[data-testid="row-details"]')];

    expect(disclosures).toHaveLength(2);

    const first = disclosures[0] as HTMLDetailsElement;

    // Closed by default: the row is the row, and the evidence is one click in.
    expect(first.open).toBe(false);

    first.open = true;

    const labels = [...first.querySelectorAll('dt')].map(dt => dt.textContent?.trim());

    expect(labels).toEqual(['Agent', 'Tokens', 'Worker\'s own report']);
    // A run that finished has no live heartbeat and no live lease, so the
    // disclosure simply does not carry them rather than drawing two dashes.
    expect(labels).not.toContain('Heartbeat');
    expect(labels).not.toContain('Lease');
    expect(first.textContent).toContain('Task T-kept-work-smoke');
  });

  it('says execution completed beside verification failed without contradicting itself', async () => {
    await page.viewport(1440, 900);
    render(
      <div className="mx-auto max-w-[1200px] p-6">
        <PageTable rows={[ACTIVITY_ROWS[0]!]} fields={ACTIVITY_FIELDS} primary={ACTIVITY_PRIMARY} now={Date.parse('2026-09-21T11:00:00Z')} />
      </div>,
    );

    await expect.element(page.getByRole('table')).toBeInTheDocument();

    const lead = document.querySelector('tbody td')!;
    const line = lead.textContent ?? '';

    expect(line).toContain('completed');
    expect(line).toContain('failed');
    expect(line).toContain('work_preserved');
    expect(line).toContain('retried as attempt 2, accepted 2m later');
  });
});
