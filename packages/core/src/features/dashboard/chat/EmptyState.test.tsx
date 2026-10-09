import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * An empty conversation is a mark and one warm line, and nothing else; one
 * soft nudge by the composer only when something waits (founder, 2026-10-08,
 * after the Claude iOS app's empty chat).
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { EmptyState } = await import('./EmptyState');
const { WaitingNudge } = await import('./WaitingNudge');
const { LAST_SEEN_KEY } = await import('./emptyChat');

function renderIt(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

const TEAM = ['Workspace lead', 'Pipeline Analyst', 'Deal Desk', 'Renewals', 'Inbound', 'Hiring'].map((name, i) => ({ slug: `a${i}`, name, accent: null }));

describe('EmptyState, your team is here (founder, 2026-10-09)', () => {
  it('centres the team, lead first and larger, four dots then +N, and a caption that opens the team', async () => {
    await renderIt(<EmptyState firstName="Sam" hour={20} returning={false} team={TEAM} secondLine="Northwind's team is on it." />);

    await expect.element(page.getByTestId('team-lead')).toBeVisible();
    expect(page.getByTestId('team-member').elements()).toHaveLength(3);
    await expect.element(page.getByTestId('team-more')).toHaveTextContent('+2');
    await expect.element(page.getByRole('link', { name: 'Workspace lead · 6 agents' })).toHaveAttribute('href', '/dashboard/teams');
    await expect.element(page.getByTestId('chat-greeting-team')).toHaveTextContent('Northwind\'s team is on it.');
    expect(page.getByTestId('chat-empty-mark').elements()).toHaveLength(0);
  });

  it('shows only the lead when it is alone, captioned by its name', async () => {
    await renderIt(<EmptyState hour={9} returning={false} team={TEAM.slice(0, 1)} />);

    expect(page.getByTestId('team-member').elements()).toHaveLength(0);
    await expect.element(page.getByTestId('team-caption')).toHaveTextContent(/^Workspace lead$/);
  });

  it('greets in Vocion\'s own sans display face, never a serif', async () => {
    await renderIt(<EmptyState hour={9} returning={false} team={TEAM} />);
    const face = getComputedStyle(page.getByTestId('chat-greeting').element()).fontFamily;

    expect(face).not.toMatch(/Georgia|Times|Source Serif/i);
  });
});

describe('EmptyState', () => {
  it('says good evening by first name, under the mark when there is no team, and nothing else', async () => {
    await renderIt(<EmptyState firstName="Sam" hour={20} returning={false} />);

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent(/^Good evening, Sam\.$/);
    await expect.element(page.getByTestId('chat-empty-mark')).toBeVisible();
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });

  it('welcomes someone back after a while, and greets without a name when it has none', async () => {
    localStorage.setItem(LAST_SEEN_KEY, String(Date.now() - 24 * 60 * 60 * 1000));
    await renderIt(<EmptyState hour={9} />);

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent(/^Welcome back\.$/);
    // This visit is remembered for the next one.
    expect(Number(localStorage.getItem(LAST_SEEN_KEY))).toBeGreaterThan(Date.now() - 60_000);
  });

  it('greets by the time of day on a first visit', async () => {
    await renderIt(<EmptyState firstName="Sam" hour={9} />);

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent(/^Good morning, Sam\.$/);
  });

  it('carries one soft nudge to Review, never cards', async () => {
    await renderIt(<EmptyState hour={15} returning={false} nudge={<WaitingNudge count={1} />} />);

    await expect.element(page.getByRole('link', { name: '1 thing waiting on you' })).toHaveAttribute('href', '/dashboard/inbox');
  });
});
