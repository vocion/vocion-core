import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

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

const { client } = await import('@/libs/Orpc');
const { ChatShell } = await import('./ChatShell');

/**
 * The chat surfaces read their copy from the `Chat` namespace; tests render inside the provider the shell supplies.
 * @param ui
 */
function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;
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
  it('names the active agent on the empty state once boot settles', async () => {
    await render(wrap(<ChatShell agents={AGENTS} />));

    await expect.element(page.getByText('GTM Orchestrator').first()).toBeInTheDocument();
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
