import type { RecordRef } from '@/services/chat/pageContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { sourcesMarkdown } from '@/libs/preview/sourcesRef';

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
const { openPreview, useOpenPreviewRef } = await import('./previewState');

/**
 * Stands in for `RailColumn`'s own wiring — read the open ref back off the
 * URL and hand it to the pane as `recordRef`, keyed so a new ref remounts it
 * — without pulling in the rail's chat chrome (and the next-intl navigation
 * it drags along) just to prove a peek link swaps the pane's content.
 * @param props
 * @param props.initial - What is open before anything is clicked.
 */
function PreviewHost({ initial }: { initial: Pick<RecordRef, 'type' | 'id'> }) {
  const ref = useOpenPreviewRef() ?? initial;
  return <PreviewPane key={`${ref.type}:${ref.id}`} recordRef={ref} />;
}

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
    await expect.element(page.getByRole('heading')).toHaveTextContent('RUN-5974');

    expect(get).toHaveBeenCalledTimes(4);

    get.mockResolvedValue(run);
    await page.getByTestId('preview-retry').click();

    await expect.element(page.getByTestId('preview-panel')).toHaveTextContent('Triage the export request');
  });

  it('retries a server answer that says the read itself failed', async () => {
    get.mockResolvedValueOnce({ ref: { type: 'mission_run', id: '5974' }, title: 'RUN-5974', sourceLabel: 'Agent run', unresolved: { reason: 'This could not be read just now.', reference: '5974', retryable: true } }).mockResolvedValue(run);
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

    await expect.element(page.getByTestId('preview-unresolved')).toHaveTextContent('Could not load RUN-5974.');
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

describe('the sources of an answer still being written', () => {
  it('show from the rail\'s live copy, never "no sources", until the answer is stored', async () => {
    const { setLiveSources } = await import('@/libs/preview/liveSources');
    get.mockReset();
    get.mockResolvedValue({ ref: { type: 'conversation', id: '381.sources' }, title: 'Sources · 0', sourceLabel: 'Sources', body: 'No sources were kept for this answer.' });
    setLiveSources(381, [{ document_id: 'req-201', semantic_identifier: 'Request #201 — Document detail page scope', link: '/dashboard/p/feature/201', source_type: 'record', blurb: 'The request as it stands.' }]);

    await render(<PreviewPane recordRef={{ type: 'conversation', id: '381.sources' }} />);

    await expect.element(page.getByText('Request #201 — Document detail page scope')).toBeVisible();

    expect(page.getByText('No sources were kept for this answer.').elements()).toHaveLength(0);

    setLiveSources(381, null);
  });
});

describe('a source that names one of our own records (Chris, 2026-09-29: "sidebar source previews were pretty much empty")', () => {
  afterEach(() => {
    // `openPreview` writes `?preview=…` onto the URL; leave the address bar
    // the way the next test file expects to find it.
    window.history.replaceState(null, '', '/');
  });

  it('lists the tracker record numbered as cited, then opens IT — same pane, its own fields and body — when the source is followed', async () => {
    get.mockReset();
    get.mockImplementation(async ({ type, id }: { type: string; id: string }) => {
      if (type === 'conversation' && id === '512.sources') {
        return {
          ref: { type: 'conversation', id: '512.sources' },
          title: 'Sources · 1',
          sourceLabel: 'Sources',
          body: sourcesMarkdown([{
            document_id: 'object-42',
            semantic_identifier: 'Northwind Renewal',
            link: '/dashboard/objects/tracker/42',
            source_type: 'tracker',
            blurb: 'active',
            citationIndex: 1,
          }]),
        };
      }
      if (type === 'object' && id === '42') {
        // The record's OWN preview — what its own page would show, not a
        // kind label and a status line.
        return {
          ref: { type: 'object', id: '42' },
          title: 'Northwind Renewal',
          sourceLabel: 'Tracker',
          facts: [{ label: 'Status', value: 'active' }],
          body: 'Renewal call scheduled for next week — champion confirmed budget.',
          href: '/dashboard/objects/tracker/42',
          hrefLabel: 'Open Tracker record',
        };
      }
      throw new Error(`preview.get called for an unexpected ref: ${type}:${id}`);
    });

    openPreview({ type: 'conversation', id: '512.sources' }, null);
    render(<PreviewHost initial={{ type: 'conversation', id: '512.sources' }} />);

    const panel = page.getByTestId('preview-panel');

    // The list: numbered as cited, the record's title, nothing more than its
    // title and status — a compact row, not an empty detail page.
    await expect.element(panel).toHaveTextContent('[1]');
    await expect.element(panel).toHaveTextContent('Northwind Renewal');
    await expect.element(panel).toHaveTextContent('active');

    // Following the source swaps THIS pane for the record's own preview — no
    // second drawer, no "Back" into a bespoke detail view.
    await page.getByTestId('preview-peek-link').click();

    await expect.element(panel).toHaveTextContent('Renewal call scheduled for next week');
    await expect.element(page.getByRole('heading')).toHaveTextContent('Northwind Renewal');
    await expect.element(page.getByTestId('preview-detail-link')).toHaveAttribute('href', '/dashboard/objects/tracker/42');
    // The bespoke drawer's own "Open in tracker" affordance is gone — the
    // pane's one link-out (above) is the only way to the full record.
    expect(panel.element().textContent).not.toContain('Open in tracker');
  });
});
