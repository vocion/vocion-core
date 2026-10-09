'use client';

import type { Suggestion } from '@/libs/chat/suggestions';
import { ArrowRight } from 'lucide-react';
import { visibleSuggestions } from '@/libs/chat/suggestions';

/**
 * A prompt pill: quiet text in a rounded outline, never a card. One shape for
 * every "send this next" in chat — the follow-ups under an answer and the
 * opening hints by the composer. Wraps to as many lines as its words need,
 * never truncated; 44px tall on a phone; Tab reaches it and Enter sends it.
 */
export const PROMPT_PILL_CLASS = 'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-2xl border border-border/70 bg-background py-1.5 pr-2.5 pl-3 text-left text-[12.5px] leading-snug text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none max-md:min-h-11';

/**
 * Up to three follow-ups under the latest answer (founder, 2026-10-09:
 * "chat gpt does up to 3 suggestions. If they are really valuable. And
 * doesn't trap them in cards."). Each sends its words as the person's next
 * message; "Dig deeper →" asks the same question one effort level up, and
 * shows only when there is a level above the turn's. Nothing when there are
 * none.
 * @param props - The pills.
 * @param props.items - What the turn suggested.
 * @param props.canGoDeeper - The turn ran below Deep and can be re-asked.
 * @param props.onPick - Sends one.
 */
export function SuggestionPills({ items, canGoDeeper, onPick }: { items: readonly Suggestion[] | undefined; canGoDeeper: boolean; onPick: (s: Suggestion) => void }) {
  const shown = visibleSuggestions(items, canGoDeeper);
  if (shown.length === 0) {
    return null;
  }
  return (
    <div role="group" aria-label="Suggested follow-ups" className="mt-2.5 flex flex-wrap gap-1.5" data-testid="suggestion-pills">
      {shown.map(s => (
        <button
          key={s.prompt}
          type="button"
          onClick={() => onPick(s)}
          className={PROMPT_PILL_CLASS}
          data-testid="suggestion-pill"
          data-deeper={s.deeper ? 'true' : undefined}
          title={s.why}
        >
          <span className="min-w-0 break-words">{s.label.replace(/ →$/, '')}</span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </button>
      ))}
    </div>
  );
}
