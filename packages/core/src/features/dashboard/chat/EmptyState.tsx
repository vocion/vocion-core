'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

/**
 * Empty state — "insert quarter, shoot aliens".
 *
 * The chat home: a small org eyebrow, one greeting headline ("Ask Revenue"
 * on the workspace view; "Ask Founder GTM Lead" once a specific agent/team
 * is picked — the parent shell decides), and a quiet chip cloud. No glyphs,
 * no product copy, no instructional labels — the composer below is the whole
 * invitation. Chips fire `onPick(prompt)` which the parent shell auto-sends.
 *
 * Layout: one left-aligned content column (mobile-first, 390px). Chips are a
 * wrapping row cloud hugging the column's left edge under the greeting — not
 * a centered pyramid. The cloud reserves two pill rows of height so chips
 * fading in (or the loading shimmer swapping out) never shift the composer.
 *
 * Chips stay quiet: the top few ranked suggestions show; the rest expand in
 * place via a muted trailing "More" text-button at the end of the row.
 */

export type EmptyStateSuggestion = {
  label: string;
  prompt: string;
};

export type EmptyStateProps = {
  /** Org eyebrow + the name the headline asks about (workspace or agent). */
  greeting?: { eyebrow?: string; workspace: string };
  suggestions?: EmptyStateSuggestion[];
  /** True while a picked agent's chips are being synthesized server-side. */
  suggestionsLoading?: boolean;
  onPick: (prompt: string) => void;
  /** Optional interactive title (the agent-switcher caret) replacing the plain name. */
  titleSlot?: ReactNode;
};

/**
 * Chips visible before the "More" caret — exactly the two constant-label
 * anchors ("What should I do?" / "What can you do?", per Chris 2026-07-20).
 * The engine ranks them first; everything more specific expands in place.
 */
const VISIBLE_CHIPS = 2;

/**
 * Small quiet pill, ≥44px touch height (min-h-11) with tight visual padding.
 * Staggered 150ms fade-in — subtle, no layout shift (the cloud reserves its
 * height).
 */
const chipClass = 'min-h-11 max-w-full truncate rounded-full border border-border/70 bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition hover:border-brand-amber hover:bg-brand-amber-tint hover:text-brand-amber-deep animate-in fade-in fill-mode-both duration-150';

export function EmptyState({ greeting, suggestions = [], suggestionsLoading = false, onPick, titleSlot }: EmptyStateProps) {
  const [expanded, setExpanded] = useState(false);
  const workspace = greeting?.workspace ?? 'your workspace';

  const visible = expanded ? suggestions : suggestions.slice(0, VISIBLE_CHIPS);
  const hiddenCount = suggestions.length - VISIBLE_CHIPS;

  return (
    <div className="flex flex-1 flex-col justify-center px-4 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {greeting?.eyebrow && (
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {greeting.eyebrow}
          </p>
        )}

        <h2 className="font-display text-2xl font-light tracking-tight sm:text-3xl">
          Ask
          {' '}
          {titleSlot ?? <span className="text-brand-amber-deep">{workspace}</span>}
        </h2>

        {/* Chip cloud — left-aligned wrapping row. min-h reserves two pill
            rows (2 × 44px + gap) so the shimmer → chips swap is shift-free. */}
        {(suggestionsLoading || suggestions.length > 0) && (
          <div className="mt-6 flex min-h-24 w-full flex-wrap content-start items-start gap-2">
            {suggestionsLoading
              ? (
                  <>
                    <div className="h-11 w-44 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                    <div className="h-11 w-32 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                  </>
                )
              : (
                  <>
                    {visible.map((s, i) => (
                      <button
                        key={s.prompt}
                        type="button"
                        onClick={() => onPick(s.prompt)}
                        style={{ animationDelay: `${i * 40}ms` }}
                        className={chipClass}
                      >
                        {s.label}
                      </button>
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(e => !e)}
                        aria-label={expanded ? 'Show fewer suggestions' : `Show ${hiddenCount} more suggestions`}
                        className="flex min-h-11 items-center gap-1 px-2 py-1.5 text-sm text-muted-foreground/70 transition hover:text-foreground"
                      >
                        {expanded ? 'Less' : 'More'}
                        {expanded
                          ? <ChevronUp className="size-3.5" aria-hidden="true" />
                          : <ChevronDown className="size-3.5" aria-hidden="true" />}
                      </button>
                    )}
                  </>
                )}
          </div>
        )}
      </div>
    </div>
  );
}
