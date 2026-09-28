/**
 * A row on /dashboard/conversations: the thread's title as a link into it,
 * and a pencil that renames it in place with the header's own field.
 */
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import en from '@/locales/en.json';

vi.mock('@/libs/Orpc', () => ({
  client: { conversations: { rename: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { client } = await import('@/libs/Orpc');
const { ConversationListRow } = await import('./ConversationListRow');

function renderRow() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConversationListRow id={12} title="Northwind renewal status" snippet={null} meta="2 messages" time="9:30 AM" surface="app" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(client.conversations.rename).mockReset().mockResolvedValue({} as never);
});

describe('ConversationListRow', () => {
  it('shows the thread title as a link into the thread', async () => {
    await renderRow();

    await expect.element(page.getByTestId('conversation-row-name')).toHaveTextContent('Northwind renewal status');
    await expect.element(page.getByRole('link')).toHaveAttribute('href', '/dashboard/chat/12');
  });

  it('renames in place from the pencil, and keeps the new name', async () => {
    await renderRow();

    await userEvent.click(page.getByTestId('conversation-row-rename'));
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), 'Northwind renewal plan');
    await userEvent.keyboard('{Enter}');

    expect(vi.mocked(client.conversations.rename)).toHaveBeenCalledWith({ id: 12, title: 'Northwind renewal plan' });
    await expect.element(page.getByTestId('conversation-row-name')).toHaveTextContent('Northwind renewal plan');
  });

  it('puts the old name back when the write fails', async () => {
    vi.mocked(client.conversations.rename).mockRejectedValue(new Error('offline'));
    await renderRow();

    await userEvent.click(page.getByTestId('conversation-row-rename'));
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), 'Lost name');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('conversation-row-name')).toHaveTextContent('Northwind renewal status');
  });
});
