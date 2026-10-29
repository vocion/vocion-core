import type { DashboardSpec } from '@/libs/dashboards/spec';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { dashboardSpecSchema } from '@/libs/dashboards/spec';
import { DashboardCardView } from './dashboard';
import '@/styles/global.css';

/**
 * The dashboard as people read it: the lead, where the numbers come from,
 * figures coloured by whether the move is good news, charts side by side,
 * tabs. Fictional (Northwind, the fixtures cast). Screenshots land in
 * `VITE_SHOTS_DIR` when it is set, for a look at light and dark.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

const SHOTS = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;
const shotTo = async (name: string) => {
  if (SHOTS) {
    await new Promise(r => setTimeout(r, 400));
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
};

const months = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

const NORTHWIND: DashboardSpec = dashboardSpecSchema.parse({
  title: 'Northwind executive view',
  summary: 'Revenue was **$454.3K** in September, down 14% on August, with an operating result of **−$48.1K**. Open pipeline is **$992.2K** weighted. **12 of 23** workstreams are at risk or blocked.',
  sources: 'Finance from the ledger P&L (accrual) and pipeline from CRM deals, read daily at 8am. Initiatives from the initiative tracker, weekly; status is a judgement call.',
  asOf: '2026-10-29',
  refresh: { cadence: 'daily', method: '**Revenue**: ledger P&L by month, accrual, closed months.\n\n**Pipeline**: open CRM deals, amount × stage probability.' },
  tabs: [
    {
      label: 'Overview',
      sections: [
        {
          title: 'Company snapshot',
          note: 'Monthly figures are the latest closed month; the current month is shown separately as month to date.',
          blocks: [
            {
              type: 'stats',
              items: [
                { label: 'Revenue', value: 454_300, format: 'currency', delta: { value: -14, format: 'percent', against: 'vs August', better: 'up' }, note: 'Sep 2026', source: 'Ledger P&L, accrual' },
                { label: 'Gross margin', value: 31, format: 'percent', delta: { value: -27, format: 'number', against: 'pts vs August', better: 'up' }, target: { value: 60 }, note: 'Sep 2026' },
                { label: 'Operating income', value: -48_100, format: 'currency', note: 'Sep 2026, before tax and interest' },
                { label: 'Revenue, last 12 months', value: 4_700_000, format: 'currency', note: '$672.8K booked so far in Oct' },
                { label: 'Weighted pipeline', value: 992_200, format: 'currency', note: '$2.7M open across 44 deals', source: 'CRM deals' },
                { label: 'Board commitments done', value: null, display: '1 / 5', note: 'Q3 deliverables' },
              ],
            },
            { type: 'chart', chart: { title: 'Revenue held between $350K and $530K a month', type: 'bar', x: months, series: [{ name: 'Revenue', values: [352_000, 408_000, 395_000, 330_000, 322_000, 340_000, 362_000, 401_000, 398_000, 528_000, 454_300, 672_800] }], partialLast: true, format: 'currency', source: 'Ledger P&L, accrual', asOf: '2026-10-29' } },
            { type: 'chart', chart: { title: 'Margin fell to 31% once salaries moved into cost of sales', type: 'line', x: months.slice(0, 11), series: [{ name: 'Gross margin', values: [62, 61, 61, 52, 57, 63, 59, 58, 59, 66, 31] }], targets: [{ value: 60, label: 'Target' }], format: 'percent', source: 'Ledger P&L, accrual', asOf: '2026-10-29' } },
          ],
        },
      ],
    },
    {
      label: 'Initiatives',
      sections: [{ title: 'Initiatives, ranked', note: 'Status and next actions are judgement calls.', blocks: [{ type: 'table', table: { columns: [{ key: 'name', label: 'Initiative' }, { key: 'score', label: 'Impact score', type: 'number' }, { key: 'status', label: 'Status', type: 'badge' }], rows: [{ name: 'Service expansion', score: 15, status: 'at risk' }, { name: 'Delivery model', score: 12, status: 'blocked' }] } }] }],
    },
  ],
});

describe('the dashboard view', () => {
  it('leads with the summary, dates it, offers Refresh, and colours a fall as bad news', async () => {
    const screen = await render(<div className="w-[1280px] bg-background p-8 text-foreground"><DashboardCardView data={{ ...NORTHWIND, __artifactId: 42 }} surface="artifact" /></div>);

    await expect.element(screen.getByText('As of Oct 29, 2026 · refreshed daily')).toBeVisible();
    await expect.element(screen.getByText('$454.3k', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('1 / 5')).toBeVisible();
    await expect.element(screen.getByRole('tab', { name: 'Initiatives' })).toBeVisible();

    const refresh = screen.getByTestId('dashboard-refresh');

    expect(refresh.element().getAttribute('href')).toContain(encodeURIComponent('artifact #42'));

    await shotTo('dashboard-light');
    document.documentElement.classList.add('dark');
    await shotTo('dashboard-dark');
    document.documentElement.classList.remove('dark');
  });

  it('shows the lead and the first figures in a chat card', async () => {
    const screen = await render(<div className="w-[460px] bg-background p-4 text-foreground"><DashboardCardView data={NORTHWIND} surface="chat" /></div>);

    await expect.element(screen.getByText('Northwind executive view')).toBeVisible();
    await expect.element(screen.getByText('Revenue', { exact: true })).toBeVisible();

    await shotTo('dashboard-chat');
  });
});
