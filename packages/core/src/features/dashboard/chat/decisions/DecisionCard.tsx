'use client';

import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { ChevronDown, ChevronUp, CornerDownLeft, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Surface } from '@/components/ui/surface';

/**
 * THE DECISION CARD — one component for everything a person is asked to
 * decide (`libs/decisions/decision.ts`).
 *
 * Docked just above the composer, the way the Claude app asks: the question,
 * numbered options with the recommendation first and preselected, each with
 * its one-line consequence, "Something else" as an inline answer in their own
 * words, Skip, and a chevron that folds it away. The composer below stays
 * live — "Or reply directly…" — so the card blocks only itself. The same
 * component draws a Needs you row (`variant="list"`).
 *
 * THE KEYBOARD CONTRACT (docs/design/patterns.md § Decision card):
 *
 *   1–9         pick that option (toggle it, on a Decision that takes several)
 *   ↑ ↓         move between options; one choice follows the highlight
 *   Home End    first, last option
 *   Space       pick the highlighted option
 *   Enter, ⌘↵   submit what is picked — on a fresh card, the recommendation
 *   Tab         reach "Something else"; typing a letter on the list starts it
 *   Esc         fold the card away (nothing is answered); the chevron opens it
 *
 * An answer is a typed `DecisionAnswer` handed to `onAnswer` — options by id,
 * their own words, or a skip — and never text in the composer. The surface
 * sends it to the agent that asked (`useChatSession.answerDecision`).
 */

export type DecisionCardProps = {
  decision: DecisionView;
  /** The agent that asked, by name, for the eyebrow. */
  agentName?: string | null;
  /** Where it is: `dock` above a composer, `list` as a Needs you row. */
  variant?: 'dock' | 'list';
  /** Its place in the queue of open Decisions — "1 of 3". */
  position?: { index: number; total: number };
  /** Folded to one line (`dock` only). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** The answer, typed. */
  onAnswer: (answer: DecisionAnswer) => void;
  /** The answer is on its way. */
  busy?: boolean;
  /** Nothing may be answered now (a turn is running). */
  disabled?: boolean;
  /** Why the last answer did not land. */
  error?: string | null;
  /** Take focus when a new Decision arrives, unless the person is typing elsewhere. */
  takeFocus?: boolean;
};

/**
 * The single choice a fresh card starts on: the recommendation, when there is one.
 * @param decision - The Decision.
 */
function initialSelection(decision: DecisionView): string[] {
  const rec = decision.options.find(o => o.recommended);
  return rec ? [rec.id] : [];
}

/**
 * Whether the person is typing somewhere else right now — a card never takes
 * focus from words in progress.
 */
function typingElsewhere(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.value.trim().length > 0;
}

/**
 * "Default in 2 days: Northwind API" — the deadline and what happens at it.
 * @param deadline - The clock's deadline.
 */
function deadlineLine(deadline: NonNullable<DecisionView['deadline']>): string {
  const ms = new Date(deadline.at).getTime() - Date.now();
  const hours = Math.round(ms / 3_600_000);
  const when = ms <= 0 ? 'overdue' : hours < 1 ? 'within the hour' : hours < 48 ? `in ${hours}h` : `in ${Math.round(hours / 24)} days`;
  return deadline.defaultLabel ? `Default ${when}: ${deadline.defaultLabel}` : `Due ${when}`;
}

export function DecisionCard({
  decision,
  agentName,
  variant = 'dock',
  position,
  collapsed = false,
  onCollapsedChange,
  onAnswer,
  busy = false,
  disabled = false,
  error = null,
  takeFocus = variant === 'dock',
}: DecisionCardProps) {
  const uid = useId();
  const questionId = `${uid}-q`;
  const bodyId = `${uid}-b`;
  const optionId = (i: number) => `${uid}-o${i}`;
  const listRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const { options, multiple, allowOther } = decision;
  const [selected, setSelected] = useState<string[]>(() => initialSelection(decision));
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(o => o.recommended)));
  const [other, setOther] = useState('');
  // A new Decision starts fresh: its own recommendation, nothing typed.
  const [seen, setSeen] = useState(decision.id);
  if (seen !== decision.id) {
    setSeen(decision.id);
    setSelected(initialSelection(decision));
    setActive(Math.max(0, options.findIndex(o => o.recommended)));
    setOther('');
  }
  const locked = busy || disabled;
  const hasOptions = options.length > 0;

  useEffect(() => {
    if (!takeFocus || collapsed || typingElsewhere()) {
      return;
    }
    (hasOptions ? listRef.current : otherRef.current)?.focus({ preventScroll: true });
  }, [decision.id, takeFocus, collapsed, hasOptions]);

  const pick = (index: number) => {
    const o = options[index];
    if (!o) {
      return;
    }
    setActive(index);
    setSelected(prev => (multiple ? (prev.includes(o.id) ? prev.filter(id => id !== o.id) : [...prev, o.id]) : [o.id]));
  };

  const submit = (from: 'list' | 'other') => {
    if (locked) {
      return;
    }
    if (from === 'other' || (!hasOptions && other.trim())) {
      if (other.trim()) {
        onAnswer({ kind: 'free_text', text: other.trim() });
      }
      return;
    }
    const chosen = selected.length > 0 ? selected : options[active] ? [options[active]!.id] : [];
    if (chosen.length > 0) {
      onAnswer({ kind: 'option', optionIds: multiple ? options.filter(o => chosen.includes(o.id)).map(o => o.id) : [chosen[0]!] });
    }
  };

  const collapse = () => {
    if (variant === 'dock') {
      onCollapsedChange?.(true);
    }
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) {
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
    if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
      return;
    }
    // Typing a letter on the list starts an answer in their own words.
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
    if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
      return;
    }
    if (e.key === 'ArrowUp' && hasOptions && (e.currentTarget.selectionStart ?? 0) === 0) {
      e.preventDefault();
      listRef.current?.focus();
    }
  };

  const queue = position && position.total > 1 ? `${position.index + 1} of ${position.total}` : null;
  const asker = agentName ? `${agentName} asks` : 'A decision for you';
  const canSubmit = !locked && (selected.length > 0 || (hasOptions && !!options[active]) || other.trim().length > 0);
  // Said once per Decision, for a screen reader: what arrived and how to answer it.
  const announcement = useMemo(
    () => `${asker}: ${decision.question}. ${hasOptions ? `${options.length} options${options.some(o => o.recommended) ? ', the recommended one first' : ''}. Press a number to pick and Enter to submit.` : 'Type your answer and press Enter.'}`,
    [asker, decision.question, hasOptions, options],
  );

  if (variant === 'dock' && collapsed) {
    return (
      <div className="mb-2" data-testid="decision-card" data-collapsed="true" data-decision-id={decision.id}>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          aria-expanded={false}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-[13px] transition hover:bg-surface-hover"
        >
          <span className="shrink-0 font-medium text-foreground">{queue ? `${position!.total} decisions waiting` : '1 decision waiting'}</span>
          <span className="min-w-0 truncate text-muted-foreground">{decision.question}</span>
          <ChevronUp className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Show the decision</span>
        </button>
      </div>
    );
  }

  return (
    <Surface
      name="decision"
      role={variant === 'dock' ? 'dialog' : 'group'}
      aria-modal={variant === 'dock' ? false : undefined}
      aria-labelledby={questionId}
      aria-describedby={decision.body ? bodyId : undefined}
      className={variant === 'dock' ? 'mb-2 px-4 pt-3 pb-3 shadow-sm' : 'px-4 py-3'}
      data-testid="decision-card"
      data-decision-id={decision.id}
      data-variant={variant}
    >
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
            {asker}
            {queue && (
              <span data-testid="decision-queue">
                {' · '}
                {queue}
              </span>
            )}
          </p>
          <h3 id={questionId} className="mt-1 text-[15px] leading-snug font-medium text-foreground">{decision.question}</h3>
          {decision.body && <p id={bodyId} className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{decision.body}</p>}
          {decision.deadline && <p className="mt-1 text-[12px] text-muted-foreground" data-testid="decision-deadline">{deadlineLine(decision.deadline)}</p>}
        </div>
        {variant === 'dock' && (
          <button
            type="button"
            onClick={collapse}
            aria-expanded
            aria-label="Fold the decision away (Esc)"
            title="Fold away (Esc)"
            className="-mt-0.5 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <ChevronDown className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {hasOptions && (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={locked ? -1 : 0}
          aria-labelledby={questionId}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={optionId(active)}
          aria-disabled={locked || undefined}
          onKeyDown={onListKey}
          data-testid="decision-options"
          className="-mx-2 mt-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {options.map((o, i) => {
            const isSelected = selected.includes(o.id);
            return (
              // The listbox owns the keys (the aria-activedescendant pattern):
              // an option is highlighted, never focused, so it takes no key handler.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={o.id}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-active={i === active || undefined}
                data-testid={`decision-option-${o.id}`}
                onClick={() => {
                  if (!locked) {
                    pick(i);
                    listRef.current?.focus();
                  }
                }}
                onDoubleClick={() => !locked && onAnswer({ kind: 'option', optionIds: [o.id] })}
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition ${isSelected ? 'bg-surface-soft' : 'hover:bg-surface-hover'} ${i === active ? 'ring-1 ring-border' : ''} ${locked ? 'cursor-default opacity-60' : ''}`}
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
        <div className={`${hasOptions ? 'mt-1' : 'mt-3'} flex items-center gap-3 px-0 py-1`}>
          {hasOptions && <kbd className="inline-flex size-5 shrink-0 items-center justify-center rounded border border-border font-sans text-[11px] font-medium text-muted-foreground">{options.length + 1}</kbd>}
          <input
            ref={otherRef}
            type="text"
            value={other}
            onChange={e => setOther(e.target.value)}
            onKeyDown={onOtherKey}
            disabled={locked}
            aria-label="Something else — answer in your own words"
            placeholder={hasOptions ? 'Something else…' : 'Your answer…'}
            data-testid="decision-other"
            className="min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40"
          />
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--brand-fail)]">{error}</p>}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <p className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block" data-testid="decision-key-hints" aria-hidden>
          {hasOptions && (
            <>
              <kbd className="font-sans">↑↓</kbd>
              {' move · '}
              <kbd className="font-sans">{`1–${Math.min(9, options.length)}`}</kbd>
              {' pick · '}
            </>
          )}
          <kbd className="font-sans">↵</kbd>
          {' submit'}
          {allowOther && hasOptions && (
            <>
              {' · '}
              <kbd className="font-sans">Tab</kbd>
              {' something else'}
            </>
          )}
          {variant === 'dock' && (
            <>
              {' · '}
              <kbd className="font-sans">Esc</kbd>
              {' fold'}
            </>
          )}
        </p>
        <span className="flex-1 sm:hidden" />
        <button
          type="button"
          onClick={() => !locked && onAnswer({ kind: 'skip' })}
          disabled={locked}
          data-testid="decision-skip"
          className="rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => submit(document.activeElement === otherRef.current || (!hasOptions) ? 'other' : 'list')}
          onMouseDown={e => e.preventDefault()}
          disabled={!canSubmit}
          data-testid="decision-submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-action px-3 py-1.5 text-[13px] font-medium text-action-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CornerDownLeft className="size-3.5" aria-hidden />}
          Submit
        </button>
      </div>
    </Surface>
  );
}
