/**
 * The one rename-in-place control (`InlineTitle`): click the name, type,
 * Enter saves and Escape puts the old name back — the contract the chat
 * header, the rail and the Conversations list all rely on.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { InlineTitle } from './inline-title';

async function renderTitle() {
  const onRename = vi.fn();
  await render(<InlineTitle value="Northwind renewal" onRename={onRename} label="Rename conversation" inputLabel="Conversation title" testId="t" />);
  return onRename;
}

describe('InlineTitle', () => {
  it('shows the name as a button, never with a native title attribute', async () => {
    await renderTitle();
    const button = page.getByRole('button', { name: 'Rename conversation: Northwind renewal' });

    await expect.element(button).toBeVisible();
    await expect.element(button).not.toHaveAttribute('title');
  });

  it('Enter saves the new name, whitespace collapsed', async () => {
    const onRename = await renderTitle();

    await userEvent.click(page.getByTestId('t'));
    const field = page.getByRole('textbox', { name: 'Conversation title' });

    await expect.element(field).toHaveFocus();

    await userEvent.fill(field, '  Kestrel   renewal ');
    await userEvent.keyboard('{Enter}');

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Kestrel renewal');
    await expect.element(page.getByTestId('t')).toBeVisible();
  });

  it('Escape cancels, and an unchanged or empty name saves nothing', async () => {
    const onRename = await renderTitle();

    await userEvent.click(page.getByTestId('t'));
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), 'Something else');
    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('button', { name: 'Rename conversation: Northwind renewal' })).toBeVisible();

    await userEvent.click(page.getByTestId('t'));
    await userEvent.fill(page.getByRole('textbox', { name: 'Conversation title' }), '   ');
    await userEvent.keyboard('{Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });
});
