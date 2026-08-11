import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn() },
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
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
});

describe('ChatShell', () => {
  it('renders the active agent name and the empty state', async () => {
    await render(<ChatShell agents={AGENTS} />);

    await expect.element(page.getByText('GTM Orchestrator').first()).toBeInTheDocument();
  });

  it('switching agents via the header dropdown updates the displayed name', async () => {
    const { getByText, getByRole } = page;
    await render(<ChatShell agents={AGENTS} />);

    await getByText('GTM Orchestrator').first().click();
    await getByRole('menuitem', { name: 'Pipeline Analyst' }).click();

    await expect.element(page.getByText('Pipeline Analyst', { exact: true }).first()).toBeInTheDocument();
  });

  it('disables the composer and suggestion buttons until hydration settles, then enables them', async () => {
    // Control exactly when `useLastViewedConversation`'s server round-trip
    // resolves, so we can assert the disabled state mid-flight instead of
    // only after everything has already settled. No persisted conversation
    // here, so once this resolves `hydrated` flips true with no further
    // `conversations.get` fetch to wait on.
    let resolveGetState!: (value: unknown) => void;
    const getStatePromise = new Promise((resolve) => {
      resolveGetState = resolve;
    });
    vi.mocked(client.chatWidget.getState).mockReturnValue(getStatePromise as never);

    await render(<ChatShell agents={AGENTS} suggestions={[{ label: 'Try this', prompt: 'Do the thing' }]} />);

    // Hydration is still in flight — the composer textbox and the
    // suggestion buttons must stay disabled so a user can't send a message
    // (or click a suggestion, which sends one directly) that a
    // later-arriving setMessages(...) from hydration would silently
    // discard.
    await expect.element(page.getByPlaceholder('Ask…')).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Try this' })).toBeDisabled();

    resolveGetState(null);

    await expect.element(page.getByPlaceholder('Ask…')).not.toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Try this' })).not.toBeDisabled();
  });
});
