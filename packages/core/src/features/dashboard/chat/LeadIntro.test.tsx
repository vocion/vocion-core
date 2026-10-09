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

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { LeadIntro, NoAgentsYet, wantsLeadIntro } = await import('./LeadIntro');

const lead: AgentOption = { slug: 'workspace-lead', name: 'Workspace lead', icon: 'bot', role: 'lead', placeholder: 'Message Workspace lead…' };
const search: AgentOption = { slug: '__search__', name: 'Search only', icon: 'search', placeholder: 'Search…' };

describe('LeadIntro', () => {
  it('says one hello as the lead, and its one chip starts the setup (founder, 2026-10-08: "a soft nudge or chip")', async () => {
    const onPick = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro firstName="Sam" onPick={onPick} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('chat-greeting')).toHaveTextContent('Hi Sam, I\'m the workspace lead. Whenever you\'re ready, I can help set this up.');
    // One chip, no starters.
    expect(page.getByRole('button').elements()).toHaveLength(1);

    await page.getByRole('button', { name: 'Set up this workspace' }).click();

    expect(onPick).toHaveBeenCalledWith('Set up this workspace with me.');
  });

  it('opens only while the seeded lead is the whole team', () => {
    expect(wantsLeadIntro([lead, search])).toBe(true);
    expect(wantsLeadIntro([lead, { slug: 'reporting-analyst', name: 'Reporting analyst', icon: 'bot', placeholder: '' }, search])).toBe(false);
    expect(wantsLeadIntro([{ slug: 'support-lead', name: 'Support lead', icon: 'bot', placeholder: '' }, search])).toBe(false);
    expect(wantsLeadIntro([search])).toBe(false);
  });

  it('the no-agent state speaks to the person, with the one next step', async () => {
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <NoAgentsYet />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByTestId('no-agents-state')).toHaveTextContent('This workspace has no agents yet. Hire one from the agent catalog.');
    await expect.element(page.getByTestId('no-agents-state')).not.toHaveTextContent(/apply a workspace|manage →/i);
  });
});
