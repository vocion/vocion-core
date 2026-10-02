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
const { ConnectLinkCard } = await import('./ConnectLinkCard');

const START = '/api/connect/github/start?connector=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7&conversation=7&card=card_l';
const PASTE = '/dashboard/connectors?add=github&paste=1&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7';
const connect: RecommendedAction = {
  id: 'card_l',
  kind: 'link',
  actionId: '',
  input: {},
  label: 'Connect GitHub',
  href: START,
  hrefLabel: 'Connect GitHub',
  secondaryHref: PASTE,
  secondaryHrefLabel: 'Paste a token',
  state: 'proposed',
};

describe('a link card (offer_connection) starts the login and never says Approve', () => {
  it('the primary button is a plain link to the start route, with Paste a token beside it', async () => {
    const { container } = await render(<TooltipProvider><RecommendedActionCard rec={connect} /></TooltipProvider>);

    const open = page.getByTestId('recommended-action-open');

    await expect.element(open).toHaveAttribute('href', START);
    await expect.element(open).not.toHaveAttribute('target');
    await expect.element(page.getByRole('link', { name: 'Paste a token' })).toHaveAttribute('href', PASTE);
    expect(page.getByRole('button', { name: 'Approve' }).elements()).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/approve/i);
  });

  it('a failed last attempt turns the button into Try again and states the date', async () => {
    const rec = { ...connect, lastAttempt: { at: '2026-10-01T16:12:00.000Z', reason: 'access_denied', summary: 'GitHub denied access' } };
    await render(<TooltipProvider><ConnectLinkCard rec={rec} timeZone="UTC" /></TooltipProvider>);

    await expect.element(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', START);
    await expect.element(page.getByRole('link', { name: 'Paste a token' })).toBeVisible();
    await expect.element(page.getByText('Last attempt Oct 1, 4:12 PM: GitHub denied access')).toBeVisible();
  });

  it('a decided card collapses to Connected, with no links and no last attempt', async () => {
    const rec = { ...connect, state: 'decided' as const, lastAttempt: { at: '2026-10-01T16:12:00.000Z', reason: 'access_denied', summary: 'GitHub denied access' } };
    const { container } = await render(<TooltipProvider><RecommendedActionCard rec={rec} /></TooltipProvider>);

    await expect.element(page.getByText('Connected GitHub')).toBeVisible();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/last attempt|approve/i);
  });

  it('shows what the login asks for', async () => {
    await render(<TooltipProvider><ConnectLinkCard rec={{ ...connect, body: 'Asks for: The repositories you choose during install' }} timeZone="UTC" /></TooltipProvider>);

    await expect.element(page.getByText('Asks for: The repositories you choose during install')).toBeVisible();
  });
});
