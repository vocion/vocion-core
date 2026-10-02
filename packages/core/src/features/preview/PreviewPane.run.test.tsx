import type { RunGlance } from '@/libs/worker/runLog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * An engineering run in the pane, in its page's own shape (Chris,
 * 2026-09-30, run #435: the pane read "#435 · running · claude" and then the
 * whole contract). The same status line, why-line and Now line as the page,
 * the steps as a runner lists them — a mark and a duration, no logs — and
 * the moves out: the run, its pull request, its contract. Fixture run.
 */

const get = vi.fn();
const glance = vi.fn();

vi.mock('@/libs/Orpc', () => ({ client: { preview: { get: (...a: unknown[]) => get(...a) }, runs: { glance: (...a: unknown[]) => glance(...a) } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/p/feature/269',
}));

const { PreviewPane } = await import('./PreviewPane');

const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();

function run(status = 'running'): RunGlance {
  return {
    header: {
      kind: 'worker',
      ref: '435',
      id: 435,
      title: 'Room PDF export',
      taskId: 'northwind-t275',
      seat: 'Engineer',
      objective: 'Add a PDF export to the room share menu.',
      status,
      attempt: 1,
      startedAt: at(300),
      endedAt: null,
      cents: 90,
      model: null,
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
        feature: { id: 269, title: 'Room PDF export', href: '/dashboard/p/feature/269' },
        plan: null,
        attempt: { n: 2, of: 3 },
        acceptance: null,
        why: { kind: 'ci', line: 'CI failed on the pull request: test (unit)', detail: 'AssertionError: expected 200 to be 403 admin.test.ts:121', href: null },
      },
    },
    steps: [
      { key: 'prepare', name: 'Set up', status: 'passed', startedAt: at(300), endedAt: at(280), lines: [], links: [] },
      { key: 'claude', name: 'Claude Code', status: 'running', startedAt: at(280), endedAt: null, lines: [], links: [] },
    ],
    now: { step: 'Claude Code', say: 'API side passes, 7 of 7. Now the web side.' },
  };
}

function doc(g: RunGlance) {
  return { ref: { type: 'worker_run', id: '435' }, title: g.header.title, sourceLabel: 'Run', href: '/dashboard/p/runs/435', run: g, body: 'the whole contract as text, which the pane does not draw' };
}

beforeEach(() => {
  get.mockReset();
  glance.mockReset();
});

describe('a run in the preview pane', () => {
  it('draws the run page\'s header, why-line, Now line and its steps without logs', async () => {
    get.mockResolvedValue(doc(run()));
    render(<PreviewPane recordRef={{ type: 'worker_run', id: '435' }} />);

    await expect.element(page.getByTestId('run-glance')).toBeVisible();
    await expect.element(page.getByRole('heading', { name: 'Room PDF export' })).toBeVisible();
    await expect.element(page.getByTestId('run-attempt')).toHaveTextContent('attempt 2 of 3');
    await expect.element(page.getByTestId('run-why')).toHaveTextContent(/CI failed on the pull request: test \(unit\)/);
    await expect.element(page.getByTestId('run-now-say')).toHaveTextContent('API side passes, 7 of 7. Now the web side.');

    const rows = [...document.querySelectorAll('[data-testid="run-steps-compact"] li')];

    expect(rows.map(r => [r.getAttribute('data-item'), r.querySelector('[data-step-status]')?.getAttribute('data-step-status')])).toEqual([['prepare', 'passed'], ['claude', 'running']]);
    expect(rows[0]?.textContent).toContain('20s');
    expect(document.querySelector('[data-testid="run-step-log"]')).toBeNull();
    expect(document.body.textContent).not.toContain('the whole contract as text');
  });

  it('offers the moves out: the run, its pull request, its contract', async () => {
    get.mockResolvedValue(doc(run()));
    render(<PreviewPane recordRef={{ type: 'worker_run', id: '435' }} />);

    await expect.element(page.getByTestId('run-glance-open')).toHaveAttribute('href', '/dashboard/p/runs/435');
    await expect.element(page.getByTestId('run-glance-pr')).toHaveAttribute('href', 'https://github.com/example/northwind-portal/pull/27');
    await expect.element(page.getByTestId('run-glance-contract')).toHaveAttribute('href', '/dashboard/p/runs/435#contract');
  });

  it('re-reads a live run, and stops once it finishes', async () => {
    get.mockResolvedValue(doc(run()));
    const done = run('completed');
    done.header.endedAt = new Date().toISOString();
    done.now = null;
    glance.mockResolvedValue(done);
    const { GLANCE_POLL_MS } = await import('@/features/dashboard/factory/RunGlanceView');
    render(<PreviewPane recordRef={{ type: 'worker_run', id: '435' }} />);

    await expect.element(page.getByTestId('run-glance')).toBeVisible();
    await expect.poll(() => glance.mock.calls.length, { timeout: GLANCE_POLL_MS + 2000 }).toBe(1);

    expect(glance).toHaveBeenCalledWith({ ref: '435' });
    await expect.element(page.getByTestId('run-glance')).toHaveAttribute('data-live', 'off');
  });
});
