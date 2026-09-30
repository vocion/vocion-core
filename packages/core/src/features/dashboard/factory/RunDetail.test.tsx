import type { RunHeader, RunLogData, RunLogEvent } from '@/libs/worker/runLog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

const log = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: { runs: { log: (input: unknown) => log(input) } },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/p/runs/7',
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { RunDetail } = await import('./RunDetail');

/**
 * The run page, drawn: a runner's step list that opens onto logs, follows a
 * live run and leaves a finished one alone — at a desk and on a phone.
 */

function header(over: Partial<RunHeader> = {}): RunHeader {
  return {
    kind: 'worker',
    ref: '7',
    id: 7,
    title: 'northwind-t12',
    objective: 'Add a PDF export to the room share menu.',
    status: 'running',
    attempt: 2,
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    endedAt: null,
    cents: 184,
    model: 'claude-sonnet-4-6',
    prUrl: null,
    error: null,
    summary: null,
    links: [{ label: 'Transcript', href: '/dashboard/artifacts/91', external: false }],
    logLinks: { stream: null, stderr: null, checks: {} },
    attach: null,
    progress: { phase: null, note: null, log: [] },
    checks: [],
    failures: [],
    ...over,
  };
}

function ev(seq: number, phase: string, fields: Record<string, unknown> = {}): RunLogEvent {
  return { seq, ts: new Date(Date.now() - 80_000 + seq * 1000).toISOString(), phase, step: null, level: null, message: null, fields };
}

const LONG = `npx vitest run src/features/rooms/${'very-long-segment/'.repeat(12)}ShareMenu.test.tsx`;

function live(over: Partial<RunHeader> = {}): RunLogData {
  return {
    header: header(over),
    events: [
      ev(1, 'claim'),
      ev(2, 'prepare', { note: 'clone https://github.com/example/northwind-portal.git' }),
      ev(3, 'claude', { note: 'model=sonnet' }),
      ev(4, 'claude.tool', { tool: 'Read', target: 'src/features/rooms/ShareMenu.tsx', ok: true }),
      ev(5, 'claude.tool', { tool: 'Bash', target: LONG, ok: true }),
    ],
    tasks: [],
    calls: [],
    cursor: 5,
  };
}

function stepRow(name: string) {
  return page.getByRole('button', { name: new RegExp(name) });
}

beforeEach(() => {
  log.mockReset();
});

describe('the run page', () => {
  it('lists the steps with their state, the running one open on its log', async () => {
    await page.viewport(1280, 900);
    render(<RunDetail initial={live()} pollMs={60_000} />);

    await expect.element(page.getByRole('heading', { name: 'northwind-t12' })).toBeVisible();
    await expect.element(page.getByText('$1.84')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Transcript' })).toHaveAttribute('href', '/dashboard/artifacts/91');
    await expect.element(stepRow('Set up')).toHaveAttribute('aria-expanded', 'false');
    await expect.element(stepRow('Claude Code')).toHaveAttribute('aria-expanded', 'true');

    const running = document.querySelector('[data-item="claude"] [data-step-status]');

    expect(running?.getAttribute('data-step-status')).toBe('running');
    await expect.element(page.getByText('ok  Read src/features/rooms/ShareMenu.tsx')).toBeVisible();
  });

  it('opens a step\'s log when it is clicked, with numbered lines', async () => {
    render(<RunDetail initial={live()} pollMs={60_000} />);

    await userEvent.click(stepRow('Set up'));

    await expect.element(stepRow('Set up')).toHaveAttribute('aria-expanded', 'true');

    const setUp = document.querySelector('[data-item="prepare"] [data-testid="run-step-log"]');

    expect(setUp?.textContent).toContain('prepare  clone https://github.com/example/northwind-portal.git');
    expect(setUp?.querySelector('td')?.textContent).toBe('1');
  });

  it('asks for the lines after the last one it has while the run is live, and stops once it finishes', async () => {
    log.mockResolvedValueOnce({ header: header({ status: 'completed', endedAt: new Date().toISOString() }), events: [ev(6, 'check', { name: 'typecheck', status: 'passed', exit_code: 0 })], tasks: [], calls: [], cursor: 6 });
    render(<RunDetail initial={live()} pollMs={150} />);

    await expect.poll(() => log.mock.calls.length).toBe(1);

    expect(log).toHaveBeenCalledWith({ ref: '7', after: 5 });

    await expect.element(stepRow('Checks')).toBeVisible();
    await expect.element(page.getByText('Completed')).toBeVisible();

    await new Promise(r => setTimeout(r, 600));

    expect(log).toHaveBeenCalledTimes(1);
  });

  it('never polls a run that has finished, opens the failed step and keeps the Claude Code block', async () => {
    const data = live({ status: 'failed', endedAt: new Date().toISOString(), error: 'verification failed: required checks failed: test', attach: 'Vocion software factory run #7 failed (northwind-t12).' });
    data.events.push(ev(6, 'check', { name: 'test', status: 'failed', exit_code: 1, tail: '\u001B[31mFAIL\u001B[39m rooms.test.ts' }), ev(7, 'fail', { note: 'verification failed' }));
    render(<RunDetail initial={data} pollMs={100} />);

    await expect.element(stepRow('Checks')).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByText('  FAIL rooms.test.ts')).toBeInTheDocument();
    await expect.element(page.getByTestId('run-stopped')).toHaveTextContent(/verification failed/);
    await expect.element(page.getByTestId('run-attach')).toHaveTextContent(/Vocion software factory run #7 failed/);

    await new Promise(r => setTimeout(r, 400));

    expect(log).not.toHaveBeenCalled();
  });

  it('says what the factory did about a stopped run, under why it stopped (backlog 038)', async () => {
    const data = live({ status: 'failed', endedAt: new Date().toISOString(), error: 'verification failed: required checks failed: test', recovery: 'Recovered: sending it again because the required checks failed (test).' });
    render(<RunDetail initial={data} pollMs={100} />);

    await expect.element(page.getByTestId('run-recovery')).toHaveTextContent('Recovered: sending it again because the required checks failed (test).');
  });

  it('holds a long log line inside its box on a phone — the page never scrolls sideways', async () => {
    await page.viewport(390, 844);
    render(<RunDetail initial={live()} pollMs={60_000} />);

    await expect.element(page.getByText(LONG, { exact: false })).toBeInTheDocument();

    const box = document.querySelector('[data-item="claude"] [data-testid="run-step-log"]') as HTMLElement;

    expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });

  it('leads a refused run with the run, its reason whole to a sentence end, and no 0s duration', async () => {
    const reason = 'task contract refused: plan: this task needs an approved plan. A required plan cannot be skipped. The contract must match factory/contracts/schema.json and carry an approved plan when the plan rule requires one, which this one did not, so nothing was cloned and no model was called at all today, and the worker reported the refusal to Vocion with every problem the contract had listed one by one for the person reading it.';
    const t = new Date().toISOString();
    const data: RunLogData = { header: header({ status: 'failed', cents: 0, startedAt: t, endedAt: t, error: reason, progress: { phase: 'fail', note: reason, log: [] }, failures: [{ scope: 'contract', message: 'plan' }] }), events: [], tasks: [], calls: [], cursor: 0 };
    render(<RunDetail initial={data} pollMs={60_000} />);

    await expect.element(page.getByRole('heading', { level: 1, name: 'northwind-t12' })).toBeVisible();
    await expect.element(page.getByText('Refused before it started')).toBeVisible();
    await expect.element(page.getByTestId('run-stopped')).toHaveTextContent(/A required plan cannot be skipped\.$/);
    await expect.element(stepRow('Stopped at: Contract check')).toHaveAttribute('aria-expanded', 'true');

    expect(document.body.textContent).not.toMatch(/\b0s\b/);
    expect(document.querySelectorAll('[data-testid="run-step-log"] tr')).toHaveLength(1);
  });
});

describe('where the run belongs (Chris, 2026-09-29: "context of the implementation/plan/history")', () => {
  const context = {
    feature: { id: 41, title: 'Room PDF export', href: '/w/acme/dashboard/p/feature/41' },
    plan: { id: 52, title: 'Render the room to PDF on the server', href: '/w/acme/dashboard/objects/52' },
    task: { id: 60, href: '/w/acme/dashboard/objects/60' },
    attempt: { n: 2, of: 3 },
    others: [{ runId: 6, status: 'failed', href: '/dashboard/p/runs/6' }],
    acceptance: {
      count: 3,
      href: '/w/acme/dashboard/p/feature/41#report-acceptance',
      criteria: [
        { text: 'A PDF downloads from the share menu', state: 'proven' as const },
        { text: 'It keeps the room layout', state: 'open' as const },
        { text: 'It names the room', state: 'proven' as const },
      ],
    },
    branch: { name: 'factory/northwind-t12', href: 'https://github.com/example/northwind-portal/tree/factory/northwind-t12' },
    why: null,
  };

  it('names its feature, its plan, which attempt it is with the others one move away, and what it must prove', async () => {
    log.mockResolvedValue({ header: header(), events: [], tasks: [], calls: [], cursor: 0 });
    await render(<RunDetail initial={live({ context })} pollMs={60_000} />);

    await expect.element(page.getByRole('link', { name: '#41 Room PDF export' })).toHaveAttribute('href', '/w/acme/dashboard/p/feature/41');
    await expect.element(page.getByRole('link', { name: '#52 Render the room to PDF on the server' })).toHaveAttribute('href', '/w/acme/dashboard/objects/52');
    await expect.element(page.getByRole('link', { name: 'Run #6' })).toHaveAttribute('href', '/dashboard/p/runs/6');
    await expect.element(page.getByTestId('run-criteria-toggle')).toHaveTextContent('3 criteria · 2 proven');
    await expect.element(page.getByRole('link', { name: 'factory/northwind-t12' })).toHaveAttribute('href', 'https://github.com/example/northwind-portal/tree/factory/northwind-t12');
  });

  it('opens each criterion with its proven or open state', async () => {
    await render(<RunDetail initial={live({ context })} pollMs={60_000} />);

    await userEvent.click(page.getByTestId('run-criteria-toggle'));

    const states = [...document.querySelectorAll('[data-testid="run-criteria"] li')].map(li => li.getAttribute('data-state'));

    expect(states).toEqual(['proven', 'open', 'proven']);
  });

  it('a run whose records name no feature draws no context block', async () => {
    log.mockResolvedValue({ header: header(), events: [], tasks: [], calls: [], cursor: 0 });
    await render(<RunDetail initial={live({ context: null })} pollMs={60_000} />);

    expect(document.querySelector('[data-fact="related:feature"]')).toBeNull();
  });
});
