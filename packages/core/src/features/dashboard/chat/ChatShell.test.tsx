import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    chat: { suggestions: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { ChatShell } = await import('./ChatShell');

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
    await render(<ChatShell agents={AGENTS} />);

    await expect.element(page.getByText('GTM Orchestrator').first()).toBeInTheDocument();
  });

  it('switching agents from the empty-state title updates the displayed name', async () => {
    const { getByText, getByRole } = page;
    await render(<ChatShell agents={AGENTS} />);

    await getByText('GTM Orchestrator').first().click();
    await getByRole('menuitem', { name: 'Pipeline Analyst' }).click();

    await expect.element(page.getByText('Pipeline Analyst', { exact: true }).first()).toBeInTheDocument();
  });

  it('shows an empty state instead of crashing when there are no agents', async () => {
    // `chat/page.tsx` hands over an empty list whenever it cannot resolve a
    // workspace. `useChatSession` reads `agents[0]!.slug`, so the page used to
    // throw here rather than render anything.
    await render(<ChatShell agents={[]} />);

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

    await render(<ChatShell agents={AGENTS} suggestions={[{ label: 'Try this', prompt: 'Do the thing' }]} />);

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
