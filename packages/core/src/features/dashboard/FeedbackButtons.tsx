'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, useTransition } from 'react';
import { client } from '@/libs/Orpc';

type Rating = 'up' | 'down' | null;

type Props = {
  runId: number;
  kind: 'skill' | 'workflow';
  initialRating?: Rating;
  initialNote?: string | null;
  /** Compact layout — no note field, just thumbs. Good for dense tables + chat lines. */
  compact?: boolean;
};

/**
 * Shared 👍/👎 control for any run (skill or workflow). Clicking a thumb
 * toggles the rating (click same → clear). Non-compact mode also shows
 * an optional note field that commits on blur or Enter.
 *
 * Idempotent — posting the same rating twice is a no-op server-side.
 * @param root0
 * @param root0.runId
 * @param root0.kind
 * @param root0.initialRating
 * @param root0.initialNote
 * @param root0.compact
 */
export function FeedbackButtons({ runId, kind, initialRating = null, initialNote = null, compact = false }: Props) {
  const [rating, setRating] = useState<Rating>(initialRating);
  const [note, setNote] = useState(initialNote ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(nextRating: Rating, nextNote: string) {
    startTransition(async () => {
      try {
        setError(null);
        await client.review.submitFeedback({
          id: runId,
          kind,
          rating: nextRating,
          note: nextNote.trim() || undefined,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function click(next: 'up' | 'down') {
    const toggled = rating === next ? null : next;
    setRating(toggled);
    submit(toggled, note);
  }

  return (
    <div className={compact ? 'inline-flex items-center gap-1' : 'flex flex-col gap-2'}>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => click('up')}
          disabled={pending}
          aria-label="Thumb up"
          title="Rate up"
          className={`inline-flex ${compact ? 'size-6' : 'size-7'} items-center justify-center rounded-md border transition disabled:opacity-40 ${rating === 'up' ? 'border-primary bg-primary/10 text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}`}
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => click('down')}
          disabled={pending}
          aria-label="Thumb down"
          title="Rate down"
          className={`inline-flex ${compact ? 'size-6' : 'size-7'} items-center justify-center rounded-md border transition disabled:opacity-40 ${rating === 'down' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}`}
        >
          <ThumbsDown className="size-3.5" />
        </button>
      </div>

      {!compact && (
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (initialNote ?? '')) {
              submit(rating, note);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
          placeholder="Optional note"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary/50"
        />
      )}

      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
