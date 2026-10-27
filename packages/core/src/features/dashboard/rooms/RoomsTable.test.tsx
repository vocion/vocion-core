import type { RoomRow } from './roomRows';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { RoomsTable } = await import('./RoomsTable');

const NOW = Date.parse('2026-10-23T18:00:00Z');

const ROWS: RoomRow[] = [
  { id: 1, title: 'Wren Logistics — Dispatch', segments: ['Wren Logistics', 'deal'], sources: 4, mustRead: 1, updatedAt: '2026-10-23T16:00:00.000Z', stage: 'Proposal Sent' },
  { id: 2, title: 'Acorn Builders — Estimating', segments: ['Acorn Builders'], sources: 12, mustRead: 3, updatedAt: '2026-09-02T00:00:00.000Z', stage: 'Discovery' },
];
const HREFS = { 1: '/dashboard/projects/1', 2: '/dashboard/projects/2' };

const titles = () => page.getByTestId('rooms-table').element().querySelectorAll('[data-slot="row-title"]');

describe('the Projects table (Chris, 2026-10-23)', () => {
  // The sort lives in the address; each test starts from a clean one.
  beforeEach(() => {
    history.replaceState(null, '', location.pathname);
  });

  it('names its columns and opens sorted by project title', async () => {
    await render(<RoomsTable rows={ROWS} hrefs={HREFS} now={NOW} />);

    for (const name of ['Project', 'Sources', 'Must-read', 'Last updated', 'Stage']) {
      await expect.element(page.getByRole('columnheader', { name })).toBeInTheDocument();
    }

    await expect.element(page.getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'ascending');
    expect([...titles()].map(t => t.textContent)).toEqual(['Acorn Builders — Estimating', 'Wren Logistics — Dispatch']);
    // Recent reads relative; the full time is on hover.
    await expect.element(page.getByText('2h ago')).toBeInTheDocument();
  });

  it('sorts by Last updated, newest first, and a second click reverses it', async () => {
    await render(<RoomsTable rows={ROWS} hrefs={HREFS} now={NOW} />);

    await page.getByRole('button', { name: 'Last updated' }).click();

    await expect.element(page.getByRole('columnheader', { name: 'Last updated' })).toHaveAttribute('aria-sort', 'descending');
    expect([...titles()].map(t => t.textContent)).toEqual(['Wren Logistics — Dispatch', 'Acorn Builders — Estimating']);

    await page.getByRole('button', { name: 'Last updated' }).click();

    await expect.element(page.getByRole('columnheader', { name: 'Last updated' })).toHaveAttribute('aria-sort', 'ascending');
    expect([...titles()].map(t => t.textContent)).toEqual(['Acorn Builders — Estimating', 'Wren Logistics — Dispatch']);
  });
});
