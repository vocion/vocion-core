'use client';

import { MoreHorizontal, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The one chat menu — the Claude-app "⋯ sheet" pattern.
 *
 * "Insert quarter, shoot aliens": the chat surface is messages + composer,
 * period. There is no agent to pick (agent-chat-surface.md §9.10: one
 * workspace agent, routing is delegation) and history has its own popover,
 * so the menu is the one thing left that is configurational: starting over.
 */

export type ChatMenuProps = {
  onNewChat: () => void;
};

export function ChatMenu({ onNewChat }: ChatMenuProps) {
  const t = useTranslations('Chat');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Chat options"
        title="Chat options"
        className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground data-[state=open]:text-foreground sm:size-9"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onNewChat}>
          <SquarePen className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
          {t('new_chat')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
