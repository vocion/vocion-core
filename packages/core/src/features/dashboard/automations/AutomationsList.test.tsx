import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { __resetToasts, __toasts } from '@/components/ui/toast';
import { AutomationsList } from './AutomationsList';

/**
 * The Automations register's switches (Chris, 2026-10-01): switching one off
 * pauses it through the same route the automation's own page uses, the toast
 * says so with Undo, and Undo resumes it. A paused row says who, when and why
 * on its chip's tooltip; one its workspace file turns off cannot be switched.
 * The app filter and "Show system schedules" write the URL (2026-10-29).
 * Fictional Northwind names.
 */

const pause = vi.fn();
const resume = vi.fn();
vi.mock('@/libs/Orpc', () => ({
  client: { automations: { pause: (i: unknown) => pause(i), resume: (i: unknown) => resume(i) } },
}));
const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const app = { app: 'Software Factory', appKey: 'software-factory', system: false };
const rows = [
  { slug: 'deploy-answer', name: 'A failed deploy is an incident', ...app, trigger: 'On run failed', owner: 'Release engineer', last: 'Ran 3 minutes ago', lastFailed: false, state: 'on' as const, pause: null },
  { slug: 'daily-plan', name: 'Plan the day', ...app, trigger: 'Every day at 09:00 (UTC)', owner: 'Product manager', last: 'Never ran', lastFailed: false, state: 'paused' as const, pause: { byName: 'Dana Reyes', when: '21 Sep 13:01 UTC', note: 'Hold the ideas' } },
  { slug: 'weekly-review', name: 'Weekly review', ...app, trigger: 'Every Monday', owner: null, last: 'Never ran', lastFailed: false, state: 'off' as const, pause: null },
];
const filter = {
  apps: [{ key: 'software-factory', label: 'Software Factory', count: 3 }, { key: 'seo', label: 'Search Engine Optimization', count: 1 }],
  selected: '',
  systemHidden: 1,
  canShowSystem: true,
  showSystem: false,
};

beforeEach(() => {
  pause.mockReset().mockResolvedValue({});
  resume.mockReset().mockResolvedValue({});
  refresh.mockReset();
  replace.mockReset();
  __resetToasts();
});

describe('AutomationsList', () => {
  it('switching one off pauses it, says so with Undo, and Undo resumes it', async () => {
    render(<AutomationsList rows={rows} />);

    await page.getByRole('switch', { name: 'A failed deploy is an incident: on' }).click();

    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith({ slug: 'deploy-answer' }));
    await vi.waitFor(() => expect(__toasts().map(t => t.title)).toEqual(['Paused · A failed deploy is an incident']));

    __toasts()[0]!.action!.onClick();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ slug: 'deploy-answer', note: 'Undo' }));

    expect(refresh).toHaveBeenCalled();
  });

  it('switching a paused one on resumes it; one off in the workspace cannot be switched', async () => {
    render(<AutomationsList rows={rows} />);

    await page.getByRole('switch', { name: 'Plan the day: paused' }).click();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ slug: 'daily-plan' }));

    await expect.element(page.getByRole('switch', { name: 'Weekly review: off in the workspace' })).toBeDisabled();
    // The resumed one counts as on at once, while the page re-reads.
    await expect.element(page.getByText('2 of 3 on')).toBeInTheDocument();
  });

  it('filters by app from a chip, and an admin shows the system automations, both in the URL', async () => {
    render(<AutomationsList rows={rows} filter={filter} />);

    await expect.element(page.getByRole('link', { name: /A failed deploy is an incident/ })).toHaveAttribute('href', '/dashboard/schedules/deploy-answer');
    await expect.element(page.getByRole('button', { name: 'Show system schedules (1)' })).toBeInTheDocument();

    // Each row names its app on the register.
    await expect.element(page.getByTestId('automation-row-deploy-answer')).toHaveTextContent('Software Factory');

    await page.getByRole('button', { name: /^Search Engine Optimization/ }).click();

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(/[?&]app=seo$/)));

    await page.getByTestId('automations-show-system').click();

    await vi.waitFor(() => expect(replace).toHaveBeenLastCalledWith(expect.stringMatching(/[?&]system=1$/)));
  });

  it('inside an app\'s own panel the rows do not repeat the app\'s name, and there is no filter', async () => {
    render(<AutomationsList rows={rows} showApp={false} />);

    await expect.element(page.getByTestId('automation-row-deploy-answer')).not.toHaveTextContent('Software Factory');
    await expect.element(page.getByTestId('automations-show-system')).not.toBeInTheDocument();
  });
});

it('names the empty surface schedules and explains event-trigger support', async () => {
  render(<AutomationsList rows={[]} />);

  await expect.element(page.getByText('No schedules in this workspace yet.')).toBeInTheDocument();
  await expect.element(page.getByText(/Schedules start work at a set time or when an event occurs/)).toBeInTheDocument();
});
