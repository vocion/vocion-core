import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { __resetToasts, __toasts } from '@/components/ui/toast';
import { AutomationsList } from './AutomationsList';

/**
 * The Automations page's switches (Chris, 2026-10-01): switching one off
 * pauses it through the same route the automation's own page uses, the toast
 * says so with Undo, and Undo resumes it. A paused row says who, when and why
 * on its chip's tooltip; one its workspace file turns off cannot be switched.
 * Fictional Northwind names.
 */

const pause = vi.fn();
const resume = vi.fn();
vi.mock('@/libs/Orpc', () => ({
  client: { automations: { pause: (i: unknown) => pause(i), resume: (i: unknown) => resume(i) } },
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const groups = [{
  key: 'software-factory',
  label: 'Software factory',
  rows: [
    { slug: 'deploy-answer', name: 'A failed deploy is an incident', trigger: 'On run failed', owner: 'Release engineer', last: 'Ran 3 minutes ago', lastFailed: false, state: 'on' as const, pause: null },
    { slug: 'daily-plan', name: 'Plan the day', trigger: 'Every day at 09:00 (UTC)', owner: 'Product manager', last: 'Never ran', lastFailed: false, state: 'paused' as const, pause: { byName: 'Dana Reyes', when: '21 Sep 13:01 UTC', note: 'Hold the ideas' } },
    { slug: 'weekly-review', name: 'Weekly review', trigger: 'Every Monday', owner: null, last: 'Never ran', lastFailed: false, state: 'off' as const, pause: null },
  ],
}];

beforeEach(() => {
  pause.mockReset().mockResolvedValue({});
  resume.mockReset().mockResolvedValue({});
  refresh.mockReset();
  __resetToasts();
});

describe('AutomationsList', () => {
  it('switching one off pauses it, says so with Undo, and Undo resumes it', async () => {
    render(<AutomationsList groups={groups} />);

    await page.getByRole('switch', { name: 'A failed deploy is an incident: on' }).click();

    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith({ slug: 'deploy-answer' }));
    await vi.waitFor(() => expect(__toasts().map(t => t.title)).toEqual(['Paused · A failed deploy is an incident']));

    __toasts()[0]!.action!.onClick();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ slug: 'deploy-answer', note: 'Undo' }));

    expect(refresh).toHaveBeenCalled();
  });

  it('switching a paused one on resumes it; one off in the workspace cannot be switched', async () => {
    render(<AutomationsList groups={groups} />);

    await page.getByRole('switch', { name: 'Plan the day: paused' }).click();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ slug: 'daily-plan' }));

    await expect.element(page.getByRole('switch', { name: 'Weekly review: off in the workspace' })).toBeDisabled();
    // The resumed one counts as on at once, while the page re-reads.
    await expect.element(page.getByText('2 of 3 on')).toBeInTheDocument();
  });
});
