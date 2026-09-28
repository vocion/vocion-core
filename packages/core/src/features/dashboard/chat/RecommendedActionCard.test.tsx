import type { RecommendedAction } from './types';
import { describe, expect, it, vi } from 'vitest';
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
vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose, actionStatus: vi.fn(async () => ({ id: 41, status: 'done', undoable: true })), snoozeAction: vi.fn(), decideAction: vi.fn(), undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const rec: RecommendedAction = { actionId: 'ask.file', input: { title: 'Ship the Kestrel upload fix?' }, label: 'Approve the Kestrel upload fix', agentSlug: 'product-manager', confidence: 0.9 };

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
