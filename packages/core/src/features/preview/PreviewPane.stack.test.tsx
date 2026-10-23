import type { RecordRef } from '@/services/chat/pageContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

/**
 * Background work stands on top of a record in the one pane, and the pane's
 * back control returns to the record (Chris, 2026-10-23). Fixture data only.
 */

const get = vi.fn();
const { view } = vi.hoisted(() => ({
  view: { running: [], finished: [{ key: 'mission:3', kind: 'mission', title: 'Reconcile the Northwind invoices', what: 'Mission', state: 'done', startedAt: '2026-10-23T09:00:00Z', endedAt: '2026-10-23T09:02:00Z', href: '/dashboard/missions/runs/3', canStop: false }] },
}));

// The pane re-reads the work as the thread's chip does; here it reads the same.
vi.mock('@/libs/Orpc', () => ({ client: { preview: { get: (...args: unknown[]) => get(...args) }, work: { forConversation: vi.fn(async () => view), stop: vi.fn() } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
}));

const { PreviewPane } = await import('./PreviewPane');
const { openPreview, useOpenPreviewRef } = await import('./previewState');

function Host() {
  const ref = useOpenPreviewRef();
  return ref ? <PreviewPane key={`${ref.type}:${ref.id}`} recordRef={ref} /> : <p data-testid="closed">closed</p>;
}

const record = { ref: { type: 'object', id: '16' }, title: 'Decide on intro note to Northwind', sourceLabel: 'Follow-up', body: 'Owed: a short intro note.' };
const work = {
  ref: { type: 'conversation', id: '12.work' },
  title: 'Background work',
  sourceLabel: 'Background work',
  work: { conversationId: 12, view },
};

const start = window.location.href;

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/chat');
  get.mockReset();
  get.mockImplementation(async (ref: Pick<RecordRef, 'type' | 'id'>) => (ref.type === 'object' ? record : work));
});

afterEach(() => {
  window.history.replaceState(null, '', start);
});

describe('a stacked pane', () => {
  it('draws the work in the pane on top of the record, and Back returns to the record', async () => {
    await render(<Host />);
    openPreview({ type: 'object', id: '16' }, null);

    await expect.element(page.getByRole('heading', { name: record.title })).toBeVisible();
    expect(page.getByTestId('preview-stack-back').elements()).toHaveLength(0);

    openPreview({ type: 'conversation', id: '12.work' }, null);

    await expect.element(page.getByRole('heading', { name: 'Background work' })).toBeVisible();
    await expect.element(page.getByTestId('running-work-panel')).toHaveTextContent('Nothing is running.');
    await expect.element(page.getByTestId('work-finished-toggle')).toHaveTextContent('Finished 1');
    await expect.element(page.getByTestId('preview-stack-back')).toHaveAttribute('aria-label', `Back to ${record.title}`);

    await userEvent.click(page.getByTestId('preview-stack-back'));

    await expect.element(page.getByRole('heading', { name: record.title })).toBeVisible();
    expect(page.getByTestId('preview-stack-back').elements()).toHaveLength(0);
  });

  it('close dismisses the whole stack', async () => {
    await render(<Host />);
    openPreview({ type: 'object', id: '16' }, null);
    openPreview({ type: 'conversation', id: '12.work' }, null);

    await expect.element(page.getByTestId('preview-stack-back')).toBeVisible();

    await userEvent.click(page.getByTestId('preview-close'));

    await expect.element(page.getByTestId('closed')).toBeVisible();
  });
});
