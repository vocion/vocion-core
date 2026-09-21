import { ORPCError } from '@orpc/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { AutomationPauseControl } from './AutomationPauseControl';

/**
 * The control a person uses to hold an automation and to let it go. What it
 * has to get right: the note it asks for reaches the server, the page is told
 * to reload once the server has the record, the standing pause reads as who
 * and why, and a stale click gets the server's words instead of silence.
 */

const pause = vi.fn();
const resume = vi.fn();

vi.mock('@/libs/Orpc', () => ({
  client: {
    automations: {
      pause: (input: { slug: string; note?: string }) => pause(input),
      resume: (input: { slug: string; note?: string }) => resume(input),
    },
  },
}));

const refresh = vi.fn();

// There is no router outside the app shell, so the hook is stubbed; `refresh`
// is a spy because whether the page re-reads is part of what is under test.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

beforeEach(() => {
  pause.mockReset();
  resume.mockReset();
  refresh.mockReset();
});

describe('AutomationPauseControl', () => {
  it('pauses with the note a person typed, then reloads the page', async () => {
    pause.mockResolvedValue({});
    render(<AutomationPauseControl slug="hourly-sweep" paused={null} />);

    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByLabelText(/Why pause/).fill('holding until the CRM sync is fixed');
    await page.getByRole('button', { name: 'Pause now' }).click();

    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith({ slug: 'hourly-sweep', note: 'holding until the CRM sync is fixed' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // The form closes; the page re-read is what brings the paused line in.
    await expect.element(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  it('sends no note when the field is left empty', async () => {
    pause.mockResolvedValue({});
    render(<AutomationPauseControl slug="hourly-sweep" paused={null} />);

    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Pause now' }).click();

    await vi.waitFor(() => expect(pause).toHaveBeenCalledWith({ slug: 'hourly-sweep', note: undefined }));
  });

  it('shows who paused it, when, and why — and offers Resume', async () => {
    render(
      <AutomationPauseControl
        slug="hourly-sweep"
        paused={{ byName: 'Chris', when: 'Sep 20, 3:00 PM', note: 'holding until the CRM sync is fixed' }}
      />,
    );

    await expect.element(page.getByTestId('automation-paused-by')).toHaveTextContent('Paused by Chris Sep 20, 3:00 PM: holding until the CRM sync is fixed');
    await expect.element(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('resumes with a note and reloads', async () => {
    resume.mockResolvedValue({ ok: true });
    render(<AutomationPauseControl slug="hourly-sweep" paused={{ byName: 'Chris', when: 'Sep 20, 3:00 PM', note: null }} />);

    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByLabelText(/Why resume/).fill('sync is back');
    await page.getByRole('button', { name: 'Resume now' }).click();

    await vi.waitFor(() => expect(resume).toHaveBeenCalledWith({ slug: 'hourly-sweep', note: 'sync is back' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('shows the server\'s message on a stale click and still reloads', async () => {
    pause.mockRejectedValue(new ORPCError('CONFLICT', { message: 'automation "hourly-sweep" is already paused. Reload to see its current state.' }));
    render(<AutomationPauseControl slug="hourly-sweep" paused={null} />);

    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Pause now' }).click();

    await expect.element(page.getByRole('alert')).toHaveTextContent(/already paused/);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
