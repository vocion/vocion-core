'use client';

import { Check, MessageSquareText, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * A thumb and an optional note under an assistant turn (0094). Quiet by
 * default — visible on hover/focus on a pointer device, always on touch —
 * because the transcript is text-first and this is a margin note, not a
 * form. A thumb alone is a metric; a note is what teaches the system
 * (Manifesto §6), so the note box opens only once a thumb is chosen.
 * @param props
 * @param props.messageId - Persisted row id of the assistant turn.
 * @param props.rating - The current thumb, if any.
 * @param props.note - The saved note, if any.
 * @param props.onFeedback - Persists the thumb (and note).
 */
export function MessageFeedback({ messageId, rating, note, onFeedback }: {
  messageId: number;
  rating: 'up' | 'down' | null;
  note: string | null;
  onFeedback: (messageId: number, rating: 'up' | 'down' | null, note?: string | null) => void | Promise<void>;
}) {
  const t = useTranslations('Chat');
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [saved, setSaved] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (noteOpen) {
      noteRef.current?.focus();
    }
  }, [noteOpen]);

  const rate = (next: 'up' | 'down') => {
    const cleared = rating === next;
    void onFeedback(messageId, cleared ? null : next, cleared ? null : (note ?? null));
    setSaved(false);
    if (cleared) {
      setNoteOpen(false);
    }
  };

  const sendNote = () => {
    if (!rating) {
      return;
    }
    void onFeedback(messageId, rating, draft.trim() || null);
    setSaved(true);
    setNoteOpen(false);
  };

  const btn = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40';
  const active = 'text-brand-amber-deep bg-brand-amber-tint hover:text-brand-amber-deep';

  return (
    <div data-testid="message-feedback" className="mt-1.5 flex flex-wrap items-center gap-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
      <button type="button" onClick={() => rate('up')} aria-pressed={rating === 'up'} aria-label={t('feedback_up')} title={t('feedback_up')} className={`${btn} ${rating === 'up' ? active : ''}`}>
        <ThumbsUp className="size-3.5" aria-hidden />
      </button>
      <button type="button" onClick={() => rate('down')} aria-pressed={rating === 'down'} aria-label={t('feedback_down')} title={t('feedback_down')} className={`${btn} ${rating === 'down' ? active : ''}`}>
        <ThumbsDown className="size-3.5" aria-hidden />
      </button>
      {rating && !noteOpen && (
        <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <MessageSquareText className="size-3" aria-hidden />
          {note ? note.slice(0, 40) + (note.length > 40 ? '…' : '') : t('feedback_add_note')}
        </button>
      )}
      {saved && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Check className="size-3 text-[var(--brand-pass)]" aria-hidden />
          {t('feedback_saved')}
        </span>
      )}
      {rating && noteOpen && (
        <form
          className="mt-1 flex w-full items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendNote();
          }}
        >
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('feedback_note_placeholder')}
            rows={2}
            ref={noteRef}
            className="min-h-14 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-brand-amber"
          />
          <button type="submit" className="rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition hover:bg-foreground/90">
            {t('feedback_save')}
          </button>
        </form>
      )}
    </div>
  );
}
