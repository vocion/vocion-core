'use client';

/**
 * A slot with nothing in it yet. Type what should go there and press ⏎ —
 * the message "Fill tile N: …" goes to the agent as a normal turn, and the
 * artifact it renders lands in this slot. Esc clears the draft.
 */

import { CornerDownLeft } from 'lucide-react';
import { useRef } from 'react';

export function EmptyTile({ slot, draft, onDraft, onSubmit, onClear, disabled }: {
  slot: number;
  draft: string;
  onDraft: (text: string) => void;
  onSubmit: (text: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div
      className="group relative flex min-h-36 flex-col rounded-lg border border-dashed border-border/80 p-3 text-sm transition-colors focus-within:border-foreground/40 hover:border-foreground/30"
      data-empty-tile={slot}
    >
      <textarea
        ref={ref}
        value={draft}
        disabled={disabled}
        onChange={e => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClear();
            ref.current?.blur();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (draft.trim()) {
              onSubmit(draft);
            }
          }
        }}
        placeholder="Describe what goes here…"
        rows={3}
        className="flex-1 resize-none bg-transparent text-center text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        aria-label={`Describe what goes in tile ${slot + 1}`}
      />
      <div className="mt-2 flex items-center justify-center gap-2 text-[10px] text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <kbd className="rounded border border-border px-1 py-0.5">Esc</kbd>
        <kbd className="inline-flex items-center rounded border border-border px-1 py-0.5"><CornerDownLeft className="size-3" /></kbd>
      </div>
    </div>
  );
}
