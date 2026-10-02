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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock('@/libs/Orpc', () => ({ client: { automations: { pause: vi.fn(), resume: vi.fn() } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { PageBlocks } = await import('./PageBlocks');
const { WatchEmpty } = await import('./WatchEmpty');
const { CheckLogBlock, MonitorsBlock } = await import('./MonitorBlocks');

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

  it('empty, says in one sentence what is watched, where, and what the last check found', async () => {
    render(<WatchEmpty text="No open incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: ['northwind-api', 'northwind-web', 'northwind-site'], state: 'active', lastReadAt: new Date('2026-01-10T12:06:00Z'), lastError: null, lastOutcome: 'quiet', in: 'Sentry' }} />);

    await expect.element(page.getByText('No open incidents.')).toBeVisible();
    await expect.element(page.getByTestId('watch-line')).toHaveTextContent('Watching northwind-api, northwind-web and northwind-site in Sentry; last check 4 minutes ago: quiet.');
  });

  it('empty with a watch pointed at nothing says so instead of looking quiet', async () => {
    render(<WatchEmpty text="No open incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: [], state: 'active', lastReadAt: null, lastError: null, lastOutcome: null, in: null }} />);

    await expect.element(page.getByTestId('watch-line')).toHaveTextContent(/watches nothing yet.*it has not checked yet\./);
  });

  it('empty with a paused watch whose last check could not read says both, and where to fix it', async () => {
    render(<WatchEmpty text="No open incidents." now={NOW} watch={{ name: 'Production errors become incidents', items: ['northwind-api'], state: 'paused', lastReadAt: new Date('2026-01-10T11:00:00Z'), lastError: 'Sentry answered 401', lastOutcome: 'unchecked', in: 'Sentry' }} />);

    await expect.element(page.getByTestId('watch-line')).toHaveTextContent(/Paused by a person.*Its last check could not read: Sentry answered 401/);
    await expect.element(page.getByRole('link', { name: 'Open Automations' })).toHaveAttribute('href', '/dashboard/automations');
  });
});

describe('what is watched, and every check', () => {
  const TZ = 'UTC';

  it('lists each monitor with what it checks, how often, its last check, and Pause', async () => {
    render(
      <MonitorsBlock
        title="What is watched"
        now={NOW}
        timeZone={TZ}
        monitors={[
          { slug: 'error-watch', name: 'Production errors become incidents', every: 'Every 10 minutes (UTC)', state: 'active', pause: null, targets: ['northwind-api', 'northwind-web'], kind: 'Sentry issues', lastCheck: { at: new Date('2026-01-10T12:06:00Z'), outcome: 'quiet', line: 'northwind-api: no errors in the last hour · northwind-web: 2 issues in the last hour, none past the threshold', failed: false }, day: { checks: 144, opened: 0 } },
          { slug: 'environment-health', name: 'Environments stay healthy', every: 'Every 10 minutes (UTC)', state: 'paused', pause: { byName: 'Dana Reyes', when: '10 Jan 11:00 UTC', note: 'migrating DNS' }, targets: [], kind: null, lastCheck: null, day: { checks: 0, opened: 0 } },
        ]}
      />,
    );

    const watch = page.getByTestId('monitor-error-watch');

    await expect.element(watch).toHaveTextContent(/Sentry issues: northwind-api and northwind-web · Every 10 minutes \(UTC\) · 144 checks in 24 h/);
    await expect.element(watch).toHaveTextContent(/Last check 4 minutes ago: northwind-api: no errors in the last hour/);
    await expect.element(watch.getByText('Quiet')).toBeVisible();
    await expect.element(watch.getByRole('button', { name: 'Pause' })).toBeVisible();

    const paused = page.getByTestId('monitor-environment-health');

    await expect.element(paused).toHaveTextContent(/Not checked yet.*Paused by Dana Reyes since 10 Jan 11:00 UTC: migrating DNS/);
    await expect.element(paused.getByRole('button', { name: 'Resume' })).toBeVisible();
  });

  it('logs each check newest first with what it saw, and opens its detail in one tap', async () => {
    render(
      <CheckLogBlock
        title="Checks"
        now={NOW}
        timeZone={TZ}
        rows={[
          { id: 9002, slug: 'environment-health', monitor: 'Environments stay healthy', at: new Date('2026-01-10T12:06:00Z'), finishedAt: new Date('2026-01-10T12:06:01Z'), status: 'ok', outcome: 'quiet', line: 'app.northwind.example: 200 in 312 ms', error: null, check: { kind: 'HTTP health', threshold: 'an HTTP status under 400', outcome: 'quiet', at: '2026-01-10T12:06:01Z', targets: [{ label: 'app.northwind.example', outcome: 'quiet', summary: '200 in 312 ms', observed: { status: 200, latencyMs: 312 }, url: 'https://app.northwind.example/' }] } },
          { id: 9001, slug: 'error-watch', monitor: 'Production errors become incidents', at: new Date('2026-01-10T12:00:00Z'), finishedAt: null, status: 'error', outcome: 'unchecked', line: 'Failed: Sentry answered 401', error: 'Sentry answered 401', check: null },
        ]}
      />,
    );

    const rows = page.getByTestId('check-log-row');

    await expect.element(rows.first()).toHaveTextContent(/12:06.*Environments stay healthy.*Quiet.*app\.northwind\.example: 200 in 312 ms/);
    await expect.element(rows.nth(1)).toHaveTextContent(/Could not check.*Failed: Sentry answered 401/);

    await rows.first().getByRole('button', { name: 'Detail' }).click();

    await expect.element(page.getByTestId('check-target')).toHaveTextContent(/app\.northwind\.example.*200 in 312 ms.*latencyMs\s*312/);
    await expect.element(page.getByText('Threshold: an HTTP status under 400')).toBeVisible();
    expect(document.querySelector('[title]')).toBeNull();
  });
});
