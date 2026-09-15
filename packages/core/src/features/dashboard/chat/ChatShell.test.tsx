import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import en from '@/locales/en.json';
import { ShellBarActionsOutlet, ShellBarActionsProvider } from '@/features/dashboard/ShellBarActions';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn(), setRail: vi.fn(async () => ({ railWidth: null, railOpen: null })) },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn(), search: vi.fn(async () => []), tail: vi.fn(async () => []), setAutonomy: vi.fn(), feedback: vi.fn() },
    teams: { list: vi.fn(async () => ({ workspace: null, teams: [] })) },
    missions: { list: vi.fn(async () => []) },
  },
}));

const { client } = await import('@/libs/Orpc');
const { ChatShell } = await import('./ChatShell');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  // ChatShell portals its ⋯ menu and history popover into the shell bar, so a
  // bare render has nowhere to put them — supply the provider and its outlet.
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

beforeEach(async () => {
  // The rail is a side-by-side column only above RAIL_SHEET_BREAKPOINT (1200px);
  // vitest's browser viewport defaults to 414px, where the dock is a Sheet and
  // there is no `complementary` landmark to assert against.
  await page.viewport(1440, 900);
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
  it('names the workspace on the empty state once boot settles', async () => {
    // §9.10: the surface speaks as the workspace, never as the agent — the
    // greeting is "Ask <workspace>" and agent names stay out of it.
    await render(wrap(<ChatShell agents={AGENTS} greeting={{ workspace: 'GTM Workspace' }} />));

    await expect.element(page.getByText('GTM Workspace').first()).toBeInTheDocument();
    expect(page.getByText('GTM Orchestrator').elements()).toHaveLength(0);
  });

  it('has no agent picker: the surface speaks as the workspace and ⋯ offers only New chat (§9.10)', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await page.getByRole('button', { name: 'Chat options' }).click();

    await expect.element(page.getByRole('menuitem', { name: /New chat/ })).toBeVisible();
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

  it('holds a boot skeleton and a disabled composer until the saved-thread lookup settles', async () => {
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
    // there are no suggestion chips to click yet, and the composer stays
    // disabled so a message can't be sent (and then silently discarded when
    // the restored transcript lands).
    await expect.element(page.getByPlaceholder('Ask anything…')).toBeDisabled();
    expect(page.getByRole('button', { name: 'Try this' }).elements()).toHaveLength(0);

    resolveGetState(null);

    await expect.element(page.getByPlaceholder('Ask anything…')).not.toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Try this' })).not.toBeDisabled();
  });
});
