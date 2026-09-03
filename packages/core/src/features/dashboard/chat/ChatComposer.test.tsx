import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ChatComposer } from './ChatComposer';
import { UserMessage } from './UserMessage';

const LONG_PASTE = 'From: client@example.com\n'.repeat(40); // ~1000 chars

function pasteInto(el: Element, text: string) {
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}

describe('ChatComposer pasted chip', () => {
  it('a large paste becomes a chip instead of flooding the box', async () => {
    const onPasteText = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onPasteText={onPasteText} />,
    );

    const textarea = page.getByRole('textbox');
    pasteInto(await textarea.element(), LONG_PASTE);

    expect(onPasteText).toHaveBeenCalledWith(LONG_PASTE);
  });

  it('a short paste stays a normal paste', async () => {
    const onPasteText = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} onPasteText={onPasteText} />,
    );

    pasteInto(await page.getByRole('textbox').element(), 'just a sentence');

    expect(onPasteText).not.toHaveBeenCalled();
  });

  it('the chip renders with the PASTED tag and its remove control clears it', async () => {
    const onClearPasted = vi.fn();
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} pastedText={LONG_PASTE} onClearPasted={onClearPasted} />,
    );

    await expect.element(page.getByText('Pasted')).toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Remove pasted content' }));

    expect(onClearPasted).toHaveBeenCalled();
  });

  it('pasted content alone arms the send button', async () => {
    await render(
      <ChatComposer value="" onChange={() => {}} onSubmit={() => {}} pastedText={LONG_PASTE} />,
    );

    await expect.element(page.getByRole('button', { name: 'Send message' })).not.toBeDisabled();
  });
});

describe('UserMessage clamp', () => {
  it('long content clamps behind Show more and expands on demand', async () => {
    const content = `please review this\n${'x'.repeat(700)}END_MARKER`;
    await render(<UserMessage content={content} />);

    await expect.element(page.getByText('END_MARKER', { exact: false })).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: 'Show more' }));

    await expect.element(page.getByText('END_MARKER', { exact: false })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('short content renders without a control', async () => {
    await render(<UserMessage content="why day 6?" />);

    await expect.element(page.getByText('why day 6?')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });
});
