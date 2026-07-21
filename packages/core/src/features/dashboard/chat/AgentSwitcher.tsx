'use client';

import type { AgentOption } from './types';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * AgentSwitcher — the caret-dropdown that swaps the active agent.
 *
 * Shared so switching is available in two places from ONE implementation:
 *   - variant="title": the big "Ask <name> ▾" empty-state headline slot.
 *   - variant="bar":   a compact pill for the shell top bar (persistent,
 *     available mid-conversation).
 *
 * Leads only (same rule as ChatMenu): the workspace lead + team leads +
 * the current selection. When there's nothing to switch to, renders the
 * label as plain text with no caret — no dead affordance.
 */

export type AgentSwitcherProps = {
  agents: AgentOption[];
  currentSlug: string;
  onSwitch: (slug: string) => void;
  /** Text in the trigger — usually the current agent/workspace name. */
  label: string;
  variant?: 'title' | 'bar';
};

export function AgentSwitcher({ agents, currentSlug, onSwitch, label, variant = 'bar' }: AgentSwitcherProps) {
  const leads = agents.filter(a => !a.parentSlug || a.slug === currentSlug);

  if (leads.length <= 1) {
    return variant === 'title'
      ? <span className="text-brand-amber-deep">{label}</span>
      : <span className="truncate text-sm font-medium text-foreground/80">{label}</span>;
  }

  const triggerClass = variant === 'title'
    ? 'group inline-flex max-w-full items-center gap-1 text-brand-amber-deep transition hover:opacity-80 data-[state=open]:opacity-80'
    : 'group inline-flex max-w-[60vw] items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium text-foreground/80 transition hover:bg-muted/60 hover:text-foreground data-[state=open]:bg-muted/60 sm:max-w-xs';

  const caretClass = variant === 'title'
    ? 'size-5 shrink-0 opacity-50 transition group-hover:opacity-80'
    : 'size-4 shrink-0 opacity-50 transition group-hover:opacity-80';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass} aria-label="Switch agent">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={caretClass} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={variant === 'title' ? 'start' : 'center'} className="w-60">
        {leads.map(a => (
          <DropdownMenuItem key={a.slug} onClick={() => onSwitch(a.slug)}>
            <span className="min-w-0 flex-1 truncate">{a.name}</span>
            {a.slug === currentSlug && <Check className="ml-2 size-4 shrink-0" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
