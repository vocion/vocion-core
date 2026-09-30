import type { RunHeader, RunLogData, RunLogEvent } from '@/libs/worker/runLog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/Orpc', () => ({
  client: { runs: { log: vi.fn(async () => ({ header: null, events: [], tasks: [], calls: [], cursor: 0 })) } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/p/runs/435',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { RunDetail } = await import('./RunDetail');

/**
 * ONE HEADER FOR A RUN (Chris, 2026-09-30, feature #269, run #435): titled by
 * its feature, one status line with the feature's own attempt count, why
 * this attempt, and what it is doing now. Fixture run, fictional.
 */

function header(over: Partial<RunHeader> = {}): RunHeader {
  return {
    kind: 'worker',
    ref: '435',
    id: 435,
    title: 'Room PDF export',
    taskId: 'northwind-t275',
    seat: 'Engineer',
    objective: 'Add a PDF export to the room share menu. '.repeat(20),
    status: 'running',
    attempt: 1,
    startedAt: new Date(Date.now() - 125_000).toISOString(),
    endedAt: null,
    cents: 184,
    model: 'claude-sonnet-4-6',
    prUrl: 'https://github.com/example/northwind-portal/pull/27',
    error: null,
    summary: null,
    links: [],
    logLinks: { stream: null, stderr: null, checks: {} },
    attach: null,
    progress: { phase: null, note: null, log: [] },
    checks: [],
    failures: [],
    context: {
      feature: { id: 269, title: 'Room PDF export', href: '/w/acme/dashboard/p/feature/269' },
      plan: { id: 270, title: 'Render the room to PDF', href: '/w/acme/dashboard/objects/270' },
      task: { id: 275, href: '/w/acme/dashboard/objects/275' },
      attempt: { n: 2, of: 3 },
      others: [{ runId: 431, status: 'completed', href: '/dashboard/p/runs/431' }],
      acceptance: { count: 7, href: '/w/acme/dashboard/p/feature/269#report-acceptance' },
      branch: null,
      why: { kind: 'ci', line: 'CI failed on the pull request: test (unit)', detail: 'test (unit): AssertionError: expected 200 to be 403 src/features/admin/admin.test.ts:121', href: 'https://github.com/example/northwind-portal/pull/26' },
    },
    ...over,
  };
}

function ev(seq: number, phase: string, fields: Record<string, unknown> = {}): RunLogEvent {
  return { seq, ts: new Date(Date.now() - 100_000 + seq * 1000).toISOString(), phase, step: null, level: null, message: null, fields };
}

function data(over: Partial<RunHeader> = {}): RunLogData {
  return {
    header: header(over),
    events: [
      ev(1, 'claim'),
      ev(2, 'claude', { note: 'model=sonnet' }),
      ev(3, 'claude.text', { text: 'Reading the share menu first.' }),
      ev(4, 'claude.tool', { tool: 'Read', target: 'src/features/rooms/ShareMenu.tsx', ok: true }),
      ev(5, 'claude.text', { text: 'Tests written.\nAPI side passes, 7 of 7. Now the web side: theme helpers.' }),
    ],
    tasks: [],
    calls: [],
    cursor: 5,
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/p/runs/435');
});

describe('the run\'s header', () => {
  it('is titled by its feature, linking it, with the machine id among the facts', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    await expect.element(page.getByRole('heading', { level: 1, name: 'Room PDF export' })).toBeVisible();
    await expect.element(page.getByTestId('run-title-feature')).toHaveAttribute('href', '/w/acme/dashboard/p/feature/269');
    await expect.element(page.getByTestId('run-context-task')).toHaveTextContent('Run #435 · northwind-t275');

    expect(document.querySelector('h1')?.textContent).not.toContain('northwind-t275');
  });

  it('reads the feature\'s own attempt count on one status line: seat, attempt N of M, elapsed', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    await expect.element(page.getByTestId('run-attempt')).toHaveTextContent('attempt 2 of 3');
    await expect.element(page.getByText('Engineer', { exact: true })).toBeVisible();
    await expect.element(page.getByTestId('run-elapsed')).toHaveTextContent(/^2m \d\ds$/);
  });

  it('says why this attempt: the CI failure with its failing test, in one line', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    const why = page.getByTestId('run-why');

    await expect.element(why).toHaveAttribute('data-why-kind', 'ci');
    await expect.element(why).toHaveTextContent('CI failed on the pull request: test (unit) — test (unit): AssertionError: expected 200 to be 403 src/features/admin/admin.test.ts:121');
  });

  it('pins Now above the steps: the running step and the engineer\'s latest line', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    await expect.element(page.getByTestId('run-now')).toHaveTextContent('Now · Claude Code');
    await expect.element(page.getByTestId('run-now-say')).toHaveTextContent('API side passes, 7 of 7. Now the web side: theme helpers.');
  });

  it('draws no why-line on a first attempt and no Now once the run stops', async () => {
    const h = header();
    render(<RunDetail initial={data({ status: 'completed', endedAt: new Date().toISOString(), context: { ...h.context!, why: null, attempt: null } })} pollMs={60_000} />);

    await expect.element(page.getByTestId('run-title-block')).toBeVisible();

    expect(document.querySelector('[data-testid="run-why"]')).toBeNull();
    expect(document.querySelector('[data-testid="run-now"]')).toBeNull();
    expect(document.querySelector('[data-testid="run-attempt"]')).toBeNull();
  });

  it('keeps the contract to two lines until asked', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    await expect.element(page.getByTestId('run-contract')).toBeVisible();

    const text = document.querySelector('[data-testid="run-contract"] p') as HTMLElement;

    expect(text.className).toContain('line-clamp-2');

    await userEvent.click(page.getByTestId('run-contract-toggle'));

    expect(text.className).not.toContain('line-clamp-2');
    await expect.element(page.getByTestId('run-contract-toggle')).toHaveTextContent('Hide contract');
  });
});

describe('open in preview, on a fact row', () => {
  it('shows on the row\'s hover and opens that record in the pane, leaving the page where it is', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    const row = page.getByRole('link', { name: '#269 Room PDF export' });

    await expect.element(row).toBeVisible();

    const button = document.querySelector('[data-fact="related:feature"] [data-testid="open-in-preview"]') as HTMLElement;

    expect(getComputedStyle(button).opacity).toBe('0');

    await userEvent.hover(row);

    await expect.poll(() => getComputedStyle(button).opacity).toBe('1');

    await userEvent.click(button);

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('object:269');
    expect(window.location.pathname).toBe('/dashboard/p/runs/435');
  });

  it('gives the pull request row no preview: it opens GitHub in a new tab', async () => {
    render(<RunDetail initial={data()} pollMs={60_000} />);

    await expect.element(page.getByRole('link', { name: 'PR #27' })).toHaveAttribute('target', '_blank');

    expect(document.querySelector('[data-fact="related:pr"] [data-testid="open-in-preview"]')).toBeNull();
  });
});
