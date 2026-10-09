import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * An empty conversation is a warm hello: the workspace, one line, a few
 * quiet starters, and at most one soft nudge (founder, 2026-10-08).
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { EmptyState } = await import('./EmptyState');
const { WaitingNudge } = await import('./WaitingNudge');

const STARTERS = ['What should I do?', 'What can you do?', 'How is the quarter?', 'Can we ship today?', 'Who is waiting?'].map(label => ({ label, prompt: label }));

beforeEach(() => {
  sessionStorage.clear();
});

describe('EmptyState', () => {
  it('says good afternoon to the person by first name, as the workspace', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EmptyState speaker="Northwind" firstName="Sam" hour={15} onPick={() => {}} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent('Good afternoon, Sam. What can I help with?');
    await expect.element(page.getByTestId('chat-empty-speaker')).toHaveTextContent('Northwind');
  });

  it('greets without a name when it has none', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EmptyState hour={9} onPick={() => {}} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent('Good morning. What can I help with?');
  });

  it('offers at most three quiet starters, and sends the one picked', async () => {
    const onPick = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EmptyState suggestions={STARTERS} onPick={onPick} />
      </NextIntlClientProvider>,
    );

    expect(page.getByRole('button').elements()).toHaveLength(3);
    expect(page.getByText('Can we ship today?').elements()).toHaveLength(0);

    await page.getByRole('button', { name: 'What can you do?' }).click();

    expect(onPick).toHaveBeenCalledWith('What can you do?');
  });

  it('carries one soft nudge to Review, never cards', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <EmptyState onPick={() => {}} nudge={<WaitingNudge count={1} />} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByRole('link', { name: '1 thing waiting on you' })).toHaveAttribute('href', '/dashboard/inbox');
  });
});
