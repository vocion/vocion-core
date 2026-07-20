'use client';

import type { AgentOption } from './types';
import { Check, MoreHorizontal, SquarePen } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The one chat menu — the Claude-app "⋯ sheet" pattern.
 *
 * "Insert quarter, shoot aliens": the chat surface is messages + composer,
 * period. Everything configurational — starting over, pointing the chat at
 * a specific agent — lives behind this single small trigger instead of
 * permanent chrome. The workspace coordinator answers by default, so the
 * agent list here is deliberately secondary UX: names + a check, no
 * section headers, no explanations.
 */

export type ChatMenuProps = {
  onNewChat: () => void;
  /** All available agents — listed when > 1. */
  agents?: AgentOption[];
  currentSlug?: string;
  onSwitch?: (slug: string) => void;
};

export function ChatMenu({ onNewChat, agents = [], currentSlug, onSwitch }: ChatMenuProps) {
  const switchable = agents.length > 1 && !!onSwitch;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Chat options"
        title="Chat options"
        className="flex size-11 items-center justify-center rounded-full bg-background/70 text-muted-foreground backdrop-blur transition hover:bg-muted/60 hover:text-foreground data-[state=open]:bg-muted/60 data-[state=open]:text-foreground"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={onNewChat}>
          <SquarePen className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
          New chat
        </DropdownMenuItem>
        {switchable && (
          <>
            <DropdownMenuSeparator />
            {agents.map(a => (
              <DropdownMenuItem key={a.slug} onClick={() => onSwitch?.(a.slug)}>
                <span className="flex-1 truncate">{a.name}</span>
                {a.slug === currentSlug && <Check className="ml-2 size-4 shrink-0" aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
