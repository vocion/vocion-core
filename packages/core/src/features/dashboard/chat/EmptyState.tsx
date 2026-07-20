'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

/**
 * Empty state — "insert quarter, shoot aliens".
 *
 * The chat home: a small org eyebrow, one greeting headline ("Ask Revenue"
 * on the workspace view; "Ask Founder GTM Lead" once a specific agent/team
 * is picked — the parent shell decides), and a couple of tappable chips.
 * No glyphs, no product copy, no instructional labels — the composer below
 * is the whole invitation. Chips fire `onPick(prompt)` which the parent
 * shell auto-sends.
 *
 * Chips stay quiet: the top few ranked suggestions show; the rest hide
 * behind a small "More" caret.
 */

export type EmptyStateSuggestion = {
  label: string;
  prompt: string;
};

export type EmptyStateProps = {
  /** Org eyebrow + the name the headline asks about (workspace or agent). */
  greeting?: { eyebrow?: string; workspace: string };
  suggestions?: EmptyStateSuggestion[];
  onPick: (prompt: string) => void;
};

/** Chips visible before the "More" caret. The engine already ranks them. */
const VISIBLE_CHIPS = 3;

export function EmptyState({ greeting, suggestions = [], onPick }: EmptyStateProps) {
  const [expanded, setExpanded] = useState(false);
  const workspace = greeting?.workspace ?? 'your workspace';

  const visible = expanded ? suggestions : suggestions.slice(0, VISIBLE_CHIPS);
  const hiddenCount = suggestions.length - visible.length;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center sm:px-6">
      {greeting?.eyebrow && (
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {greeting.eyebrow}
        </p>
      )}

      <h2 className="font-display text-2xl font-light tracking-tight sm:text-3xl">
        Ask
        {' '}
        <span className="text-brand-amber-deep">{workspace}</span>
      </h2>

      {suggestions.length > 0 && (
        <div className="mt-8 flex w-full max-w-md flex-wrap items-center justify-center gap-2">
          {visible.map(s => (
            <button
              key={s.prompt}
              type="button"
              onClick={() => onPick(s.prompt)}
              className="min-h-11 rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground transition hover:border-brand-amber hover:bg-brand-amber-tint hover:text-brand-amber-deep"
            >
              {s.label}
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`Show ${hiddenCount} more suggestions`}
              className="flex min-h-11 items-center gap-1 rounded-full px-3 py-2 text-sm text-muted-foreground/70 transition hover:text-foreground"
            >
              More
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
