'use client';

import type { ReactNode } from 'react';
import { CornerDownLeft, Loader2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Surface } from '@/components/ui/surface';

/**
 * ONE DECISION, DOCKED ABOVE THE COMPOSER — the shape every human escalation
 * in chat takes: the question, numbered options with the recommended one
 * first and preselected, each with its one-line consequence, "Something else"
 * in the person's own words, Skip, and the composer below still live.
 *
 * Self-contained so "Connect your systems" ships before the unified Decision
 * model; it keeps that model's keyboard contract exactly
 * (docs/design/patterns.md § Decision card), so swapping one for the other
 * changes no habit:
 *
 *   1–9         pick that option (toggle it, on a decision that takes several)
 *   ↑ ↓         move between options; a single choice follows the highlight
 *   Home End    first, last option
 *   Space       pick the highlighted option
 *   Enter, ⌘↵   submit what is picked — on a fresh card, the recommendation
 *   Tab         reach "Something else"; typing a letter on the list starts it
 *   Esc         the card's way out (`onEscape`): back a step, or Stop
 *
 * `children` is what the decision needs typed in (a key, a setting): it sits
 * between the question and the options, owns its own keys, and submits with
 * Enter / ⌘↵ like the list does.
 */

export type DockedOption = {
  id: string;
  label: string;
  /** One line: what choosing it does. */
  consequence?: string;
  recommended?: boolean;
};

export type DockedAnswer
  = | { kind: 'option'; optionIds: string[] }
    | { kind: 'free_text'; text: string }
    | { kind: 'skip' };

export type DockedDecisionProps = {
  /** Stable per decision: a new id starts fresh on its recommendation. */
  id: string;
  /** The eyebrow, e.g. "Connect your systems". */
  eyebrow: string;
  /** "2 of 5", drawn after the eyebrow. */
  progress?: { index: number; total: number } | null;
  question: string;
  body?: ReactNode;
  options: DockedOption[];
  /** Several may be picked; the recommended ones start picked. */
  multiple?: boolean;
  /** Offer "Something else" in their own words. */
  allowOther?: boolean;
  /** The Skip button; absent hides it. */
  skipLabel?: string | null;
  /** The submit button's words. */
  submitLabel?: string;
  onAnswer: (answer: DockedAnswer) => void;
  /** Esc, and the × — back a step, or stop the walk. */
  onEscape?: () => void;
  escapeLabel?: string;
  /** Inline inputs the decision needs, above the options. */
  children?: ReactNode;
  busy?: boolean;
  error?: string | null;
  /** Take focus when a new decision arrives, unless the person is typing elsewhere. */
  takeFocus?: boolean;
};

/**
 * What a fresh card starts on: the recommendation(s).
 * @param options - The options.
 * @param multiple - Whether several may be picked.
 */
function initialSelection(options: DockedOption[], multiple: boolean): string[] {
  const rec = options.filter(o => o.recommended).map(o => o.id);
  return multiple ? rec : rec.slice(0, 1);
}

/** Whether the person is typing somewhere else right now — a card never takes focus from words in progress. */
function typingElsewhere(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.value.trim().length > 0;
}

export function DockedDecision({
  id,
  eyebrow,
  progress,
  question,
  body,
  options,
  multiple = false,
  allowOther = true,
  skipLabel = 'Skip',
  submitLabel = 'Submit',
  onAnswer,
  onEscape,
  escapeLabel = 'Stop',
  children,
  busy = false,
  error = null,
  takeFocus = true,
}: DockedDecisionProps) {
  const uid = useId();
  const questionId = `${uid}-q`;
  const optionId = (i: number) => `${uid}-o${i}`;
  const listRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>(() => initialSelection(options, multiple));
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(o => o.recommended)));
  const [other, setOther] = useState('');
  const [seen, setSeen] = useState(id);
  if (seen !== id) {
    setSeen(id);
    setSelected(initialSelection(options, multiple));
    setActive(Math.max(0, options.findIndex(o => o.recommended)));
    setOther('');
  }
  const hasOptions = options.length > 0;
  const hasForm = children !== undefined && children !== null;

  useEffect(() => {
    if (!takeFocus || busy || typingElsewhere()) {
      return;
    }
    // A form's first input when there is one; else the list; else the free text.
    const first = formRef.current?.querySelector<HTMLElement>('input, select, textarea');
    (first ?? (hasOptions ? listRef.current : otherRef.current))?.focus({ preventScroll: true });
  }, [id, takeFocus, hasOptions, hasForm, busy]);

  const pick = (index: number) => {
    const o = options[index];
    if (!o) {
      return;
    }
    setActive(index);
    setSelected(prev => (multiple ? (prev.includes(o.id) ? prev.filter(x => x !== o.id) : [...prev, o.id]) : [o.id]));
  };

  const submit = (from: 'list' | 'other') => {
    if (busy) {
      return;
    }
    if (from === 'other') {
      if (other.trim()) {
        onAnswer({ kind: 'free_text', text: other.trim() });
      }
      return;
    }
    const chosen = selected.length > 0 ? selected : !multiple && options[active] ? [options[active]!.id] : [];
    // A decision that is only a form (a key, a setting) submits the form.
    if (chosen.length > 0 || multiple || !hasOptions) {
      onAnswer({ kind: 'option', optionIds: options.filter(o => chosen.includes(o.id)).map(o => o.id) });
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (busy) {
      return;
    }
    const last = options.length - 1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.key === 'ArrowDown' && active === last && allowOther) {
        otherRef.current?.focus();
        return;
      }
      const next = e.key === 'ArrowDown' ? Math.min(last, active + 1) : Math.max(0, active - 1);
      setActive(next);
      if (!multiple && options[next]) {
        setSelected([options[next]!.id]);
      }
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : last;
      setActive(next);
      if (!multiple && options[next]) {
        setSelected([options[next]!.id]);
      }
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const index = Number(e.key) - 1;
      if (index < options.length) {
        pick(index);
      } else if (index === options.length && allowOther) {
        otherRef.current?.focus();
      }
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      pick(active);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit('list');
      return;
    }
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (allowOther && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
      e.preventDefault();
      setOther(prev => prev + e.key);
      otherRef.current?.focus();
    }
  };

  const onOtherKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit('other');
      return;
    }
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key === 'ArrowUp' && hasOptions && (e.currentTarget.selectionStart ?? 0) === 0) {
      e.preventDefault();
      listRef.current?.focus();
    }
  };

  // The inline form submits like the list: Enter (or ⌘↵) is "the recommendation".
  const onFormKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      submit('list');
      return;
    }
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
    }
  };

  const announcement = useMemo(
    () => `${eyebrow}: ${question}. ${hasOptions ? `${options.length} options${options.some(o => o.recommended) ? ', the recommended one first' : ''}. Press a number to pick and Enter to submit.` : 'Press Enter to submit.'}`,
    [eyebrow, question, hasOptions, options],
  );
  const canSubmit = !busy && (multiple || selected.length > 0 || (hasOptions && !!options[active]) || hasForm);

  return (
    <Surface
      name="docked-decision"
      role="dialog"
      aria-modal={false}
      aria-labelledby={questionId}
      className="mb-2 px-4 pt-3 pb-3 shadow-sm"
      data-testid="docked-decision"
      data-decision-id={id}
    >
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase" data-testid="docked-decision-eyebrow">
            {eyebrow}
            {progress && progress.total > 0 && (
              <span data-testid="docked-decision-progress">{` · ${progress.index + 1} of ${progress.total}`}</span>
            )}
          </p>
          <h3 id={questionId} className="mt-1 text-[15px] leading-snug font-medium text-foreground">{question}</h3>
          {body && <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</div>}
        </div>
        {onEscape && (
          <button
            type="button"
            onClick={onEscape}
            aria-label={`${escapeLabel} (Esc)`}
            title={`${escapeLabel} (Esc)`}
            data-testid="docked-decision-escape"
            className="-mt-0.5 -mr-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            {escapeLabel}
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {hasForm && (
        // The inputs inside own their keys; this only adds Enter-to-submit and Esc.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div ref={formRef} onKeyDown={onFormKey} className="mt-3" data-testid="docked-decision-form">
          {children}
        </div>
      )}

      {hasOptions && (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={busy ? -1 : 0}
          aria-labelledby={questionId}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={optionId(active)}
          aria-disabled={busy || undefined}
          onKeyDown={onListKey}
          data-testid="docked-decision-options"
          className="-mx-2 mt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {options.map((o, i) => {
            const isSelected = selected.includes(o.id);
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={o.id}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-active={i === active || undefined}
                data-testid={`docked-option-${o.id}`}
                onClick={() => {
                  if (!busy) {
                    pick(i);
                    listRef.current?.focus();
                  }
                }}
                onDoubleClick={() => !busy && !multiple && onAnswer({ kind: 'option', optionIds: [o.id] })}
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition ${isSelected ? 'bg-surface-soft' : 'hover:bg-surface-hover'} ${i === active ? 'ring-1 ring-border' : ''} ${busy ? 'cursor-default opacity-60' : ''}`}
              >
                <kbd className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border font-sans text-[11px] font-medium ${isSelected ? 'border-transparent bg-action text-action-foreground' : 'border-border text-muted-foreground'}`}>{i + 1}</kbd>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-medium text-foreground">{o.label}</span>
                    {o.recommended && <span className="text-[11px] font-medium text-[var(--brand-pass)]">Recommended</span>}
                  </span>
                  {o.consequence && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{o.consequence}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {allowOther && (
        <div className={`${hasOptions ? 'mt-1' : 'mt-3'} flex items-center gap-3 py-1`}>
          {hasOptions && <kbd className="inline-flex size-5 shrink-0 items-center justify-center rounded border border-border font-sans text-[11px] font-medium text-muted-foreground">{options.length + 1}</kbd>}
          <input
            ref={otherRef}
            type="text"
            value={other}
            onChange={e => setOther(e.target.value)}
            onKeyDown={onOtherKey}
            disabled={busy}
            aria-label="Something else — answer in your own words"
            placeholder="Something else…"
            data-testid="docked-decision-other"
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40"
          />
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--brand-fail)]" data-testid="docked-decision-error">{error}</p>}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <p className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block" aria-hidden>
          {hasOptions && (options.length > 1 ? `↑↓ move · 1–${Math.min(9, options.length)} pick · ` : '')}
          ↵ submit
          {allowOther && hasOptions && ' · Tab something else'}
          {onEscape && ` · Esc ${escapeLabel.toLowerCase()}`}
        </p>
        <span className="flex-1 sm:hidden" />
        {skipLabel && (
          <button
            type="button"
            onClick={() => !busy && onAnswer({ kind: 'skip' })}
            disabled={busy}
            data-testid="docked-decision-skip"
            className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            {skipLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => submit(document.activeElement === otherRef.current && other.trim() ? 'other' : 'list')}
          onMouseDown={e => e.preventDefault()}
          disabled={!canSubmit}
          data-testid="docked-decision-submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-action px-3 py-1.5 text-[13px] font-medium text-action-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CornerDownLeft className="size-3.5" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </Surface>
  );
}
