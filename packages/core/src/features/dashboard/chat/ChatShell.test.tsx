import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import { ShellBarActionsOutlet, ShellBarActionsProvider } from '@/features/dashboard/ShellBarActions';
import en from '@/locales/en.json';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn() },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
  },
}));

vi.mock('@/libs/I18nNavigation', () => ({
  // The surfaces read the router for `/history`, `?new=1` and the preview's chat CTA — a stub is enough here.
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => '/dashboard/chat',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { client } = await import('@/libs/Orpc');
const { ChatShell } = await import('./ChatShell');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 *
 * ChatShell puts its whole control cluster — the speaker chip, History, the
 * autonomy rung and the ⋯ menu — through `ShellBarActionsPortal` into the
 * dashboard's top bar, so a bare render drops all of it on the floor: the
 * portal returns `null` until an outlet has registered a node. The real
 * layout supplies both; so must the test wrapper.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <ShellBarActionsProvider>
        <ShellBarActionsOutlet />
        {ui}
      </ShellBarActionsProvider>
    </NextIntlClientProvider>
  );
}

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.chat.suggestions).mockReset().mockResolvedValue([]);
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
});

describe('ChatShell', () => {
  it('names the workspace on the empty state once boot settles, never the agent (§9.10)', async () => {
    // The surface has one identity and it is the workspace: the greeting is
    // "Ask <workspace>", and the lead agent that actually answers is not
    // named anywhere on the page. This test used to assert the opposite.
    await render(wrap(<ChatShell agents={AGENTS} greeting={{ workspace: 'GTM Workspace' }} />));

    await expect.element(page.getByText('GTM Workspace').first()).toBeInTheDocument();
    expect(page.getByText('GTM Orchestrator').elements()).toHaveLength(0);
  });

  it('has no agent picker: the surface speaks as the workspace; New chat is an icon, and ⋯ never lists an agent (§9.10)', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByRole('button', { name: 'New chat' })).toBeVisible();

    await page.getByRole('button', { name: 'Chat options' }).click();

    // New chat is never a row inside ⋯ (Chris, 2026-09-24: "promote that
    // icon out of the context menu"); the menu keeps All conversations.
    await expect.element(page.getByRole('menuitem', { name: /All conversations/ })).toBeVisible();
    expect(page.getByRole('menuitem', { name: /New chat/ }).elements()).toHaveLength(0);
    expect(page.getByRole('menuitem', { name: /Pipeline Analyst/ }).elements()).toHaveLength(0);
  });

  it('shows an empty state instead of crashing when there are no agents', async () => {
    // `chat/page.tsx` hands over an empty list whenever it cannot resolve a
    // workspace. `useChatSession` reads `agents[0]!.slug`, so the page used to
    // throw here rather than render anything.
    await render(wrap(<ChatShell agents={[]} />));

    await expect.element(page.getByText('No agents to chat with')).toBeInTheDocument();
    // The guard has to sit above the hook: no agent means nothing to fetch
    // state for, and the mount effect must not run at all.
    expect(client.chatWidget.getState).not.toHaveBeenCalled();
  });

  it('holds a boot skeleton and an unarmed Send until the saved-thread lookup settles', async () => {
    // Control exactly when `useLastViewedConversation`'s server round-trip
    // resolves, so we can assert the pre-boot state mid-flight instead of
    // only after everything has already settled. No persisted conversation
    // here, so once this resolves boot settles with no further
    // `conversations.get` fetch to wait on.
    let resolveGetState!: (value: unknown) => void;
    const getStatePromise = new Promise((resolve) => {
      resolveGetState = resolve;
    });
    vi.mocked(client.chatWidget.getState).mockReturnValue(getStatePromise as never);

    await render(wrap(<ChatShell agents={AGENTS} suggestions={[{ label: 'Try this', prompt: 'Do the thing' }]} />));

    // Boot is still in flight — the skeleton stands in for the transcript, so
    // there are no suggestion chips to click yet, and Send is not armed, so a
    // message can't be sent (and then silently discarded when the restored
    // transcript lands). The BOX itself never locks (2026-09-15): people type
    // their thought while the app catches up.
    await expect.element(page.getByPlaceholder('Ask anything…')).not.toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(page.getByRole('button', { name: 'Try this' }).elements()).toHaveLength(0);

    resolveGetState(null);

    await expect.element(page.getByRole('button', { name: 'Try this' })).not.toBeDisabled();
  });
});
