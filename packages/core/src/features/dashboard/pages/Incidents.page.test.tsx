import type { PageField, PageRow } from '@/libs/workspace/pages';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * Production Watch's Incidents page (Chris, 2026-10-01: "it has no visible
 * pages. Should it?"): each card names the tracker's issue by its short id,
 * linked, and an empty page says what the watch watches and when it last
 * read. Fixture rows; every name is invented.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { PageBlocks } = await import('./PageBlocks');
const { WatchEmpty } = await import('./WatchEmpty');

const f = (over: Partial<PageField> & { key: string }): PageField => ({ format: 'text', total: false, priority: 1, hideWhenConstant: false, hideWhenEmpty: true, detail: false, ...over } as PageField);
const FIELDS = [
  f({ key: 'title', from: 'title' }),
  f({ key: 'issue', label: 'Sentry issue', from: 'meta.url', format: 'link', labelFrom: 'meta.shortId' }),
  f({ key: 'events', label: 'Events', from: 'meta.events' }),
  f({ key: 'cause', label: 'Cause', from: 'meta.cause', format: 'badge', tones: { deploy: 'bad' }, caption: { from: 'meta.causeWhy', format: 'text' } }),
];
const ROW: PageRow = { id: 412, code: 'INC-412', title: 'Rooms API answers 500 on every signed-in call', status: 'active', createdAt: null, meta: { url: 'https://northwind.sentry.io/issues/77/', shortId: 'NW-API-3', events: 184, cause: 'deploy', causeWhy: 'First seen in 0a1b2c, minutes after it deployed.', status: 'open' } };
const NOW = Date.parse('2026-01-10T12:10:00Z');

describe('the Incidents page', () => {
  it('names the issue by its short id, linked to the tracker, with the cause and its why', async () => {
    render(<PageBlocks rows={[ROW]} fields={FIELDS} primary={{ field: 'title', subtitle: ['issue'] }} rowLink="/dashboard/objects/{id}" now={NOW} />);

    await expect.element(page.getByRole('link', { name: 'NW-API-3', exact: true })).toHaveAttribute('href', 'https://northwind.sentry.io/issues/77/');
    // The card is not one big link around it: its title opens the incident.
    await expect.element(page.getByTestId('block-title-link')).toHaveAttribute('href', '/dashboard/objects/412');
    await expect.element(page.getByText('INC-412')).toBeVisible();
    await expect.element(page.getByText('First seen in 0a1b2c, minutes after it deployed.')).toBeVisible();

    expect(document.querySelector('a[title]')).toBeNull();
  });

  it('empty, says what the watch watches and when it last read', async () => {
    render(<WatchEmpty text="No incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: ['northwind-api', 'northwind-web'], state: 'active', lastReadAt: new Date('2026-01-10T12:00:00Z'), lastError: null }} />);

    await expect.element(page.getByText('No incidents.')).toBeVisible();
    await expect.element(page.getByText('Production errors become incidents watches northwind-api, northwind-web.')).toBeVisible();
    await expect.element(page.getByTestId('watch-line')).toHaveTextContent(/Last read 10m ago\./);
  });

  it('empty with a watch pointed at nothing says so instead of looking quiet', async () => {
    render(<WatchEmpty text="No incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: [], state: 'active', lastReadAt: null, lastError: null }} />);

    await expect.element(page.getByTestId('watch-line')).toHaveTextContent(/watches nothing yet.*It has not read yet\./);
  });

  it('empty with a paused watch whose last read failed says both, and where to fix it', async () => {
    render(<WatchEmpty text="No incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: ['northwind-api'], state: 'paused', lastReadAt: new Date('2026-01-10T11:00:00Z'), lastError: 'Sentry answered 401' }} />);

    await expect.element(page.getByTestId('watch-line')).toHaveTextContent(/Paused by a person.*Its last read failed: Sentry answered 401/);
    await expect.element(page.getByRole('link', { name: 'Open Automations' })).toHaveAttribute('href', '/dashboard/automations');
  });
});
