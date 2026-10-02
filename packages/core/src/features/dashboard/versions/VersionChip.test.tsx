import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { VersionChip } from './VersionChip';

/**
 * One chip for a record's version (Chris, 2026-09-30, feature #269): it says
 * the version, opens the record's history in the pane, and carries the page's
 * re-read while the page is live. Fixture record, fictional.
 */

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/p/feature/41');
});

afterEach(() => {
  refresh.mockReset();
});

describe('the version chip', () => {
  it('shows the version and opens the record\'s history in the pane', async () => {
    render(<VersionChip objectId={41} version={3} updatedAt={new Date(Date.now() - 120_000).toISOString()} />);

    const chip = page.getByTestId('record-version-chip');

    await expect.element(chip).toHaveTextContent('v3');
    await expect.element(chip).toHaveAttribute('data-live', 'off');

    await userEvent.click(chip);

    expect(new URLSearchParams(window.location.search).get('preview')).toBe('record_history:41');
  });

  it('says when it was updated, in a Tooltip', async () => {
    render(<VersionChip objectId={41} version={3} updatedAt={new Date(Date.now() - 120_000).toISOString()} />);

    await userEvent.hover(page.getByTestId('record-version-chip'));

    await expect.element(page.getByRole('tooltip')).toHaveTextContent(/^History · updated 2m ago$/);
  });

  it('carries the live dot and the page\'s re-read while the page is live', async () => {
    render(<VersionChip objectId={41} version={1} live={{ everyMs: 60 }} />);

    await expect.element(page.getByTestId('record-version-chip')).toHaveAttribute('data-live', 'on');
    await expect.poll(() => refresh.mock.calls.length).toBeGreaterThan(0);
  });
});
