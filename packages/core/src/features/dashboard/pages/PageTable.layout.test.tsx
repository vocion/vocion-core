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
  return { label: over.key, format: 'text', total: false, priority: 1, hideWhenConstant: false, ...over };
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
});
