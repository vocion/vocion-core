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
 * Agent header strip.
 *
 * The chat defaults to the workspace coordinator, so picking a *specific*
 * agent is secondary UX (per the design tenets: "manually targeting a
 * team/agent is secondary/tertiary — never the front door"). This strip is
 * therefore deliberately slim: a compact "Talking to <agent> ⌄" text-button
 * that opens the switcher, plus a small action slot (New Chat). The identity
 * of the surface lives in the empty state, not in a big top-of-page block.
 *
 * When more than one agent is available the label is a switcher. Coordinators
 * list first — you brief the coordinator; specialists are there when you need
 * to go direct. Switching starts a fresh conversation (parent handles that).
 */

export type AgentHeaderProps = {
  name: string;
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

export function AgentHeader({ name, action, agents = [], currentSlug, onSwitch }: AgentHeaderProps) {
  const switchable = agents.length > 1 && !!onSwitch;
  const leads = agents.filter(a => a.role === 'lead');
  const others = agents.filter(a => a.role !== 'lead');

  // Compact identity — muted "Talking to <name>", the name in full weight.
  // Same markup whether or not it's a switcher, so the strip never jumps.
  const label = (
    <span className="flex min-w-0 items-center gap-1.5">
      <Bot className="size-4 shrink-0 text-brand-amber-deep" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">Talking to</span>
      <span className="truncate font-medium text-foreground">{name}</span>
      {switchable && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </span>
  );

  return (
    <header className="border-b border-border bg-background/80 px-4 py-1.5 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        {switchable
          ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex min-h-11 min-w-0 items-center rounded-md px-2 text-sm transition hover:bg-muted/60" title="Switch agent">
                  {label}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {leads.length > 0 && (
                    <>
                      <DropdownMenuLabel className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Coordinator — brief the team</DropdownMenuLabel>
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
          : <div className="flex min-h-11 min-w-0 items-center px-2 text-sm">{label}</div>}

        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
