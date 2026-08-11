'use client';

import type { AgentOption } from './types';
import { Bot, Check, ChevronsUpDown, Clock, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ChatBubbleHeaderProps = {
  agentName: string;
  agents: AgentOption[];
  currentSlug: string;
  onSwitchAgent: (slug: string) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onClose: () => void;
  /** Starts dragging the panel. Called only when the pointerdown didn't land on a button — see `onPointerDown` below. */
  onDragStart: (event: React.PointerEvent) => void;
};

/**
 * Floating chat panel's header chrome: agent identity + switcher, plus the
 * Intercom-style action row (recent conversations, new chat, maximize /
 * restore, close-to-bubble). Visually distinct from the full-page
 * `AgentHeader` (compact, single row) but the same switcher semantics.
 * @param root0
 * @param root0.agentName
 * @param root0.agents
 * @param root0.currentSlug
 * @param root0.onSwitchAgent
 * @param root0.historyOpen
 * @param root0.onToggleHistory
 * @param root0.onNewChat
 * @param root0.maximized
 * @param root0.onToggleMaximize
 * @param root0.onClose
 * @param root0.onDragStart
 */
export function ChatBubbleHeader({
  agentName,
  agents,
  currentSlug,
  onSwitchAgent,
  historyOpen,
  onToggleHistory,
  onNewChat,
  maximized,
  onToggleMaximize,
  onClose,
  onDragStart,
}: ChatBubbleHeaderProps) {
  const switchable = agents.length > 1;

  const identity = (
    <span className="flex min-w-0 items-center gap-1.5 truncate font-display text-sm font-medium">
      <span className="truncate">{agentName}</span>
      {switchable && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </span>
  );

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    // Only start a drag when the pointer came down on the header's own
    // background — not on the agent switcher or one of the action buttons,
    // which need pointerdown to behave normally so their clicks still fire.
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    onDragStart(event);
  }

  return (
    <header
      onPointerDown={handlePointerDown}
      title="Drag to move the chat window"
      style={{ touchAction: 'none' }}
      className="flex cursor-grab items-center gap-2.5 border-b border-border bg-background px-3 py-2.5 active:cursor-grabbing"
    >
      {switchable
        ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="min-w-0 flex-1 cursor-pointer rounded-md px-1 py-0.5 text-left transition hover:bg-muted/60">
                {identity}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {agents.map(a => (
                  <DropdownMenuItem key={a.slug} onClick={() => onSwitchAgent(a.slug)}>
                    <Bot className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 truncate">{a.name}</span>
                    {a.slug === currentSlug && <Check className="ml-2 size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        : <div className="min-w-0 flex-1">{identity}</div>}

      <button type="button" onClick={onNewChat} aria-label="New chat" title="New chat" className="cursor-pointer text-muted-foreground transition hover:text-foreground">
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggleHistory}
        aria-label="Recent conversations"
        title="Recent conversations"
        aria-pressed={historyOpen}
        className={historyOpen ? 'cursor-pointer text-brand-amber-deep' : 'cursor-pointer text-muted-foreground transition hover:text-foreground'}
      >
        <Clock className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggleMaximize}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
        className="cursor-pointer text-muted-foreground transition hover:text-foreground"
      >
        {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
      <button type="button" onClick={onClose} aria-label="Close" title="Close" className="cursor-pointer text-muted-foreground transition hover:text-foreground">
        <X className="size-4" />
      </button>
    </header>
  );
}
