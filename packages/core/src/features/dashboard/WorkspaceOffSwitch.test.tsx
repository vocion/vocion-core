import { ORPCError } from '@orpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { WorkspacePausedBanner, WorkspacePauseDialog } from './WorkspaceOffSwitch';
import '@/styles/global.css';

/**
 * The off switch, as a person meets it.
 *
 * What it has to get right: the switch is reachable and labelled at phone
 * width as well as on a desktop (Chris pulled it from a phone); the note it
 * asks for reaches the server and the page is told to re-read once it lands;
 * the banner says who stopped it, when, why, and — the part that is easy to
 * leave out — what is still running, so nobody reads "paused" as "nothing is
 * happening" while a worker is mid-run; and a stale click gets the server's
 * words rather than silence.
 */

const pause = vi.fn();
const resume = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    workspace: {
      pause: (input: { note: string }) => pause(input),
      resume: () => resume(),
    },
  },
}));

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const HELD = { byName: 'Chris', when: 'Sep 21, 3:14 PM UTC', note: 'holding the factory until the release goes out' };

/** Phone: an iPhone's CSS viewport, the width the screenshot in #519 came from. */
const PHONE = { width: 390, height: 844 };
/** Desktop: the width the browser project runs at by default. */
const DESKTOP = { width: 1440, height: 900 };

beforeEach(() => {
  pause.mockReset();
  resume.mockReset();
  refresh.mockReset();
});

describe('the switch, on a running workspace', () => {
  it('pauses with the note a person typed, then tells the page to re-read', async () => {
    pause.mockResolvedValue({});
    render(<WorkspacePauseDialog open onOpenChange={() => {}} />);

    await page.getByLabelText(/Why\?/).fill('holding the factory until the release goes out');
    await page.getByTestId('workspace-pause-confirm').click();

    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith({ note: 'holding the factory until the release goes out' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('will not stop the workspace without a reason', async () => {
    render(<WorkspacePauseDialog open onOpenChange={() => {}} />);

    await expect.element(page.getByTestId('workspace-pause-confirm')).toBeDisabled();
    expect(pause).not.toHaveBeenCalled();
  });

  it('says, before anyone confirms, what stops and what does not', async () => {
    render(<WorkspacePauseDialog open onOpenChange={() => {}} />);

    await expect.element(page.getByText(/No automation fires/)).toBeVisible();
    await expect.element(page.getByText(/A worker already mid-run finishes/)).toBeVisible();
    await expect.element(page.getByText(/paused individually stay paused/)).toBeVisible();
  });

  it('shows nothing until it is opened', async () => {
    render(<WorkspacePauseDialog open={false} onOpenChange={() => {}} />);

    await expect.element(page.getByTestId('workspace-pause-confirm')).not.toBeInTheDocument();
  });

  it('asks for the reason at phone width, because the reason is the whole point', async () => {
    // The trigger moved to the account menu (Chris, 2026-09-22: "I don't want
    // to see the word Pause in the banner"); what this dialog still owes at
    // 430px is the note field and a confirm a thumb can hit.
    await page.viewport(PHONE.width, PHONE.height);
    render(<WorkspacePauseDialog open onOpenChange={() => {}} />);

    await expect.element(page.getByLabelText(/Why\?/)).toBeVisible();

    const confirm = page.getByTestId('workspace-pause-confirm');

    await expect.element(confirm).toBeVisible();
    expect((await confirm.element()).getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  });
});

describe('the banner, on a paused workspace', () => {
  it('names who, when and why, and says what is still running', async () => {
    render(<WorkspacePausedBanner pause={HELD} canResume />);

    const banner = page.getByTestId('workspace-paused-banner');

    await expect.element(banner).toBeVisible();

    const text = (await banner.element()).textContent ?? '';

    expect(text).toContain('This workspace is paused.');
    expect(text).toContain('holding the factory until the release goes out');
    expect(text).toContain('Chris');
    expect(text).toContain('Sep 21, 3:14 PM UTC');
    // The two halves that stop "paused" being read as "nothing is happening".
    expect(text).toContain('No automation fires');
    expect(text).toContain('A worker already mid-run finishes and reports');
  });

  it('resumes from the banner and tells the page to re-read', async () => {
    resume.mockResolvedValue({});
    render(<WorkspacePausedBanner pause={HELD} canResume />);

    await page.getByTestId('workspace-resume').click();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('gives a member the reason and the name, but no Resume — they know who to ask', async () => {
    render(<WorkspacePausedBanner pause={HELD} canResume={false} />);

    await expect.element(page.getByTestId('workspace-paused-banner')).toBeVisible();
    await expect.element(page.getByTestId('workspace-resume')).not.toBeInTheDocument();
  });

  it('shows the server\'s words when someone else got there first', async () => {
    resume.mockRejectedValue(new ORPCError('CONFLICT', { message: 'this workspace is not paused. Reload to see its current state.' }));
    render(<WorkspacePausedBanner pause={HELD} canResume />);

    await page.getByTestId('workspace-resume').click();

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(page.getByText(/not paused/)).toBeVisible();
  });

  it('reads whole on a phone: nothing truncated, nothing scrolled sideways', async () => {
    await page.viewport(PHONE.width, PHONE.height);
    render(<WorkspacePausedBanner pause={HELD} canResume />);

    const banner = page.getByTestId('workspace-paused-banner');

    await expect.element(banner).toBeVisible();
    // The note is the actionable part; if it is clipped the banner failed.
    await expect.element(page.getByText(/holding the factory until the release goes out/)).toBeVisible();
    // Resume stacks under the sentence rather than squeezing it.
    await expect.element(page.getByTestId('workspace-resume')).toBeVisible();

    // No sideways scroll — the same guard the phone transcript uses.
    const doc = document.scrollingElement!;

    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);

    await page.viewport(DESKTOP.width, DESKTOP.height);
  });

  it('reads whole on a desktop too', async () => {
    render(<WorkspacePausedBanner pause={HELD} canResume />);

    await expect.element(page.getByTestId('workspace-paused-banner')).toBeVisible();
    await expect.element(page.getByText(/holding the factory until the release goes out/)).toBeVisible();
    await expect.element(page.getByTestId('workspace-resume')).toBeVisible();

    const doc = document.scrollingElement!;

    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);
  });

  it('says so plainly when the pause carries no note', async () => {
    render(<WorkspacePausedBanner pause={{ ...HELD, note: null }} canResume />);

    await expect.element(page.getByText('No reason was given.')).toBeVisible();
  });
});
