import type { AgentOption } from './types';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * A workspace's first day opens on its lead: one hello and one chip that
 * starts the setup — and only while the seeded lead is the whole team. No
 * developer copy anywhere.
 */

const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const { LeadIntro, NoAgentsYet, wantsLeadIntro } = await import('./LeadIntro');

const lead: AgentOption = { slug: 'workspace-lead', name: 'Revenue lead', icon: 'bot', role: 'lead', placeholder: 'Message Revenue lead…' };
const search: AgentOption = { slug: '__search__', name: 'Search only', icon: 'search', placeholder: 'Search…' };

describe('LeadIntro', () => {
  it('says one hello as the lead, and its one chip starts the setup (founder, 2026-10-08: "a soft nudge or chip")', async () => {
    const onPick = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro firstName="Sam" team={[{ slug: 'workspace-lead', name: 'Revenue lead', leadRole: 'Revenue lead', leadLabel: 'Revenue lead' }]} onPick={onPick} />
      </NextIntlClientProvider>,
    );

    // Named for the workspace, never "workspace lead" (founder, 2026-10-09).
    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent('Hi Sam, I\'m the Revenue lead. Whenever you\'re ready, I can help set this up.');
    // One chip, no starters.
    expect(page.getByRole('button').elements()).toHaveLength(1);

    await page.getByRole('button', { name: 'Set up this workspace' }).click();

    expect(onPick).toHaveBeenCalledWith('Set up this workspace with me.');
  });

  it('says its given name when the Org gave it one', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro firstName="Sam" team={[{ slug: 'workspace-lead', name: 'Ava', givenName: 'Ava', leadRole: 'Revenue lead', leadLabel: 'Ava · Revenue lead' }]} onPick={() => {}} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent('Hi Sam, I\'m Ava, the Revenue lead. Whenever you\'re ready, I can help set this up.');
    await expect.element(page.getByTestId('team-caption')).toHaveTextContent('Ava · Revenue lead');
  });

  it('opens only while the seeded lead is the whole team', () => {
    expect(wantsLeadIntro([lead, search])).toBe(true);
    expect(wantsLeadIntro([lead, { slug: 'reporting-analyst', name: 'Reporting analyst', icon: 'bot', placeholder: '' }, search])).toBe(false);
    expect(wantsLeadIntro([{ slug: 'support-lead', name: 'Support lead', icon: 'bot', placeholder: '' }, search])).toBe(false);
    expect(wantsLeadIntro([search])).toBe(false);
  });

  it('the no-agent state is one calm line with Retry — never "no agents yet", never a hire link (founder, 2026-10-09)', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NoAgentsYet personal />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('no-agents-state')).toHaveTextContent('Your assistant isn\'t ready yet.');
    expect(document.body.textContent).not.toMatch(/no agents yet|Hire one|agent catalog/i);
    expect(page.getByRole('link').elements()).toHaveLength(0);

    await page.getByTestId('agents-retry').click();

    expect(refresh).toHaveBeenCalled();
  });
});

describe('a Personal workspace opens on its person\'s own assistant (founder, 2026-10-09)', () => {
  const assistant: AgentOption = { slug: 'assistant', name: 'Assistant', icon: 'bot', placeholder: '', personal: true, leadRole: 'personal assistant on Metacto' };
  const search: AgentOption = { slug: '__search__', name: 'Search only', icon: 'search', placeholder: '' };

  it('is the warm start, with one avatar and its own hello', async () => {
    expect(wantsLeadIntro([assistant, search])).toBe(true);

    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro firstName="Chris" team={[{ slug: 'assistant', name: 'Assistant', personal: true, leadRole: 'personal assistant on Metacto' }]} onPick={vi.fn()} personal hint={<span data-testid="starter">Connect my Gmail and calendar</span>} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('lead-intro')).toHaveTextContent('Hi Chris — I\'m your personal assistant on Metacto.');
    await expect.element(page.getByTestId('starter')).toBeVisible();
    // Its starters, not the shared workspace's setup chip.
    expect(page.getByTestId('lead-intro-setup').elements()).toHaveLength(0);
  });

  it('once named, it is that name', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro firstName="Chris" team={[{ slug: 'assistant', name: 'Ziggy', givenName: 'Ziggy', personal: true, leadRole: 'personal assistant on Metacto' }]} onPick={vi.fn()} personal />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('lead-intro')).toHaveTextContent('Hi Chris — I\'m Ziggy.');
  });
});
