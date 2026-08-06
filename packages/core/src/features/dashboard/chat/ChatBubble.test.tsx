import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn() },
  },
}));

const mockUsePathname = vi.fn(() => '/dashboard');
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    usePathname: () => mockUsePathname(),
  };
});

const { client } = await import('@/libs/Orpc');
const { ChatBubble } = await import('./ChatBubble');

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

const VISUAL_STATE_KEY = 'vocion_chat_bubble_visual_state';

beforeEach(() => {
  localStorage.clear();
  mockUsePathname.mockReset().mockReturnValue('/dashboard');
  vi.mocked(client.chatWidget.getState).mockReset().mockResolvedValue(null);
  vi.mocked(client.chatWidget.setState).mockReset().mockResolvedValue({ agentSlug: 'orchestrator', conversationId: null });
  vi.mocked(client.conversations.get).mockReset();
  vi.mocked(client.conversations.create).mockReset();
  vi.mocked(client.conversations.list).mockReset().mockResolvedValue([]);
});

describe('ChatBubble', () => {
  it('renders only the trigger button when hidden by default', async () => {
    await render(<ChatBubble agents={AGENTS} />);

    await expect.element(page.getByRole('button', { name: 'Open chat' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('opens to the normal-size panel when the trigger is clicked', async () => {
    await render(<ChatBubble agents={AGENTS} />);

    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));

    await expect.element(page.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
    // .first(): 'GTM Orchestrator' legitimately renders twice once the panel
    // is open — once in the header's agent switcher, once inside the
    // EmptyState heading ("Start a conversation with GTM Orchestrator") —
    // so an unscoped getByText is a strict-mode violation. Either instance
    // proves the panel picked up the right agent.
    await expect.element(page.getByText('GTM Orchestrator').first()).toBeInTheDocument();
  });

  it('re-opens already-open on remount when the visual state was persisted as normal', async () => {
    localStorage.setItem(VISUAL_STATE_KEY, 'normal');
    await render(<ChatBubble agents={AGENTS} />);

    await expect.element(page.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
  });

  it('toggling maximize swaps the Maximize button for Restore', async () => {
    await render(<ChatBubble agents={AGENTS} />);
    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));

    await userEvent.click(page.getByRole('button', { name: 'Maximize' }));

    await expect.element(page.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });

  it('pressing Escape closes the panel and shows the trigger button again', async () => {
    await render(<ChatBubble agents={AGENTS} />);
    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));

    await expect.element(page.getByRole('dialog', { name: 'Chat' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('button', { name: 'Open chat' })).toBeInTheDocument();
    await expect.element(page.getByRole('dialog', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('pressing Escape while history is open closes history first, then the panel on a second Escape', async () => {
    await render(<ChatBubble agents={AGENTS} />);
    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));
    await userEvent.click(page.getByRole('button', { name: 'Recent conversations' }));

    await expect.element(page.getByRole('button', { name: 'Recent conversations' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.keyboard('{Escape}');

    // First Escape only dismisses history — the dialog is still open.
    await expect.element(page.getByRole('dialog', { name: 'Chat' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'Recent conversations' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.keyboard('{Escape}');

    await expect.element(page.getByRole('dialog', { name: 'Chat' })).not.toBeInTheDocument();
  });

  it('closing hides the panel and shows the trigger button again', async () => {
    await render(<ChatBubble agents={AGENTS} />);
    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));

    await userEvent.click(page.getByRole('button', { name: 'Close' }));

    await expect.element(page.getByRole('button', { name: 'Open chat' })).toBeInTheDocument();
    await expect.element(page.getByText('GTM Orchestrator')).not.toBeInTheDocument();
  });

  it('opening the history panel lists recent conversations and selecting one loads it', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 3, title: 'Prior thread', messageCount: 4, updatedAt: new Date(), orgId: 'o', agentSlug: 'orchestrator', createdBy: null, createdAt: new Date() },
    ] as never);
    vi.mocked(client.conversations.get).mockResolvedValue({
      id: 3,
      orgId: 'o',
      agentSlug: 'orchestrator',
      title: 'Prior thread',
      messageCount: 1,
      messages: [{ id: 1, conversationId: 3, role: 'user', content: 'resumed', runsJson: null, createdAt: new Date() }],
    } as never);
    await render(<ChatBubble agents={AGENTS} />);
    await userEvent.click(page.getByRole('button', { name: 'Open chat' }));

    await userEvent.click(page.getByRole('button', { name: 'Recent conversations' }));

    await expect.element(page.getByText('Prior thread')).toBeInTheDocument();

    await userEvent.click(page.getByText('Prior thread'));

    await expect.element(page.getByText('resumed')).toBeInTheDocument();
  });

  it('renders nothing when there are no agents, and never mounts the chat session', async () => {
    const { container } = await render(<ChatBubble agents={[]} />);

    expect(container.textContent).toBe('');
    // Regression guard: with agents=[], ChatBubble must bail out to null
    // BEFORE useChatSession (and its useLastViewedConversation call) ever
    // mounts — otherwise a brand-new org with zero agents would fire a live
    // chatWidget.getState() on every page load, and a pending Briefings
    // handoff stash could even trigger a real conversations.create() write
    // under a bogus agent slug. container.textContent alone can't catch
    // that leak since it only checks what got rendered, not what ran.
    expect(client.chatWidget.getState).not.toHaveBeenCalled();
    expect(client.conversations.create).not.toHaveBeenCalled();
  });

  it('renders nothing on the /dashboard/chat route, and never mounts the chat session', async () => {
    mockUsePathname.mockReturnValue('/dashboard/chat');

    const { container } = await render(<ChatBubble agents={AGENTS} />);

    expect(container.textContent).toBe('');
    // Same regression guard as the empty-agents case above: on the
    // full-page chat route, ChatBubble must bail out to null BEFORE
    // useChatSession ever mounts — otherwise the bubble and ChatShell would
    // both consume the same one-shot sessionStorage handoff stash, and
    // whichever won the race would swallow a Briefings hand-off meant for
    // the visible ChatShell.
    expect(client.chatWidget.getState).not.toHaveBeenCalled();
    expect(client.conversations.create).not.toHaveBeenCalled();
  });
});
