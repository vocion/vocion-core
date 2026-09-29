import type { RecommendedAction } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * A RULING CARD IS ITS QUESTION AND ITS ANSWERS (Chris, 2026-09-29, proposal
 * 5210: "overall that card is complex?"): the question as the title, one line
 * of why, the options (recommended first, primary) and review one quiet icon
 * away — no "Asks you to rule", no "Waiting on you". Once chosen, the state
 * line says the choice, with Undo. Fixtures are fictional.
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

const INPUT = {
  title: 'Copy-link on locked rows?',
  kind: 'ruling',
  options: [
    { id: 'disabled', label: 'Show disabled' },
    { id: 'upsell', label: 'Show with upsell' },
    { id: 'hide', label: 'Hide on locked rows', recommended: true },
  ],
};
const rec: RecommendedAction = { actionId: 'ask.file', input: INPUT, label: 'Rule: copy-link on locked rows?', rationale: 'Locked rows already hide every share control, so a disabled button would be the only one.', agentSlug: 'product-manager', confidence: 0.92, runId: 52 };

beforeEach(() => {
  actionStatus.mockReset();
  decideAction.mockReset();
  actionStatus.mockResolvedValue({ status: 'pending' });
  decideAction.mockResolvedValue({ ok: true });
});

describe('a ruling waiting on you', () => {
  it('is the question, one line of why, the options recommended first, and a quiet review icon', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByText('Copy-link on locked rows?', { exact: true })).toBeInTheDocument();
    expect(document.querySelector('[data-testid="recommended-action-why"]')?.className).toContain('line-clamp-1');

    const choices = page.getByTestId('ruling-choice').elements().map(e => e.textContent?.trim());

    expect(choices).toEqual(['Hide on locked rows', 'Show disabled', 'Show with upsell']);
    expect(page.getByTestId('ruling-choice').elements()[0]!.className).toContain('bg-brand-amber-deep');
    await expect.element(page.getByRole('link', { name: 'Decide in review' })).toHaveAttribute('href', '/dashboard/inbox/proposal-52');
    // The buttons say what the meta rows said.
    expect(document.querySelector('[data-testid="recommended-action-effect"]')).toBeNull();
    expect(document.querySelector('[data-testid="recommended-action-status"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Waiting on you');
    expect(document.body.textContent).not.toContain('92%');
  });

  it('a choice answers it; the state line comes back saying the choice, with Undo', async () => {
    actionStatus
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValue({ status: 'done', undoable: true, choice: { label: 'Show with upsell', byTrustBar: false } });
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await page.getByRole('button', { name: 'Show with upsell' }).click();

    expect(decideAction).toHaveBeenCalledWith(expect.objectContaining({ id: 52, decision: 'approve', editedInput: { ...INPUT, answer: 'upsell' } }));
    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('You chose Show with upsell');
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });
});

describe('a ruling the trust bar answered', () => {
  it('says it chose for you, with Undo', async () => {
    actionStatus.mockResolvedValue({ status: 'done', undoable: true, approvedByAgent: true, choice: { label: 'Hide on locked rows', byTrustBar: true } });
    await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('Chose Hide on locked rows for you');
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(page.getByTestId('ruling-choice').elements()).toHaveLength(0);
  });
});
