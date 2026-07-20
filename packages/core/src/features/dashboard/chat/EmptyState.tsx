'use client';

import { ArrowRight, Sparkles } from 'lucide-react';

/**
 * Empty-state with suggestion cards (Phase C — rev-ai pattern).
 *
 * Centered accent glyph + heading + a stacked list of one-click
 * suggestions. Each suggestion fires `onPick(prompt)` which the
 * parent shell wires into the composer + auto-send.
 */

export type EmptyStateSuggestion = {
  label: string;
  prompt: string;
};

export type EmptyStateProps = {
  agentName?: string;
  suggestions?: EmptyStateSuggestion[];
  onPick: (prompt: string) => void;
};

export function EmptyState({ agentName = 'this agent', suggestions = [], onPick }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6 sm:py-16">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-brand-amber-tint text-brand-amber-deep shadow-sm sm:size-14">
        <Sparkles className="size-6 sm:size-7" aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-display text-xl font-light tracking-tight sm:mt-6 sm:text-2xl">
        Start a conversation with
        {' '}
        <span className="text-brand-amber-deep">{agentName}</span>
      </h2>
      {suggestions.length > 0 && (
        <p className="mt-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Try one of these, or type your own
        </p>
      )}

      {suggestions.length > 0 && (
        <div className="mt-6 w-full max-w-xl divide-y divide-border rounded-xl border border-border bg-muted/40 shadow-sm sm:mt-8">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(s.prompt)}
              className="group flex min-h-11 w-full items-start justify-between gap-4 px-5 py-4 text-left text-sm transition hover:bg-brand-amber-tint hover:text-brand-amber-deep"
            >
              <span className="flex-1">{s.label}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-brand-amber-deep" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
