import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import en from '@/locales/en.json';

let pathname = '/dashboard/review';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));
vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(async () => null), setState: vi.fn(async () => ({ agentSlug: 'revops-lead', conversationId: null })), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(async () => []), latestForScope: vi.fn(async () => null), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn() },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
  },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { isChatPage, isOwnDockRoute, isRecordRoute, PageDock } = await import('./PageDock');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;
}

const AGENTS = [
  { slug: 'revops-lead', name: 'RevOps Lead', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
];

beforeEach(() => {
  localStorage.clear();
  document.title = 'Review';
});

describe('route rules', () => {
  it('names the full-page chat, the routes with their own dock, and the single records', () => {
    expect(isChatPage('/dashboard/chat')).toBe(true);
    expect(isChatPage('/en/dashboard/chat')).toBe(true);
    // One conversation expanded beside its canvas is still the chat page (058 §6).
    expect(isChatPage('/dashboard/chat/42')).toBe(true);
    expect(isChatPage('/en/dashboard/chat/42')).toBe(true);
    expect(isChatPage('/dashboard/chat/42/settings')).toBe(false);
    expect(isChatPage('/dashboard/chatter')).toBe(false);
    expect(isOwnDockRoute('/gtm/lead/88201')).toBe(true);
    expect(isOwnDockRoute('/gtm/personalization')).toBe(false);

    for (const record of ['/dashboard/briefings', '/dashboard/briefings/61', '/dashboard/missions/runs/42', '/dashboard/missions/discovery-followup', '/dashboard/objects/17', '/dashboard/agents/revenue-lead', '/dashboard/connectors/hubspot', '/dashboard/evals/brief/runs/3', '/dashboard/adoption/users/u1', '/dashboard/learnings/global']) {
      expect(isRecordRoute(record), record).toBe(true);
    }
    for (const list of ['/dashboard/review', '/dashboard/missions', '/dashboard/missions/new', '/dashboard/objects', '/dashboard/objects/type/event', '/dashboard/agents', '/dashboard', '/gtm/personalization', '/dashboard/adoption']) {
      expect(isRecordRoute(list), list).toBe(false);
    }
  });
});

describe('PageDock', () => {
  it('is collapsed to the button on a list page, and opens to the everything conversation carrying the page', async () => {
    pathname = '/dashboard/review';
    await render(wrap(<PageDock agents={AGENTS} />));

    const open = page.getByRole('button', { name: 'Open the conversation (⌘J)' });

    await expect.element(open).toBeVisible();

    await open.click();

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
    await expect.element(page.getByText('Everything')).toBeVisible();
  });

  it('opens by default on a single record', async () => {
    pathname = '/dashboard/missions/runs/42';
    await render(wrap(<PageDock agents={AGENTS} />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  });

  it('reads the route the same under a locale prefix', async () => {
    pathname = '/en/dashboard/missions/runs/42';
    await render(wrap(<PageDock agents={AGENTS} />));

    await expect.element(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  });

  it('renders nothing on the full-page chat, on a lead page, and with no agents', async () => {
    for (const p of ['/dashboard/chat', '/gtm/lead/88201']) {
      pathname = p;
      const screen = await render(wrap(<PageDock agents={AGENTS} />));

      expect(screen.container.innerHTML).toBe('');

      screen.unmount();
    }
    pathname = '/dashboard/review';
    const screen = await render(wrap(<PageDock agents={[]} />));

    expect(screen.container.innerHTML).toBe('');
  });
});
