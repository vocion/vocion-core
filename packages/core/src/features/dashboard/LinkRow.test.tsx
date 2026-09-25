import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * A row that navigates in code still says something happened (backlog 013):
 * the tap reaches the router, and the top progress bar is told, since no link
 * click ever reaches its listener from here.
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const { LinkRow } = await import('./LinkRow');

// Held in consts so the lint rule that wants `<Link />` for a known page route
// does not fire on a fixture: the chip under test IS a plain anchor.
const RECORD = '/dashboard/p/work/12';
const CHIP = '/dashboard/artifacts/4';
const { endNavigation, navigationPending } = await import('./navigationInFlight');

afterEach(() => {
  endNavigation();
  push.mockClear();
});

describe('a table row that is the link', () => {
  it('opens its href on a tap and reports the navigation to the bar', async () => {
    render(
      <table>
        <tbody>
          <LinkRow href={RECORD}>
            <td data-testid="cell">Send has no admin panel</td>
          </LinkRow>
        </tbody>
      </table>,
    );

    await page.getByTestId('cell').click();

    expect(push).toHaveBeenCalledWith(RECORD);
    expect(navigationPending()).toBe(true);
  });

  it('leaves a link inside the row to its own destination', async () => {
    render(
      <table>
        <tbody>
          <LinkRow href={RECORD}>
            <td><a href={CHIP} data-testid="chip" onClick={e => e.preventDefault()}>the brief</a></td>
          </LinkRow>
        </tbody>
      </table>,
    );

    await page.getByTestId('chip').click();

    expect(push).not.toHaveBeenCalled();
  });
});
