'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AgentMark } from './AgentMark';
import { partOfDay, startersToShow } from './emptyChat';

/**
 * Empty state: the workspace says hello, through its lead.
 *
 * "Chat should always start with a much warmer intro with very little on the
 * chat screen. Not jump right to big asks. Maybe a soft nudge or chip. If
 * that." (founder, 2026-10-08). So an empty conversation is the workspace,
 * speaking through its lead, with one line ("Good afternoon, Sam. What can I help with?"), at most three
 * quiet starters, and at most one soft nudge the surface passes in (what is
 * waiting on the person, as a count, never as cards: `emptyChat.ts`).
 *
 * It replaced "Ask <Workspace>" under an Org eyebrow, which read as an
 * instruction rather than a greeting, and a chip cloud that expanded behind
 * "More": the cloud is a nudge, not a menu.
 *
 * Layout (2026-09-15, kept): one left-aligned column pinned to the BOTTOM of
 * the pane, ~28px above the composer, so the invitation sits just above the
 * box it invites you to type in. It scrolls on its own when the pane is
 * short, and on a very short pane (a phone in landscape) the greeting steps
 * aside and the starters are the empty state.
 */

export type EmptyStateSuggestion = {
  label: string;
  prompt: string;
};

export type EmptyStateProps = {
  /**
   * Who says hello: the workspace, which speaks through its lead and is
   * never named as an agent here (§9.10). Omitted, the greeting stands alone.
   */
  speaker?: string;
  /** The person's first name, for the greeting. Null or omitted greets without a name. */
  firstName?: string | null;
  /** Starters, best first; at most three show. */
  suggestions?: EmptyStateSuggestion[];
  /** True while a picked agent's chips are being synthesized server-side. */
  suggestionsLoading?: boolean;
  onPick: (prompt: string) => void;
  /** The one soft nudge under the starters (what waits on the person), when there is one. */
  nudge?: ReactNode;
  /** Disables the suggestion chips — e.g. while the session is still hydrating. */
  disabled?: boolean;
  /** The hour the greeting is for (0–23). Default: the person's clock now. */
  hour?: number;
};

/**
 * Small quiet pill — one height (36px) for every chip. A hairline and a
 * neutral hover: an amber wash on every hover made a nudge shout. Staggered
 * 150ms fade-in.
 */
const chipClass = 'flex h-9 pointer-coarse:h-10 max-w-full shrink-0 items-center truncate rounded-full border border-border bg-background px-3.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground animate-in fade-in fill-mode-both duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-muted-foreground';

/**
 * The lead's greeting and a few starters.
 * @param props - See {@link EmptyStateProps}.
 * @param props.speaker
 * @param props.firstName
 * @param props.suggestions
 * @param props.suggestionsLoading
 * @param props.onPick
 * @param props.nudge
 * @param props.disabled
 * @param props.hour
 */
export function EmptyState({ speaker, firstName, suggestions = [], suggestionsLoading = false, onPick, nudge, disabled = false, hour }: EmptyStateProps) {
  const t = useTranslations('Chat');
  const part = partOfDay(hour ?? new Date().getHours());
  const line = firstName ? t('greeting_named', { part, name: firstName }) : t('greeting', { part });
  const visible = startersToShow(suggestions);

  return (
    <div data-testid="chat-empty-state" className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-4 pb-7 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        {/* Short pane: the starters are the empty state. */}
        <div className="[@media(max-height:560px)]:hidden">
          {speaker && (
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground" data-testid="chat-empty-speaker">
              <AgentMark name={speaker} decorative />
              <span className="truncate">{speaker}</span>
            </div>
          )}
          {/* The part of the day is the person's clock, which the server does not know. */}
          <h2 className="font-display text-xl font-light tracking-tight text-foreground sm:text-2xl" data-testid="chat-greeting" suppressHydrationWarning>
            {line}
          </h2>
        </div>

        {(suggestionsLoading || visible.length > 0) && (
          <div className="mt-4 flex min-h-9 w-full flex-wrap content-start items-start gap-2">
            {suggestionsLoading
              ? (
                  <>
                    <div className="h-9 w-44 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                    <div className="h-9 w-32 max-w-full animate-pulse rounded-full bg-muted/70" aria-hidden="true" />
                  </>
                )
              : visible.map((s, i) => (
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
          </div>
        )}
        {nudge && <div className="mt-3">{nudge}</div>}
      </div>
    </div>
  );
}
