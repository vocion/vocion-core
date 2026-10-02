import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { ChatHeaderActions } = await import('./ChatHeaderActions');

describe('the rail opens its thread on the full chat page', () => {
  it('links the thread when a page gives one', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ChatHeaderActions onNewChat={() => {}} history={null} fullPageHref="/dashboard/chat/378" />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByRole('link', { name: 'Open in full chat' })).toHaveAttribute('href', '/dashboard/chat/378');
  });

  it('shows no link where none is given (the full page itself)', async () => {
    const screen = await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ChatHeaderActions onNewChat={() => {}} history={null} />
      </NextIntlClientProvider>,
    );

    expect(screen.container.querySelector('[data-testid="open-full-chat"]')).toBeNull();
  });
});

describe('New chat focuses the box of the surface it sits in (Chris, 2026-09-29)', () => {
  it('lands the caret in its own surface\'s composer, not another on the page', async () => {
    const onNewChat = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <div>
          <textarea data-agent-composer aria-label="other surface" />
        </div>
        <div>
          <ChatHeaderActions onNewChat={onNewChat} history={null} />
          <textarea data-agent-composer aria-label="this surface" />
        </div>
      </NextIntlClientProvider>,
    );

    await page.getByRole('button', { name: 'New chat' }).click();

    expect(onNewChat).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole('textbox', { name: 'this surface' })).toHaveFocus();
  });
});
