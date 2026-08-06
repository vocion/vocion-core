import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: {
    chatWidget: { getState: vi.fn(), setState: vi.fn() },
    conversations: { get: vi.fn(), create: vi.fn(), list: vi.fn() },
  },
}));

const { client } = await import('@/libs/Orpc');
const { ChatBubble } = await import('./ChatBubble');

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: 'Ask…', role: 'lead' as const },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: 'Ask…', role: 'specialist' as const },
];

const VISUAL_STATE_KEY = 'vocion_chat_bubble_visual_state';

beforeEach(() => {
  localStorage.clear();
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

  it('renders nothing when there are no agents', async () => {
    const { container } = await render(<ChatBubble agents={[]} />);

    expect(container.textContent).toBe('');
  });
});
