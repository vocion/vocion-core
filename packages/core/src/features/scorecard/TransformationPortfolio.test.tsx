import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import { TransformationPortfolio } from './TransformationPortfolio';
import '@/styles/global.css';

const state = vi.hoisted(() => ({ save: vi.fn(), history: vi.fn() }));
vi.mock('@/libs/Orpc', () => ({ client: { scorecard: { savePortfolio: state.save, portfolioHistory: state.history } } }));
vi.mock('@/libs/I18nNavigation', () => ({ Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
const workspace = {
  id: 'workspace-a',
  name: 'Finance',
  slug: 'finance',
  report: { teams: [], agents: [] },
  outcomes: { items: [] },
  portfolio: { complete: true, workflows: [] },
} as unknown as Parameters<typeof TransformationPortfolio>[0]['workspaces'][number];
const refresh = vi.fn();
function view(selected = true) {
  return <NextIntlClientProvider locale="en" messages={en}><TransformationPortfolio workspaces={[workspace]} selected={selected ? workspace : undefined} activeId="workspace-a" team={null} days={7} refresh={refresh} /></NextIntlClientProvider>;
}

it('registers an explicit business workflow and refreshes the persisted overview', async () => {
  state.save.mockResolvedValue({ id: 'new', version: 0 });
  await render(view());
  await page.getByRole('button', { name: 'Add business workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Business workflow name', exact: true }).fill('Invoice classification');
  await page.getByRole('textbox', { name: 'Accountable owner', exact: true }).fill('Finance owner');
  await page.getByRole('textbox', { name: 'Business objective', exact: true }).fill('Close the books accurately');
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();

  await expect.poll(() => state.save.mock.calls.length).toBe(1);
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({ version: -1, itemIds: [], data: { name: 'Invoice classification', owner: 'Finance owner', stage: 'discovery', objective: 'Close the books accurately' } });
  expect(state.save.mock.calls[0]?.[0]).not.toHaveProperty('orgId');
  expect(refresh).toHaveBeenCalled();
  await expect.element(page.getByRole('status')).toHaveTextContent('Workflow and improvement history saved.');
});

it('keeps failed edits available and does not claim a save succeeded', async () => {
  state.save.mockRejectedValue(new Error('Workflow changed. Reload before saving.'));
  await render(view());
  await page.getByRole('button', { name: 'Add business workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Business workflow name', exact: true }).fill('Weekly briefing');
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();

  await expect.element(page.getByRole('alert')).toHaveTextContent('Workflow changed. Reload before saving.');
  await expect.element(page.getByRole('textbox', { name: 'Business workflow name', exact: true })).toHaveValue('Weekly briefing');
});

it('does not offer mutations on the organization overview', async () => {
  await render(view(false));

  await expect.element(page.getByRole('button', { name: 'Add business workflow', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByText('Organization summaries are read-only.', { exact: false })).toBeVisible();
});

it('renders rollout and evidence at desktop and phone widths', async () => {
  const populated = structuredClone(workspace);
  populated.portfolio.workflows = [{ id: 'workflow', orgId: 'workspace-a', version: 0, updatedAt: new Date(), itemIds: [], data: { name: 'Invoice classification', objective: 'Reduce month-end rework while maintaining accurate books.', owner: 'Finance operations', stage: 'pilot', teamSlug: null, baseline: 'Timed manual sample pending', expectedBenefit: 'Shorter close cycle', successMeasure: 'At least 95% first-pass acceptance', improvements: [] } }];
  await render(<NextIntlClientProvider locale="en" messages={en}><div className="mx-auto max-w-6xl bg-background p-6 text-foreground"><TransformationPortfolio workspaces={[populated]} selected={populated} activeId="workspace-a" team={null} days={7} refresh={refresh} /></div></NextIntlClientProvider>);

  await expect.element(page.getByRole('heading', { name: 'Invoice classification' })).toBeVisible();
  await expect.element(page.getByText('Connect real work before judging performance', { exact: true })).toBeVisible();

  const shots = (import.meta.env as unknown as Record<string, string | undefined>).VITE_SHOTS_DIR;
  if (shots) {
    await page.screenshot({ path: `${shots}/workforce-portfolio-desktop.png` });
  }
  await page.viewport(390, 844);

  await expect.element(page.getByRole('button', { name: 'Edit workflow', exact: true })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

  if (shots) {
    await page.screenshot({ path: `${shots}/workforce-portfolio-phone.png` });
  }
  await page.viewport(1440, 900);
});
