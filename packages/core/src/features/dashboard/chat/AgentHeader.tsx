'use client';

import { Bot } from 'lucide-react';

/**
 * Agent header strip (Phase C).
 *
 * The single identity block of the chat surface: eyebrow · agent name ·
 * one-line scope, with an optional action slot (New Chat) on the right.
 * The chat page renders no other chrome above this — the agent header
 * IS the page title.
 */

export type AgentHeaderProps = {
  name: string;
  eyebrow?: string;
  description?: string;
  /** Rendered flush right (e.g. a New Chat button). */
  action?: React.ReactNode;
};

export function AgentHeader({ name, eyebrow, description, action }: AgentHeaderProps) {
  return (
    <header className="border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-brand-amber-tint text-brand-amber-deep">
          <Bot className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {eyebrow}
            </div>
          )}
          <div className="font-display text-lg leading-tight font-medium">
            {name}
          </div>
          {description && (
            <div className="truncate text-xs text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </header>
  );
}
