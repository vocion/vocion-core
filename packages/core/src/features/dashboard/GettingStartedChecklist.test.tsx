import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * "Getting started · N of 5": the count and each tick come from the
 * workspace, a step left opens the chat with the lead's ask written, a step
 * done opens where it lives, and a setup card that runs is counted at once.
 */

const gettingStarted = vi.fn(async () => ({ steps: [{ id: 'connect', done: false }, { id: 'app', done: true }, { id: 'hire', done: false }, { id: 'invite', done: false }, { id: 'brand', done: false }], done: 1, total: 5 }));
vi.mock('@/libs/Orpc', () => ({ client: { nav: { gettingStarted } } }));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  usePathname: () => '/dashboard/chat',
}));

const { GettingStartedChecklist, checklistApplies } = await import('./GettingStartedChecklist');
const { SETUP_CHANGED_EVENT } = await import('./setupChanged');

const none = { steps: (['connect', 'app', 'hire', 'invite', 'brand'] as const).map(id => ({ id, done: false })), done: 0, total: 5 };

describe('GettingStartedChecklist', () => {
  it('counts what the workspace has done and re-reads when a setup step runs', async () => {
    const onDismiss = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <GettingStartedChecklist initial={none} onDismiss={onDismiss} />
      </NextIntlClientProvider>,
    );

    // The mount read lands: one step done.
    await expect.element(page.getByTestId('getting-started-count')).toHaveTextContent('Getting started · 1 of 5');
    // One slim row; the steps open beneath it only when asked.
    expect(page.getByTestId('getting-started-app').elements()).toHaveLength(0);

    await page.getByRole('button', { name: /Getting started/ }).click();

    await expect.element(page.getByTestId('getting-started-app')).toHaveAttribute('href', '/dashboard/apps');
    // Connecting opens "Connect your systems" docked above the composer.
    // A prompt, not a shortcut: the person's own ask, sent once as a real turn.
    await expect.element(page.getByTestId('getting-started-connect')).toHaveAttribute('href', `/dashboard/chat?ask=${encodeURIComponent('Help me connect the team connectors this workspace needs')}`);

    gettingStarted.mockResolvedValueOnce({ steps: [{ id: 'connect', done: false }, { id: 'app', done: true }, { id: 'hire', done: true }, { id: 'invite', done: false }, { id: 'brand', done: false }], done: 2, total: 5 });
    window.dispatchEvent(new Event(SETUP_CHANGED_EVENT));

    await expect.element(page.getByTestId('getting-started-count')).toHaveTextContent('Getting started · 2 of 5');

    await page.getByTestId('getting-started-dismiss').click();

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('applies only while a step is left, and only on a new workspace (never an established one)', () => {
    expect(checklistApplies(none)).toBe(true);
    expect(checklistApplies({ ...none, fresh: true })).toBe(true);
    expect(checklistApplies({ ...none, fresh: false })).toBe(false);
    expect(checklistApplies({ ...none, done: 4 })).toBe(true);
    expect(checklistApplies({ ...none, done: 5 })).toBe(false);
    expect(checklistApplies(null)).toBe(false);
  });
});
