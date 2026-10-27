import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { UserMessage } from './UserMessage';

/**
 * An attached picture opens over the conversation, not in a new tab (Jamie,
 * 2026-10-26). Fixtures are fictional.
 */
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('an attached image', () => {
  it('opens in place with its name and the original one link away, and Esc puts it down', async () => {
    await render(<UserMessage content="The badge should read days." attachments={[{ id: 5244, title: 'time-off.png', contentType: 'image/png', bytes: 2048, url: PIXEL, kind: 'image' }]} />);

    const thumb = page.getByTestId('message-image');

    expect(thumb.element().tagName).toBe('BUTTON');
    expect(document.querySelector('a[target="_blank"] img')).toBeNull();

    await thumb.click();
    const box = page.getByTestId('message-image-lightbox');

    await expect.element(box).toBeVisible();
    await expect.element(box.getByText('time-off.png')).toBeVisible();
    await expect.element(box.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', PIXEL);

    await userEvent.keyboard('{Escape}');

    await expect.element(box).not.toBeInTheDocument();
  });
});
