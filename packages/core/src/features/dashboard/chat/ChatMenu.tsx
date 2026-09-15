'use client';

import { MessagesSquare, MoreHorizontal, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';

/**
 * The one chat menu — the Claude-app "⋯ sheet" pattern.
 *
 * "Insert quarter, shoot aliens": the chat surface is messages + composer,
 * period. There is no agent to pick (agent-chat-surface.md §9.10: one
 * workspace agent, routing is delegation) and history has its own popover,
 * so the menu holds the two things left that are not the conversation:
 * starting over, and the way out to the list of every thread. That second
 * row was an underlined link in the rail header until 2026-09-15, where it
 * read as an error and stole a whole line from a 48px header — and it pointed
 * at `/dashboard/chat`, which opens a NEW chat rather than listing the old
 * ones. It goes to `/dashboard/conversations` now.
 */

export type ChatMenuProps = {
  onNewChat: () => void;
};

export function ChatMenu({ onNewChat }: ChatMenuProps) {
  const t = useTranslations('Chat');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={t('chat_options')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>{t('chat_options')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" collisionPadding={8} className="w-56">
        <DropdownMenuItem onClick={onNewChat}>
          <SquarePen className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
          {t('new_chat')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/conversations">
            <MessagesSquare className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
            {t('all_conversations')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
