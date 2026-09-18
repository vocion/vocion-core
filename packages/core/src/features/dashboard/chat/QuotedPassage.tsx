'use client';

import { Quote, X } from 'lucide-react';

/**
 * The passage the next turn is about, shown above the composer — the same
 * chip on every surface (the full page, the rail, the artifact view), so a
 * highlight quoted from a document and one quoted from the transcript look
 * like the one thing they are.
 * @param props
 * @param props.text - The highlighted passage.
 * @param props.onDrop - Remove it from the turn.
 */
export function QuotedPassage({ text, onDrop }: { text: string; onDrop: () => void }) {
  return (
    <div className="mb-1.5 flex items-start gap-2 rounded-xl border border-border bg-surface-soft px-2.5 py-1.5 text-xs text-foreground/85" data-quoted-passage role="status">
      <Quote className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="line-clamp-2 min-w-0 flex-1 italic">{text}</span>
      <button type="button" onClick={onDrop} aria-label="Drop the quoted passage" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground">
        <X className="size-3" />
      </button>
    </div>
  );
}
