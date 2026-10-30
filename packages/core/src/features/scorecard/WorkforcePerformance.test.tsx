import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import { WorkforcePerformance } from './WorkforcePerformance';

const state = vi.hoisted(() => ({ query: '', workspaceSlug: 'revenue', read: vi.fn() }));
vi.mock('@/libs/workspaceSlug', () => ({ useWorkspaceSlug: () => state.workspaceSlug }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/libs/Orpc', () => ({ client: { scorecard: { workforceOverview: state.read } } }));
vi.mock('./WorkforceOutcomes', () => ({ WorkforceOutcomes: () => <div>Outcome review</div> }));

const workspace = {
  id: 'workspace-a',
  slug: 'finance',
  name: 'Finance',
  report: { teams: [{ slug: 'accounts', name: 'Accounts', goal: 'Accurate books' }], agents: [], window: { days: 7 }, coverage: {} },
  outcomes: { complete: true, generatedAt: '2026-10-30T00:00:00Z', items: [], priorities: [] },
};

it('uses shareable workspace links and does not lead with agent activity', async () => {
  state.query = 'days=30';
  state.read.mockResolvedValue({ activeId: 'workspace-a', workspaces: [workspace] });
  await render(<NextIntlClientProvider locale="en" messages={en}><WorkforcePerformance /></NextIntlClientProvider>);

  await expect.element(page.getByRole('heading', { name: 'Useful work. Clear evidence. A next step.' })).toBeVisible();
  await expect.element(page.getByRole('link', { name: /Finance.*0 accepted/ })).toHaveAttribute('href', '/w/finance/dashboard/scorecard?days=30&scope=workspace-a');
  await expect.element(page.getByText('Agents with recorded work', { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByText('No registered work in this scope and window.', { exact: false })).toBeVisible();
});

it('restores team selection from the URL and provides parent breadcrumbs', async () => {
  state.query = 'days=7&scope=workspace-a&team=accounts';
  state.read.mockResolvedValue({ activeId: 'workspace-a', workspaces: [workspace] });
  await render(<NextIntlClientProvider locale="en" messages={en}><WorkforcePerformance /></NextIntlClientProvider>);

  await expect.element(page.getByRole('link', { name: 'Show all teams', exact: true })).toHaveAttribute('href', '/w/finance/dashboard/scorecard?days=7&scope=workspace-a');
  await expect.element(page.getByRole('link', { name: 'All workspaces', exact: true })).toHaveAttribute('href', '/w/finance/dashboard/scorecard?days=7');
});

it('does not silently turn an unknown workspace into an organization total', async () => {
  state.query = 'scope=foreign&team=';
  state.read.mockResolvedValue({ activeId: 'workspace-a', workspaces: [workspace] });
  await render(<NextIntlClientProvider locale="en" messages={en}><WorkforcePerformance /></NextIntlClientProvider>);

  await expect.element(page.getByRole('alert')).toHaveTextContent('This selection is unavailable');
  await expect.element(page.getByText('Accepted work', { exact: true })).not.toBeInTheDocument();
});

it('reloads scope evidence when the canonical workspace changes with the same query', async () => {
  state.query = 'scope=workspace-a&work=item-a';
  state.workspaceSlug = 'revenue';
  const withItem = { ...workspace, outcomes: { ...workspace.outcomes, items: [{ id: 'item-a', title: 'Review this item', agentSlug: 'writer', workflow: 'multi-agent', status: 'open', evidenceChanged: false, firstPassAccepted: null, activeEffortMinutes: null, effortCoverage: 'partial', linked: true, completed: true }] } };
  state.read.mockResolvedValue({ activeId: 'other-workspace', workspaces: [withItem] });
  const screen = await render(<NextIntlClientProvider locale="en" messages={en}><WorkforcePerformance /></NextIntlClientProvider>);

  await expect.element(page.getByText('Review this item', { exact: true })).toBeVisible();
  await expect.element(page.getByText('Outcome review', { exact: true })).not.toBeInTheDocument();

  state.read.mockResolvedValue({ activeId: 'workspace-a', workspaces: [withItem] });
  state.workspaceSlug = 'finance';
  await screen.rerender(<NextIntlClientProvider locale="en" messages={en}><WorkforcePerformance /></NextIntlClientProvider>);

  await expect.element(page.getByText('Outcome review', { exact: true })).toBeVisible();
});
