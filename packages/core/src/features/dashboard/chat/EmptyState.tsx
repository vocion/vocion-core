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
 * Layout (2026-09-15): one left-aligned column pinned to the BOTTOM of the
 * pane, ~28px above the composer. It floated dead-centre in a tall rail
 * before, which put the invitation as far from the box you type in as the
 * geometry allowed. The headline is one size down and one colour — the
 * two-tone "Ask <Workspace>" split the eye between an instruction and a name.
 *
 * Chips stay quiet and all one height: the top two ranked suggestions show,
 * the rest expand in place behind a ghost "More" at the end of the row. The
 * cloud reserves two pill rows so chips fading in (or the loading shimmer
 * swapping out) never shift the composer.
 *
 * On a short pane (a phone in landscape, a split rail) the headline steps
 * aside and the chips ARE the empty state — they are the actionable half.
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
  /** Disables the suggestion chips — e.g. while the session is still hydrating. */
  disabled?: boolean;
};

/**
 * Chips visible before the "More" caret — exactly the two constant-label
 * anchors ("What should I do?" / "What can you do?", per Chris 2026-07-20).
 * The engine ranks them first; everything more specific expands in place.
 */
const VISIBLE_CHIPS = 2;

/** The cap once "More" is tapped — still two wrapped rows at rail widths. */
const EXPANDED_CHIPS = 5;

/**
 * Small quiet pill — one height (40px) for every chip, "More" included, so
 * the cloud reads as one row of equals rather than a ragged mix. Staggered
 * 150ms fade-in; no layout shift, because the cloud reserves its height.
 */
const chipClass = 'flex h-10 max-w-full shrink-0 items-center truncate rounded-full border border-border/70 bg-background px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-brand-amber/60 hover:bg-brand-amber-tint hover:text-brand-amber-deep animate-in fade-in fill-mode-both duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border/70 disabled:hover:bg-background disabled:hover:text-muted-foreground';

export function EmptyState({ greeting, suggestions = [], suggestionsLoading = false, onPick, titleSlot, disabled = false }: EmptyStateProps) {
  const [expanded, setExpanded] = useState(false);
  const workspace = greeting?.workspace ?? 'your workspace';

  // Two rows of chips is the cap: the cloud is a nudge, not a menu. Expanded
  // shows the rest up to `EXPANDED_CHIPS`, which still wraps inside two rows
  // at the widths the rail actually opens at.
  const visible = expanded ? suggestions.slice(0, EXPANDED_CHIPS) : suggestions.slice(0, VISIBLE_CHIPS);
  const hiddenCount = suggestions.length - VISIBLE_CHIPS;

  return (
    // Bottom-aligned: the invitation sits just above the box it invites you
    // to type in, not in the middle of whatever height the rail happens to be.
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-7 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {/* Short pane: the chips are the empty state. */}
        <div className="[@media(max-height:560px)]:hidden">
          {greeting?.eyebrow && (
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {greeting.eyebrow}
            </p>
          )}

          <h2 className="font-display text-xl font-light tracking-tight text-foreground sm:text-2xl">
            Ask
            {' '}
            {titleSlot ?? workspace}
          </h2>
        </div>

        {/* Chip cloud — left-aligned wrapping row, one pill row reserved.
            The block is bottom-anchored now, so a shimmer → chips swap moves
            the headline, never the composer; reserving two rows only added a
            dead band between the chips and the box. */}
        {(suggestionsLoading || suggestions.length > 0) && (
          <div className="mt-4 flex min-h-10 w-full flex-wrap content-start items-start gap-2">
            {suggestionsLoading
              ? (
                  <>
                    <div className="h-10 w-44 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                    <div className="h-10 w-32 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                  </>
                )
              : (
                  <>
                    {visible.map((s, i) => (
                      <button
                        key={s.prompt}
                        type="button"
                        onClick={() => onPick(s.prompt)}
                        disabled={disabled}
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
                        className="flex h-10 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-foreground"
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
