import type { RecommendedAction } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * ONE PRESS, ONE DECISION — and a done card links what it made.
 *
 * Chris, 2026-09-29: "I clicked approve. then didn't get an updated ux fast
 * enough. clicked approve again and got this bug. then it turned green, but
 * the error still showed", and "I also expected a path to open #205, but
 * didn't get that link in the action card". Fixtures are fictional.
 */

const actionStatus = vi.fn(async (): Promise<Record<string, unknown>> => ({ status: 'pending' }));
const decideAction = vi.fn(async (): Promise<Record<string, unknown>> => ({ ok: true }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose: vi.fn(), actionStatus, snoozeAction: vi.fn(), decideAction, undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const rec: RecommendedAction = { actionId: 'factory.dispatch_task', input: { taskId: 12 }, label: 'Re-dispatch task #12 with plan #14', agentSlug: 'product-manager', confidence: 0.9, runId: 41 };

beforeEach(() => {
  actionStatus.mockReset();
  decideAction.mockReset();
  actionStatus.mockResolvedValue({ status: 'pending' });
  decideAction.mockResolvedValue({ ok: true });
});

describe('a decision is made once (Chris, 2026-09-29: double Approve)', () => {
  it('two presses before the first returns send ONE decision, and the buttons do not come back while the poll catches up', async () => {
    let release: (v: Record<string, unknown>) => void = () => {};
    decideAction.mockImplementation(() => new Promise((r) => {
      release = r;
    }));
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);
    const approve = page.getByRole('button', { name: 'Approve' });

    await expect.element(approve).toBeInTheDocument();

    // Two clicks in the same task: no render between them.
    const el = approve.element() as HTMLButtonElement;
    el.click();
    el.click();

    expect(decideAction).toHaveBeenCalledTimes(1);

    release({ ok: true });

    // The poll still says pending; the card says what the person did.
    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('Approved · running');
    await expect.element(page.getByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('an "already decided" refusal on a run that is done is not an error: it settles green, no error line', async () => {
    decideAction.mockRejectedValue(new Error('action_run 41 is done — already decided, cannot execute'));
    actionStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'done', decidedBy: 'Dana Reyes', decidedAt: '2026-09-29T16:18:18Z', summary: 'started the build of request #7 — run #9' });
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('Approved by Dana Reyes');
    expect(document.body.textContent).not.toContain('Couldn’t decide it');
  });

  it('a refusal that is NOT the asked-for state still shows', async () => {
    decideAction.mockRejectedValue(new Error('network down'));
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect.element(page.getByText('Couldn’t decide it:')).toBeInTheDocument();
  });
});

describe('a done card opens what it made', () => {
  it('draws the run\'s result links under the state line', async () => {
    actionStatus.mockResolvedValue({
      status: 'done',
      decidedBy: 'Dana Reyes',
      summary: 'sent request #7 back to planning',
      links: [{ label: 'request #7', href: '/w/acme/dashboard/p/feature/7' }, { label: 'engineering run #9', href: '/dashboard/p/runs/9' }],
    });
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByRole('link', { name: 'Open request #7' })).toHaveAttribute('href', '/w/acme/dashboard/p/feature/7');
    await expect.element(page.getByRole('link', { name: 'Open engineering run #9' })).toHaveAttribute('href', '/dashboard/p/runs/9');
  });

  it('does not repeat the record link the card already shows', async () => {
    actionStatus.mockResolvedValue({
      status: 'done',
      recordHref: '/w/acme/dashboard/p/feature/7',
      recordHrefLabel: 'Open feature',
      links: [{ label: 'request #7', href: '/w/acme/dashboard/p/feature/7' }],
    });
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByRole('link', { name: 'Open feature' })).toBeInTheDocument();
    expect(page.getByRole('link', { name: 'Open request #7' }).elements()).toHaveLength(0);
  });
});
