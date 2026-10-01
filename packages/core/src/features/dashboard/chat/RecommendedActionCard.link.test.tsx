import type { RecommendedAction } from './types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose: vi.fn(), actionStatus: vi.fn(), snoozeAction: vi.fn(), decideAction: vi.fn(), undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const connect: RecommendedAction = { id: 'card_l', actionId: '', input: {}, label: 'Connect GitHub', href: '/dashboard/connectors?add=github', hrefLabel: 'Connect GitHub', state: 'proposed' };

describe('a link card (offer_connection) is one button, never Approve', () => {
  it('renders the link as the button and no approve control', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={connect} /></TooltipProvider>);

    await expect.element(page.getByTestId('recommended-action-open')).toHaveAttribute('href', '/dashboard/connectors?add=github');
    expect(page.getByRole('button', { name: 'Approve' }).elements()).toHaveLength(0);
  });
});
