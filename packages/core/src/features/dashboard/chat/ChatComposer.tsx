'use client';

import { ArrowUp, Square, X } from 'lucide-react';
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
  /** True while a turn is streaming — the send button becomes a Stop button. */
  streaming?: boolean;
  /** Abort the in-flight turn (shown as Stop while streaming). */
  onStop?: () => void;
  /** Something else is attached (anchored notes), so an empty box can still send. */
  armed?: boolean;
  /** Captured pasted material, rendered as a chip so the instruction stays readable (032 §2.1 rule 5). */
  pastedText?: string | null;
  /** A large paste was intercepted — the session stores it beside the message. */
  onPasteText?: (text: string) => void;
  /** The chip's remove control. */
  onClearPasted?: () => void;
};

/** Pastes at or above this length become a chip instead of flooding the box. */
const PASTE_CHIP_THRESHOLD = 400;

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
  streaming = false,
  onStop,
  armed = false,
  pastedText,
  onPasteText,
  onClearPasted,
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
      if (!disabled && (value.trim().length > 0 || pastedText || armed)) {
        onSubmit();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onPasteText) {
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text.length >= PASTE_CHIP_THRESHOLD && !pastedText) {
      e.preventDefault();
      onPasteText(text);
    }
  };

  const trimmed = value.trim();
  const sendEnabled = !disabled && (trimmed.length > 0 || Boolean(pastedText) || armed);

  return (
    <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background to-transparent px-4 pt-4 pb-4 sm:px-6 sm:pt-6">
      <div className="mx-auto max-w-3xl">
        {pastedText && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-1.5 text-xs">
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase">Pasted</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{pastedText.slice(0, 120)}</span>
            <button
              type="button"
              onClick={() => onClearPasted?.()}
              aria-label="Remove pasted content"
              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
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
            data-agent-composer
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder ?? 'Ask anything…'}
            disabled={disabled}
            rows={1}
            // 16px on mobile: iOS Safari auto-zooms (and scroll-cuts) any focused
            // input under 16px. Compact 14px only from sm: up (no mobile zoom).
            className="flex-1 resize-none border-0 bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            style={{ minHeight: 24, maxHeight: 220 }}
          />
          {streaming
            ? (
                <button
                  type="button"
                  onClick={() => onStop?.()}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:border-brand-amber hover:text-brand-amber-deep sm:size-9"
                  aria-label="Stop generating"
                >
                  <Square className="size-3.5 fill-current" aria-hidden="true" />
                </button>
              )
            : (
                <button
                  type="submit"
                  disabled={!sendEnabled}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-amber text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-brand-amber-deep disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/50 disabled:shadow-none disabled:hover:translate-y-0 sm:size-9"
                  aria-label="Send message"
                >
                  <ArrowUp className="size-5 sm:size-[18px]" aria-hidden="true" />
                </button>
              )}
        </form>
      </div>
    </div>
  );
}
