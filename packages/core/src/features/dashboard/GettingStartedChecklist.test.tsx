import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * "Getting started · N of 4": the count and each tick come from the
 * workspace, a step left opens the chat with the lead's ask written, a step
 * done opens where it lives, and a setup card that runs is counted at once.
 */

const gettingStarted = vi.fn(async () => ({ steps: [{ id: 'connect', done: false }, { id: 'app', done: true }, { id: 'hire', done: false }, { id: 'invite', done: false }], done: 1, total: 4 }));
vi.mock('@/libs/Orpc', () => ({ client: { nav: { gettingStarted } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/dashboard/chat',
}));

const { GettingStartedChecklist, checklistApplies } = await import('./GettingStartedChecklist');
const { SETUP_CHANGED_EVENT } = await import('./chat/cards/SetupCard');

const none = { steps: (['connect', 'app', 'hire', 'invite'] as const).map(id => ({ id, done: false })), done: 0, total: 4 };

describe('GettingStartedChecklist', () => {
  it('counts what the workspace has done and re-reads when a setup step runs', async () => {
    const onDismiss = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <GettingStartedChecklist initial={none} onDismiss={onDismiss} />
      </NextIntlClientProvider>,
    );

    // The mount read lands: one step done.
    await expect.element(page.getByTestId('getting-started-count')).toHaveTextContent('Getting started · 1 of 4');
    await expect.element(page.getByTestId('getting-started-app')).toHaveAttribute('href', '/dashboard/apps');
    await expect.element(page.getByTestId('getting-started-connect')).toHaveAttribute('href', `/dashboard/chat?prompt=${encodeURIComponent('I want to connect a system.')}`);

    gettingStarted.mockResolvedValueOnce({ steps: [{ id: 'connect', done: false }, { id: 'app', done: true }, { id: 'hire', done: true }, { id: 'invite', done: false }], done: 2, total: 4 });
    window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));

    await expect.element(page.getByTestId('getting-started-count')).toHaveTextContent('Getting started · 2 of 4');

    await page.getByTestId('getting-started-dismiss').click();

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('applies only while a step is left', () => {
    expect(checklistApplies(none)).toBe(true);
    expect(checklistApplies({ ...none, done: 4 })).toBe(false);
    expect(checklistApplies(null)).toBe(false);
  });
});
