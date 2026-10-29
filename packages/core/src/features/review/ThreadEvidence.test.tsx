/**
 * The thread block on a page of the queue, where no whole copy was read: the
 * newest message must still be readable in full, one tap away, never cut to
 * one line with no way to the rest.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ThreadEvidence } from './ThreadEvidence';

const LONG = 'Slow going on the editing pilot, and the board wants another look at the numbers before Friday. A referral call on Friday may open a licensing deal, which changes what we would want from phase 2 entirely.';

describe('the newest message without a whole copy', () => {
  it('stands at two lines with Show all, and Show all reads the rest', async () => {
    await render(<ThreadEvidence subject="Phase 2 priorities" lines={[{ from: 'Rowan Pike <rowan@northwind.example>', at: '2026-10-20T10:00:00Z', line: 'Earlier.' }, { from: 'Dana Reyes <dana@kestrel.example>', at: '2026-10-28T23:20:00Z', line: LONG }]} />);

    const text = page.getByTestId('thread-newest').element().querySelector('p + p') as HTMLElement;

    expect(text.className).toContain('line-clamp-2');
    expect(text.textContent).toBe(LONG);

    await page.getByTestId('thread-newest-toggle').click();

    expect(text.className).not.toContain('line-clamp-2');
    await expect.element(page.getByTestId('thread-newest-toggle')).toHaveTextContent('Show less');
  });

  it('offers no Show all for a message that already fits', async () => {
    await render(<ThreadEvidence lines={[{ from: 'Dana Reyes <dana@kestrel.example>', at: null, line: 'Thanks!' }]} />);

    expect(page.getByTestId('thread-newest-toggle').elements()).toHaveLength(0);
  });
});
