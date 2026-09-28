import type { RecommendedAction } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

/**
 * Under done-for-you the SERVER files a card and sends its run id after the
 * card itself. The card adopts that id and shows the run; it never files
 * itself. Filing on mount as well was a second filing of the same card
 * (walk 20, finding 27). Fixtures are fictional.
 */

const propose = vi.fn(async () => ({ runId: 99, status: 'pending' }));
const actionStatus = vi.fn(async (): Promise<Record<string, unknown>> => ({ id: 41, status: 'done', undoable: true }));
vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose, actionStatus, snoozeAction: vi.fn(), decideAction: vi.fn(), undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const rec: RecommendedAction = { actionId: 'ask.file', input: { title: 'Ship the Kestrel upload fix?' }, label: 'Approve the Kestrel upload fix', agentSlug: 'product-manager', confidence: 0.9 };

const text = (testId: string) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim();

beforeEach(() => {
  actionStatus.mockReset();
  actionStatus.mockResolvedValue({ id: 41, status: 'done', undoable: true });
});

describe('a card the server files', () => {
  it('adopts the run id when it arrives, and never proposes itself', async () => {
    const { rerender } = await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    // Quiet controls: named for a screen reader and a hover, no words on the card.
    await expect.element(page.getByRole('button', { name: 'Review first' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Defer' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Discuss this card' }).elements()).toHaveLength(0);

    await rerender(<TooltipProvider><RecommendedActionCard rec={{ ...rec, runId: 41 }} /></TooltipProvider>);

    await expect.element(page.getByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
  });
});

/**
 * Chris, 2026-09-28, on two cards in one turn: "I don't understand what the
 * first card did. Is it an auto approve recommendation? Make that clear." A
 * card says what approving does (from the action id) and one state.
 */
describe('what a card does, and where it stands', () => {
  it('an undecided card says what approving does, from the action id, and that it waits on you', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: 'objects.propose_candidate' }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-effect')).toHaveTextContent('Files a request on Work');
    // The agent's title is not what the line says.
    expect(text('recommended-action-effect')).not.toContain('Kestrel');
    expect(text('recommended-action-state')).toBe('Waiting on you');
  });

  it('a card the agent ran within bounds reads "Done for you" with Undo, and nothing else', async () => {
    actionStatus.mockResolvedValue({ id: 41, status: 'done', undoable: true, approvedByAgent: true, decidedBy: 'Dana Reyes', reason: 'Within the ask.file trust rule' });
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, runId: 41 }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('Done for you');

    expect(text('recommended-action-state')).toBe('Done for you');
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    const line = text('recommended-action-status') ?? '';

    expect(line).not.toMatch(/approved by/i);
    expect(line).not.toMatch(/within bounds/i);
    expect(text('recommended-action-effect')).toBe('Asks you to rule');
  });

  it('a card a person approved names them, once, and never also says it was done for you', async () => {
    actionStatus.mockResolvedValue({ id: 41, status: 'done', undoable: true, approvedByAgent: false, decidedBy: 'Dana Reyes', decidedAt: '2026-09-28T14:50:00Z' });
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: 'git.merge', runId: 41 }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent(/^Approved by Dana Reyes · \d{1,2}:\d{2} [AP]M$/);

    const line = text('recommended-action-status') ?? '';

    expect(line).not.toMatch(/Done for you/);
    expect(line).not.toMatch(/within bounds/i);
    expect(text('recommended-action-effect')).toBe('Hands you the merge');
  });

  it('a filed card still waiting on a person says so', async () => {
    actionStatus.mockResolvedValue({ id: 41, status: 'pending', decidedBy: null, decidedAt: null });
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: 'factory.dispatch_task', runId: 41 }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-state')).toHaveTextContent('Waiting on you');
    await expect.element(page.getByRole('button', { name: 'Approve' })).toBeInTheDocument();

    expect(text('recommended-action-effect')).toBe('Starts the build');
  });
});

/**
 * Chris, 2026-09-28, conversation 351: "should this have been a card? what
 * action was taken? what's the CTA? … I want to click through to the feature
 * detail page, either inline or in the action card."
 */
describe('a card links to the record it is about', () => {
  it('the title and an "Open feature" link go to the feature page', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: 'factory.dispatch_task', input: { requestId: 201 }, label: 'Approve build: link expiry', href: '/w/kestrel/dashboard/p/feature/201', hrefLabel: 'Open feature' }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-title-link')).toHaveAttribute('href', '/w/kestrel/dashboard/p/feature/201');
    await expect.element(page.getByTestId('recommended-action-record-link')).toHaveTextContent('Open feature');
    expect(text('recommended-action-effect')).toBe('Starts the build');
  });

  it('a filing that ran links to the record it made', async () => {
    actionStatus.mockResolvedValue({ id: 41, status: 'done', decidedBy: null, decidedAt: null, recordHref: '/w/kestrel/dashboard/p/feature/233', recordHrefLabel: 'Open feature' });
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: 'objects.propose_candidate', label: 'File as a feature request: link expiry', runId: 41 }} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-record-link')).toHaveAttribute('href', '/w/kestrel/dashboard/p/feature/233');
  });

  it('a card with nothing to press does not say it is waiting on you', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={{ ...rec, actionId: '' }} /></TooltipProvider>);

    expect(document.querySelector('[data-testid="recommended-action-state"]')).toBeNull();
  });
});
