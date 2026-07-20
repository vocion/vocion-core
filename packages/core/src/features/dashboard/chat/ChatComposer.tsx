'use client';

import { Send } from 'lucide-react';
import { useEffect, useRef } from 'react';

/**
 * Sticky-bottom composer (Phase C — rev-ai pattern).
 *
 * - max-width 3xl, centered
 * - rounded-2xl with focus-within ring + amber-tinted shadow
 * - auto-resize textarea (24px → 220px)
 * - square send button, amber filled when enabled
 *
 * "Insert quarter, shoot aliens": textarea + send, nothing else. No
 * keyboard-hint row (Enter-to-send is a convention, not a lesson), no
 * inline "Clear conversation" — starting over lives in the chat's ⋯ menu.
 *
 * Stateless: parent (`<ChatShell />`) owns the `value` + `onChange`
 * + `onSubmit` + `disabled`. Composer only handles autosize +
 * keyboard shortcuts.
 */

export type ChatComposerProps = {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
};

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize the textarea to fit content (24 → 220 px).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, Math.max(24, el.scrollHeight))}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim().length > 0) {
        onSubmit();
      }
    }
  };

  const trimmed = value.trim();
  const sendEnabled = !disabled && trimmed.length > 0;

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent px-4 pt-4 pb-4 sm:px-6 sm:pt-6">
      <div className="mx-auto max-w-3xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (sendEnabled) {
              onSubmit();
            }
          }}
          className="flex items-end gap-2 rounded-2xl border border-border bg-background px-4 py-3 shadow-sm transition focus-within:border-brand-amber focus-within:shadow-[0_8px_28px_rgba(241,135,0,0.10)] focus-within:ring-4 focus-within:ring-brand-amber-tint"
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? 'Ask anything…'}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: 24, maxHeight: 220 }}
          />
          <button
            type="submit"
            disabled={!sendEnabled}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-amber text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-amber-deep disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0 sm:size-9"
            aria-label="Send message"
          >
            <Send className="size-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
}
