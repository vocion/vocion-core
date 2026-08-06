import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

vi.mock('@/libs/Orpc', () => ({
  client: { conversations: { list: vi.fn() } },
}));

const { client } = await import('@/libs/Orpc');
const { ChatBubbleHistoryPanel } = await import('./ChatBubbleHistoryPanel');

beforeEach(() => {
  vi.mocked(client.conversations.list).mockReset();
});

describe('ChatBubbleHistoryPanel', () => {
  it('lists conversations with title and message count', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 1, title: 'What can you do', messageCount: 30, updatedAt: new Date(), orgId: 'o', agentSlug: 'a', createdBy: null, createdAt: new Date() },
      { id: 2, title: 'How many have we enrolled', messageCount: 6, updatedAt: new Date(), orgId: 'o', agentSlug: 'a', createdBy: null, createdAt: new Date() },
    ] as never);

    await render(<ChatBubbleHistoryPanel agentSlug="orchestrator" activeConversationId={null} onSelect={vi.fn()} />);

    await expect.element(page.getByText('What can you do')).toBeInTheDocument();
    await expect.element(page.getByText(/30 msgs/)).toBeInTheDocument();
    await expect.element(page.getByText('How many have we enrolled')).toBeInTheDocument();
  });

  it('shows an empty message when there are no conversations for this agent', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([]);

    await render(<ChatBubbleHistoryPanel agentSlug="orchestrator" activeConversationId={null} onSelect={vi.fn()} />);

    await expect.element(page.getByText('No conversations yet.')).toBeInTheDocument();
  });

  it('calls onSelect with the conversation id when a row is clicked', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([
      { id: 1, title: 'What can you do', messageCount: 1, updatedAt: new Date(), orgId: 'o', agentSlug: 'a', createdBy: null, createdAt: new Date() },
    ] as never);
    const onSelect = vi.fn();

    await render(<ChatBubbleHistoryPanel agentSlug="orchestrator" activeConversationId={null} onSelect={onSelect} />);
    await userEvent.click(page.getByText('What can you do'));

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('re-fetches when agentSlug changes', async () => {
    vi.mocked(client.conversations.list).mockResolvedValue([]);
    const { rerender } = await render(<ChatBubbleHistoryPanel agentSlug="orchestrator" activeConversationId={null} onSelect={vi.fn()} />);
    await vi.waitFor(() => expect(client.conversations.list).toHaveBeenCalledWith({ agentSlug: 'orchestrator' }));

    await rerender(<ChatBubbleHistoryPanel agentSlug="specialist" activeConversationId={null} onSelect={vi.fn()} />);

    await vi.waitFor(() => expect(client.conversations.list).toHaveBeenCalledWith({ agentSlug: 'specialist' }));
  });
});
