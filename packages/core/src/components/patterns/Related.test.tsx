import type { RelatedItem } from '@/libs/workspace/related';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const { Related } = await import('./Related');

/**
 * The Related block (Chris, 2026-09-30): one row per relation, each item a
 * link to its full page with "Open in preview" beside it; an outside link
 * opens a new tab and has no preview. Fixture records, fictional.
 */

function item(over: Partial<RelatedItem>): RelatedItem {
  return { key: 'k', relation: 'r', label: 'L', title: 'T', href: '/dashboard/objects/1', external: false, preview: { type: 'object', id: '1' }, kind: 'record', note: null, at: null, ...over };
}

const ITEMS: RelatedItem[] = [
  item({ key: 'origin', relation: 'origin', label: 'Started in chat', title: 'Share menu PDF export', href: '/dashboard/chat?c=812', preview: { type: 'conversation', id: '812' }, kind: 'conversation', note: 'Dana Reyes' }),
  item({ key: 'plan', relation: 'plans', label: 'Plan', title: '#302 Render the room to PDF', href: '/dashboard/objects/302', preview: { type: 'object', id: '302' } }),
  item({ key: 'run-1', relation: 'runs', label: 'Engineering runs', title: 'Run #431', href: '/dashboard/p/runs/431', preview: { type: 'worker_run', id: '431' }, kind: 'run', note: 'failed' }),
  item({ key: 'run-2', relation: 'runs', label: 'Engineering runs', title: 'Run #435', href: '/dashboard/p/runs/435', preview: { type: 'worker_run', id: '435' }, kind: 'run', note: 'running' }),
  item({ key: 'pr', relation: 'pulls', label: 'Pull requests', title: 'PR #27', href: 'https://github.com/example/northwind-portal/pull/27', external: true, preview: null, kind: 'link' }),
];

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/p/feature/301');
});

describe('the Related block', () => {
  it('draws one row per relation, the chat that started it first', async () => {
    render(<Related items={ITEMS} />);

    await expect.element(page.getByTestId('related')).toBeVisible();

    const labels = [...document.querySelectorAll('[data-pattern="related"] dt')].map(d => d.textContent);

    expect(labels).toEqual(['Started in chat', 'Plan', 'Engineering runs', 'Pull requests']);
    await expect.element(page.getByRole('link', { name: 'Share menu PDF export' })).toHaveAttribute('href', '/dashboard/chat?c=812');
  });

  it('carries "Open in preview" on each record, and opens it in the pane', async () => {
    render(<Related items={ITEMS} />);

    await expect.element(page.getByRole('link', { name: '#302 Render the room to PDF' })).toBeVisible();

    await userEvent.hover(page.getByRole('link', { name: '#302 Render the room to PDF' }));
    await userEvent.click(page.getByRole('button', { name: 'Open in preview' }).nth(1));

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('object:302');

    // Several items in a row: one beside each.
    await userEvent.click(page.getByRole('button', { name: 'Open Run #435 in preview' }));

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('worker_run:435');
  });

  it('opens an outside link in a new tab, with no preview', async () => {
    render(<Related items={ITEMS} />);

    await expect.element(page.getByRole('link', { name: 'PR #27' })).toHaveAttribute('target', '_blank');

    expect(document.querySelector('[data-fact="related:pulls"] [data-testid="open-in-preview"]')).toBeNull();
  });

  it('draws nothing when a record is connected to nothing', async () => {
    render(<Related items={[]} />);

    expect(document.querySelector('[data-testid="related"]')).toBeNull();
  });
});
