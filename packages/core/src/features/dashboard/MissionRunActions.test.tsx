import { ORPCError } from '@orpc/client';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { MissionRunActions } from './MissionRunActions';

/**
 * A mission run can now lose a race — a second reviewer, or a second tab,
 * approving the same run — and the server answers with a CONFLICT whose
 * message says so in plain words. Before this the click just vanished: no
 * message, and the card kept offering an approve button that could never
 * work again. These tests pin the fix: the message lands on screen, and the
 * stale card is refreshed instead of left clickable.
 */

const resume = vi.fn();
const cancel = vi.fn();
const submitFeedback = vi.fn();
const promote = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    missions: {
      resume: (input: { id: number }) => resume(input),
      cancel: (input: { id: number }) => cancel(input),
      submitFeedback: (input: { id: number; rating: string }) => submitFeedback(input),
      promote: (input: { id: number }) => promote(input),
    },
  },
}));

const refresh = vi.fn();

// There is no router outside the app shell, so the hook is stubbed. `refresh`
// is a spy (not a no-op) because the whole point of these tests is checking
// how many times — and after which outcome — the page gets told to reload.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const CONFLICT_MESSAGE = 'This mission is no longer resumable — someone may have already approved it, or it has moved on.';

describe('approving a mission run that already moved on', () => {
  it('shows the server\'s message instead of failing silently', async () => {
    resume.mockReset();
    refresh.mockReset();
    resume.mockRejectedValue(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    render(<MissionRunActions runId={42} status="awaiting_review" />);

    await page.getByRole('button', { name: 'Approve & continue' }).click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();
  });

  it('refreshes the run instead of leaving a dead approve button on screen', async () => {
    resume.mockReset();
    refresh.mockReset();
    resume.mockRejectedValue(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    render(<MissionRunActions runId={42} status="awaiting_review" />);

    await page.getByRole('button', { name: 'Approve & continue' }).click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();

    // The whole point: a lost race still has to pull fresh state, the same
    // way a successful approve does, or the reviewer is staring at a button
    // that can never work again.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-enables the button and clears the old message on the next click', async () => {
    resume.mockReset();
    refresh.mockReset();
    resume.mockRejectedValueOnce(new ORPCError('CONFLICT', { message: CONFLICT_MESSAGE }));
    resume.mockResolvedValueOnce(undefined);
    render(<MissionRunActions runId={42} status="awaiting_review" />);

    const button = page.getByRole('button', { name: 'Approve & continue' });

    await button.click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).toBeVisible();
    await expect.element(button).not.toBeDisabled();

    await button.click();

    await expect.element(page.getByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('a mission run action that succeeds', () => {
  it('refreshes once and shows no error banner', async () => {
    cancel.mockReset();
    refresh.mockReset();
    cancel.mockResolvedValue(undefined);
    render(<MissionRunActions runId={7} status="running" />);

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
