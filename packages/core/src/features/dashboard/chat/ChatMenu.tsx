'use client';

import type { AgentOption } from './types';
import { Check, History, MoreHorizontal, SquarePen } from 'lucide-react';
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
 * a specific agent — lives behind this single small trigger. It's portaled
 * into the shell top bar (beside the account menu) rather than floating over
 * the conversation, so the canvas stays clean. The workspace lead answers by
 * default, so the agent list here is deliberately secondary UX: names + a
 * check, no section headers, no explanations.
 *
 * Leads only: the switcher lists the workspace lead + the team leads (the
 * parentless primaries) + the virtual Search entry. Specialists (anything
 * with a parent) stay hidden — you reach them through their lead, not a
 * long flat roster. A specialist that IS the current selection (deep link)
 * stays visible so the check always lands somewhere.
 */

export type ChatMenuProps = {
  onNewChat: () => void;
  /** Recent conversations for the current agent — the history picker. */
  conversations?: Array<{ id: number; title: string }>;
  onPickConversation?: (id: number) => void;
  /** All available agents — specialists are filtered out here. */
  agents?: AgentOption[];
  currentSlug?: string;
  onSwitch?: (slug: string) => void;
};

export function ChatMenu({ onNewChat, agents = [], currentSlug, onSwitch, conversations = [], onPickConversation }: ChatMenuProps) {
  const leads = agents.filter(a => !a.parentSlug || a.slug === currentSlug);
  const switchable = leads.length > 1 && !!onSwitch;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Chat options"
        title="Chat options"
        className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground data-[state=open]:text-foreground sm:size-9"
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={onNewChat}>
          <SquarePen className="mr-2 size-4 text-muted-foreground" aria-hidden="true" />
          New chat
        </DropdownMenuItem>
        {conversations.length > 0 && !!onPickConversation && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              <History className="size-3" aria-hidden="true" />
              Recent chats
            </div>
            {conversations.slice(0, 8).map(c => (
              <DropdownMenuItem key={c.id} onClick={() => onPickConversation(c.id)}>
                <span className="flex-1 truncate">{c.title}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {switchable && (
          <>
            <DropdownMenuSeparator />
            {leads.map(a => (
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
