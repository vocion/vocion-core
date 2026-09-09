'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';

type Rating = 'up' | 'down';

/**
 * Thumbs on a completed agent reply. A vote posts to the same feedback
 * endpoint the review queue and Drive comments use, so it enters the
 * learning loop (a down-vote becomes a classification job; a note can be
 * added inline). Quiet until hovered; stays lit once cast.
 * @param props - Feedback props.
 * @param props.agentName - Who replied (recorded as the artifact title).
 * @param props.excerpt - The reply text, quoted into the feedback payload.
 */
export function MessageFeedback({ agentName, excerpt }: { agentName: string; excerpt: string }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);

  async function post(next: Rating, text?: string) {
    setRating(next);
    try {
      await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'manual',
          payload: {
            text: text?.trim() || (next === 'up' ? 'Good reply.' : 'This reply missed the mark.'),
            quotedText: excerpt.slice(0, 800),
            artifactTitle: `Chat reply · ${agentName}`,
          },
        }),
      });
      setSent(true);
    } catch {
      /* best-effort — the vote stays lit; nothing to recover for the user */
    }
  }

  const base = 'rounded-md p-1 text-muted-foreground/60 transition hover:bg-muted hover:text-foreground';
  return (
    <div className="mt-1.5 flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-0.5 opacity-0 transition group-hover/message:opacity-100 focus-within:opacity-100 data-[voted=true]:opacity-100" data-voted={rating !== null}>
        <button type="button" aria-label="Good reply" aria-pressed={rating === 'up'} onClick={() => void post('up')} className={`${base} ${rating === 'up' ? 'text-brand-pass' : ''}`}>
          <ThumbsUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Bad reply"
          aria-pressed={rating === 'down'}
          onClick={() => {
            setRating('down');
            setNoteOpen(true);
          }}
          className={`${base} ${rating === 'down' ? 'text-brand-fail' : ''}`}
        >
          <ThumbsDown className="size-3.5" aria-hidden />
        </button>
      </div>
      {noteOpen && !sent && (
        <form
          className="flex w-full max-w-sm items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNoteOpen(false);
            void post('down', note);
          }}
        >
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="What was wrong? (optional — becomes a learning candidate)"
            className="flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button type="submit" className="h-8 rounded-md bg-foreground px-2.5 text-xs font-medium text-background hover:bg-foreground/90">Send</button>
        </form>
      )}
      {sent && <span className="text-[11px] text-muted-foreground">Thanks — noted.</span>}
    </div>
  );
}
