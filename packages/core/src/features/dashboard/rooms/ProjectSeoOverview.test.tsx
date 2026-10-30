import type { SeoAuditRecord } from '@/services/seo/audits';
import type { SeoStrategyMeta } from '@/services/seo/strategy';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/I18nNavigation', () => ({ Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/features/dashboard/context/AskAboutThis', () => ({ AskAboutThis: ({ label }: { label: string }) => <button type="button">{label}</button> }));
const { ProjectSeoOverview } = await import('./ProjectSeoOverview');
const record = { type: 'object' as const, id: '7', label: 'Northwind', objectType: 'data_room' };

describe('project SEO operating overview', () => {
  it('shows missing evidence as missing and keeps every work link project scoped', async () => {
    await render(<ProjectSeoOverview record={record} profile={null} draftReady audit={null} strategy={null} />);

    await expect.element(page.getByText('Set the outcome this client needs')).toBeInTheDocument();
    await expect.element(page.getByText(/No audit available here/)).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Review the prepared profile' })).toHaveAttribute('href', '#seo-profile');
    await expect.element(page.getByRole('link', { name: 'Open pages' })).toHaveAttribute('href', '/dashboard/p/seo-pages?project=7');
    await expect.element(page.getByRole('link', { name: 'Audit history' })).toHaveAttribute('href', '/dashboard/p/seo-audits?project=7');
  });

  it('renders legacy records with absent lists, counts and dates as unknown', async () => {
    const audit = { id: 12, meta: {} } as SeoAuditRecord;
    await render(<ProjectSeoOverview record={record} profile={null} draftReady={false} audit={audit} strategy={{ id: 13, meta: {} as SeoStrategyMeta }} />);

    await expect.element(page.getByText(/Open findings not recorded · Severity count not recorded · Check date not recorded/)).toBeInTheDocument();
    await expect.element(page.getByText('Strategy status not recorded')).toBeInTheDocument();
    await expect.element(page.getByText(/0 open findings/)).not.toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Latest audit' })).toHaveAttribute('href', '/dashboard/objects/12');
  });

  it('does not present invalid legacy counts or dates as measured evidence', async () => {
    const audit = { id: 12, meta: { openCount: -1, highCount: Number.NaN, checkedAt: 'unknown', nextSteps: null } } as unknown as SeoAuditRecord;
    await render(<ProjectSeoOverview record={record} profile={null} draftReady={false} audit={audit} strategy={null} />);

    await expect.element(page.getByText(/Open findings not recorded · Severity count not recorded · Check date not recorded/)).toBeInTheDocument();
  });

  it('shows one dated audit and only unfinished strategy work, without treating a draft as active', async () => {
    const audit = { id: 12, meta: { openCount: 4, highCount: 2, checkedAt: '2026-10-30T12:00:00Z', nextSteps: ['Repair the broken destination'] } } as SeoAuditRecord;
    await render(<ProjectSeoOverview record={record} profile={{ goals: ['organic_leads'] }} draftReady={false} audit={audit} strategy={{ id: 13, meta: { projectId: 7, projectName: 'Northwind', goalTitle: 'More qualified enquiries', horizon: 'Quarter', goalStatus: 'drafted', progressLine: '', updatedAt: '2026-10-30', milestones: [{ label: 'Finished discovery', done: true }, { label: 'Review the page plan', done: false, href: '/dashboard/objects/14' }] } }} />);

    await expect.element(page.getByText('Strategy drafted · awaiting the goal decision')).toBeInTheDocument();
    await expect.element(page.getByText(/4 open findings · 2 high · checked 2026-10-30/)).toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Review the page plan' })).toHaveAttribute('href', '/dashboard/objects/14');
    await expect.element(page.getByText('Finished discovery')).not.toBeInTheDocument();
    await expect.element(page.getByRole('link', { name: 'Review the strategy goal' })).toHaveAttribute('href', '/dashboard/objects/13');
  });
});
