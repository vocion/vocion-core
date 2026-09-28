'use client';

import { Check, ClipboardCopy, MessagesSquare, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { chatHotkeyLabel } from './chatHotkeys';

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
  /** The thread as plain text, built only when someone asks for it. Absent on a surface with nothing to copy yet. */
  onCopy?: (() => string) | null;
};

export function ChatMenu({ onCopy }: ChatMenuProps) {
  const t = useTranslations('Chat');
  const [copied, setCopied] = useState(false);
  // TAKING THE ANSWER WITH YOU.
  //
  // A conversation here is where the reasoning, the figures and the decision
  // already live, and the only way out of it was to select text by hand on a
  // phone — across message bubbles, tool rows and a live trace. Chris,
  // 2026-09-22: *"I want a copy chat menu item."*
  //
  // The transcript is built at the moment of the click rather than kept in
  // state: it can be long, it changes on every token, and nothing needs it
  // until somebody asks.
  const copy = async () => {
    if (!onCopy) {
      return;
    }
    try {
      await navigator.clipboard.writeText(onCopy());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // A refused clipboard is not worth an error dialog; the label simply
      // does not change, and the person can try again.
    }
  };
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
        {onCopy && (
          <DropdownMenuItem
            data-testid="copy-conversation"
            onSelect={(e) => {
              // Keep the menu open long enough to show that it worked.
              e.preventDefault();
              void copy();
            }}
          >
            {copied
              ? <Check className="text-brand-ok mr-2 size-4" aria-hidden="true" />
              : <ClipboardCopy className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy conversation'}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/conversations">
            <MessagesSquare className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
            {t('all_conversations')}
            <DropdownMenuShortcut>{chatHotkeyLabel('all-conversations')}</DropdownMenuShortcut>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
