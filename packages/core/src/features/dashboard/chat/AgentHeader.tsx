'use client';

import type { AgentOption } from './types';
import { Bot, Check, ChevronsUpDown, Compass, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Agent header strip (Phase C).
 *
 * The single identity block of the chat surface: eyebrow · agent name ·
 * one-line scope, with an optional action slot (New Chat) on the right.
 * The chat page renders no other chrome above this — the agent header
 * IS the page title.
 *
 * When more than one agent is available the name is a picker. Leads list
 * first — you brief the Lead; specialists are there when you need to go
 * direct. Switching starts a fresh conversation (parent handles that).
 */

export type AgentHeaderProps = {
  name: string;
  eyebrow?: string;
  description?: string;
  /** Rendered flush right (e.g. a New Chat button). */
  action?: React.ReactNode;
  /** All available agents — enables the switcher when > 1. */
  agents?: AgentOption[];
  currentSlug?: string;
  onSwitch?: (slug: string) => void;
};

function iconFor(a: AgentOption) {
  if (a.icon === 'search') {
    return Search;
  }
  return a.role === 'lead' ? Compass : Bot;
}

export function AgentHeader({ name, eyebrow, description, action, agents = [], currentSlug, onSwitch }: AgentHeaderProps) {
  const switchable = agents.length > 1 && !!onSwitch;
  const leads = agents.filter(a => a.role === 'lead');
  const others = agents.filter(a => a.role !== 'lead');

  const identity = (
    <div className="min-w-0 flex-1 text-left">
      {eyebrow && (
        <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {eyebrow}
        </div>
      )}
      <div className="flex items-center gap-1.5 font-display text-lg leading-tight font-medium">
        <span className="sm:truncate">{name}</span>
        {switchable && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </div>
      {description && (
        <div className="truncate text-xs text-muted-foreground">
          {description}
        </div>
      )}
    </div>
  );

  return (
    <header className="border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-4xl items-center gap-2.5 sm:gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber-tint text-brand-amber-deep">
          <Bot className="size-5" aria-hidden="true" />
        </div>

        {switchable
          ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="min-w-0 flex-1 rounded-md px-1 py-0.5 transition hover:bg-muted/60" title="Switch agent">
                  {identity}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {leads.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Leads — brief the team</DropdownMenuLabel>
                      {leads.map((a) => {
                        const Icon = iconFor(a);
                        return (
                          <DropdownMenuItem key={a.slug} onClick={() => onSwitch?.(a.slug)}>
                            <Icon className="mr-2 size-4 text-brand-amber-deep" />
                            <span className="flex-1 truncate">{a.name}</span>
                            {a.slug === currentSlug && <Check className="ml-2 size-4" />}
                          </DropdownMenuItem>
                        );
                      })}
                      {others.length > 0 && <DropdownMenuSeparator />}
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Go direct</DropdownMenuLabel>
                      {others.map((a) => {
                        const Icon = iconFor(a);
                        return (
                          <DropdownMenuItem key={a.slug} onClick={() => onSwitch?.(a.slug)}>
                            <Icon className="mr-2 size-4 text-muted-foreground" />
                            <span className="flex-1 truncate">{a.name}</span>
                            {a.slug === currentSlug && <Check className="ml-2 size-4" />}
                          </DropdownMenuItem>
                        );
                      })}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          : identity}

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
