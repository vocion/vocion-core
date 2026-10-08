import type { AgentOption } from './types';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import en from '@/locales/en.json';
import '@/styles/global.css';

/**
 * A workspace's first day opens on its lead: one sentence, three starters,
 * each sending the lead its ask — and only while the seeded lead is the whole
 * team. No developer copy anywhere.
 */

vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const { LeadIntro, NoAgentsYet, wantsLeadIntro } = await import('./LeadIntro');

const lead: AgentOption = { slug: 'workspace-lead', name: 'Workspace lead', icon: 'bot', role: 'lead', placeholder: 'Message Workspace lead…' };
const search: AgentOption = { slug: '__search__', name: 'Search only', icon: 'search', placeholder: 'Search…' };

describe('LeadIntro', () => {
  it('introduces the lead in one sentence and sends each starter\'s ask', async () => {
    const onPick = vi.fn();
    await render(
      <NextIntlClientProvider locale="en" messages={en}>
        <LeadIntro leadName="Workspace lead" workspace="Northwind Support" onPick={onPick} />
      </NextIntlClientProvider>,
    );

    await expect.element(page.getByText('Workspace lead')).toBeInTheDocument();
    await expect.element(page.getByTestId('lead-intro-sentence')).toHaveTextContent('I\'m the lead for Northwind Support');

    await page.getByRole('button', { name: 'Set up this workspace with me' }).click();
    await page.getByRole('button', { name: 'Connect a system' }).click();
    await page.getByRole('button', { name: 'Start from a template' }).click();

    expect(onPick.mock.calls.map(([p]) => p)).toEqual(['Set up this workspace with me.', 'I want to connect a system.', 'I want to start from a template.']);
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
