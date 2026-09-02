import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ChatBubbleHeader } from './ChatBubbleHeader';

const AGENTS = [
  { slug: 'orchestrator', name: 'GTM Orchestrator', icon: 'bot' as const, placeholder: '' },
  { slug: 'specialist', name: 'Pipeline Analyst', icon: 'bot' as const, placeholder: '' },
];

describe('ChatBubbleHeader', () => {
  it('shows the active agent name', async () => {
    await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={vi.fn()}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        onNewChat={vi.fn()}
        maximized={false}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onDragStart={vi.fn()}
      />,
    );

    await expect.element(page.getByText('GTM Orchestrator')).toBeInTheDocument();
  });

  it('calls onSwitchAgent when a different agent is picked from the dropdown', async () => {
    const onSwitchAgent = vi.fn();
    await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={onSwitchAgent}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        onNewChat={vi.fn()}
        maximized={false}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onDragStart={vi.fn()}
      />,
    );

    await userEvent.click(page.getByText('GTM Orchestrator'));
    await userEvent.click(page.getByText('Pipeline Analyst'));

    expect(onSwitchAgent).toHaveBeenCalledWith('specialist');
  });

  it('calls onToggleHistory, onNewChat, onToggleMaximize, and onClose from their respective buttons', async () => {
    const onToggleHistory = vi.fn();
    const onNewChat = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={vi.fn()}
        historyOpen={false}
        onToggleHistory={onToggleHistory}
        onNewChat={onNewChat}
        maximized={false}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
        onDragStart={vi.fn()}
      />,
    );

    await userEvent.click(page.getByRole('button', { name: 'New chat' }));
    await userEvent.click(page.getByRole('button', { name: 'Recent conversations' }));
    await userEvent.click(page.getByRole('button', { name: 'Maximize' }));
    await userEvent.click(page.getByRole('button', { name: 'Close' }));

    expect(onNewChat).toHaveBeenCalledOnce();
    expect(onToggleHistory).toHaveBeenCalledOnce();
    expect(onToggleMaximize).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('starts a drag when pointerdown lands on the header background', async () => {
    const onDragStart = vi.fn();
    const screen = await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={vi.fn()}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        onNewChat={vi.fn()}
        maximized={false}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onDragStart={onDragStart}
      />,
    );

    const header = screen.container.querySelector('header') as HTMLElement;
    header.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));

    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it('does not start a drag when pointerdown lands on an action button', async () => {
    const onDragStart = vi.fn();
    await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={vi.fn()}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        onNewChat={vi.fn()}
        maximized={false}
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onDragStart={onDragStart}
      />,
    );

    const closeButton = page.getByRole('button', { name: 'Close' }).element() as HTMLElement;
    closeButton.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('shows Restore instead of Maximize when already maximized', async () => {
    await render(
      <ChatBubbleHeader
        agentName="GTM Orchestrator"
        agents={AGENTS}
        currentSlug="orchestrator"
        onSwitchAgent={vi.fn()}
        historyOpen={false}
        onToggleHistory={vi.fn()}
        onNewChat={vi.fn()}
        maximized
        onToggleMaximize={vi.fn()}
        onClose={vi.fn()}
        onDragStart={vi.fn()}
      />,
    );

    await expect.element(page.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});
