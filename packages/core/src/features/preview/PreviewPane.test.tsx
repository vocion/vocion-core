import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

/**
 * The pane while the server restarts, and when a reference truly cannot be
 * read (Chris, 2026-09-28, during a deploy: "Could not load this reference"
 * over a run that was fine). A network error or a 5xx is retried with backoff
 * and said as "Vocion is restarting"; only a real not-found or forbidden says
 * "Could not load", and then says what the reference is, in words, with its
 * page. Fixture data only.
 */

const get = vi.fn();

vi.mock('@/libs/Orpc', () => ({ client: { preview: { get: (...args: unknown[]) => get(...args) } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/p/feature/41',
}));
// The real backoff is 1s, 2s, 4s…; the contract is the same at a few milliseconds.
vi.mock('./previewFetch', async importOriginal => ({ ...(await importOriginal<typeof import('./previewFetch')>()), RETRY_DELAYS_MS: [10, 10, 10] }));

const { PreviewPane } = await import('./PreviewPane');

/**
 * What oRPC throws for an HTTP answer.
 * @param status
 */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

const run = {
  ref: { type: 'mission_run', id: '5974' },
  title: 'Triage the export request',
  sourceLabel: 'Agent run',
  href: '/dashboard/p/runs/agent-5974',
  subtitle: 'Filed request #41 as in scope.',
  facts: [{ label: 'Status', value: 'Completed' }, { label: 'Took', value: '3m 12s' }, { label: 'Cost', value: 'no cost recorded' }],
  body: '**What it filed or changed**\n\n- [Updated request #41](/dashboard/objects/41)',
  steps: [
    { key: 'task:t1', name: 'Read the request · product-manager', status: 'passed', startedAt: '2026-09-20T10:00:00Z', endedAt: '2026-09-20T10:01:00Z', lines: [{ text: 'ok  read_object  41', level: 'info' }], links: [] },
    { key: 'task:t2', name: 'Write the verdict · product-manager', status: 'failed', startedAt: '2026-09-20T10:01:00Z', endedAt: '2026-09-20T10:03:00Z', lines: [{ text: 'Error: overloaded', level: 'error' }], links: [] },
  ],
  more: [{ key: 'brief', title: 'The brief it was given', body: 'Your charter: keep the backlog honest.' }],
};

beforeEach(() => {
  get.mockReset();
});

describe('while the server restarts', () => {
  it('says Vocion is restarting, retries on its own, and shows the run when it answers', async () => {
    get.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(httpError(502)).mockResolvedValue(run);
    render(<PreviewPane recordRef={{ type: 'mission_run', id: '5974' }} />);

    const panel = page.getByTestId('preview-panel');

    await expect.element(panel).toHaveTextContent('Triage the export request');
    await expect.element(panel).toHaveTextContent('What it filed or changed');

    expect(get).toHaveBeenCalledTimes(3);
    expect(panel.element().textContent).not.toContain('Could not load');
  });

  it('never says "Could not load" for a 5xx: after the last retry it is still restarting, and Retry tries again', async () => {
    get.mockRejectedValue(httpError(503));
    render(<PreviewPane recordRef={{ type: 'mission_run', id: '5974' }} />);

    await expect.element(page.getByTestId('preview-restarting')).toHaveTextContent('Vocion is still restarting.');
    await expect.element(page.getByTestId('preview-panel')).not.toHaveTextContent('Could not load');
    // The header names it in words the whole time, never the bare id.
    await expect.element(page.getByRole('heading')).toHaveTextContent('Agent run #5974');

    expect(get).toHaveBeenCalledTimes(4);

    get.mockResolvedValue(run);
    await page.getByTestId('preview-retry').click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Triage the export request');
  });

  it('retries a server answer that says the read itself failed', async () => {
    get.mockResolvedValueOnce({ ref: { type: 'mission_run', id: '5974' }, title: 'Agent run #5974', sourceLabel: 'Agent run', unresolved: { reason: 'This could not be read just now.', reference: '5974', retryable: true } }).mockResolvedValue(run);
    render(<PreviewPane recordRef={{ type: 'mission_run', id: '5974' }} />);

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Triage the export request');
  });
});

describe('a reference that truly cannot be read', () => {
  it('after a restart, a real 404 says what it is in words and links its page', async () => {
    get.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValue(httpError(404));
    render(<PreviewPane recordRef={{ type: 'feature_section', id: '126.plan' }} />);

    const unresolved = page.getByTestId('preview-unresolved');

    await expect.element(unresolved).toHaveTextContent('Could not load Plan for #126.');
    await expect.element(unresolved).toHaveTextContent('Nothing in this workspace has this reference.');
    await expect.element(page.getByTestId('preview-unresolved-link')).toHaveAttribute('href', '/dashboard/p/feature/126');
    await expect.element(page.getByTestId('preview-unresolved-link')).toHaveTextContent('Open Plan for #126');
    await expect.element(page.getByTestId('preview-panel')).not.toHaveTextContent('126.plan');
  });

  it('a 403 says it is not shared with you, naming the run in words', async () => {
    get.mockRejectedValue(httpError(403));
    render(<PreviewPane recordRef={{ type: 'mission_run', id: '5974' }} />);

    await expect.element(page.getByTestId('preview-unresolved')).toHaveTextContent('Could not load Agent run #5974.');
    await expect.element(page.getByTestId('preview-unresolved')).toHaveTextContent('It is not shared with you.');
    await expect.element(page.getByTestId('preview-unresolved-link')).toHaveAttribute('href', '/dashboard/p/runs/agent-5974');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('an agent run', () => {
  it('reads in order: how it ended, what it changed, its steps with only the failed one open, the brief last and closed', async () => {
    get.mockResolvedValue(run);
    render(<PreviewPane recordRef={{ type: 'mission_run', id: '5974' }} />);

    const panel = page.getByTestId('preview-panel');

    await expect.element(panel).toHaveTextContent('What it filed or changed');

    const text = panel.element().textContent ?? '';
    const order = ['Filed request #41 as in scope.', 'Completed · 3m 12s · no cost recorded', 'What it filed or changed', 'Read the request', 'Write the verdict', 'The brief it was given'];

    expect(order.map(s => text.indexOf(s)).every((at, i, all) => at >= 0 && (i === 0 || at > all[i - 1]!))).toBe(true);
    await expect.element(page.getByTestId('preview-detail-link')).toHaveAttribute('href', '/dashboard/p/runs/agent-5974');

    // Only the failed step is open; the brief is closed.
    const rows = panel.element().querySelectorAll('[data-pattern="accordion-row"]');

    expect([...rows].map(r => r.getAttribute('data-state'))).toEqual(['closed', 'open', 'closed']);
    expect(text).not.toContain('Your charter');
  });
});
