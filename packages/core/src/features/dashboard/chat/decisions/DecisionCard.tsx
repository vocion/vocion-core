'use client';

import type { ReactNode } from 'react';
import type { DecisionAnswer, DecisionView } from '@/libs/decisions/decision';
import { ChevronDown, ChevronUp, CornerDownLeft, Loader2, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AgentDot } from '@/components/ui/agent-dot';
import { Surface } from '@/components/ui/surface';
import { openPreview } from '@/features/preview/previewState';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { decisionTitle, DENY_ID } from '@/libs/decisions/decision';
import { Link } from '@/libs/I18nNavigation';
import { DecisionLook } from './looks';

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
 *               — on an APPROVAL, ⌘↵ is the recommendation (Allow once),
 *               whatever is highlighted
 *   Tab         reach "Something else"; typing a letter on the list starts it
 *   Esc         fold the card away (nothing is answered); the chevron opens it
 *               — on an APPROVAL, Esc is Deny, as a permission prompt's is
 *
 * AN APPROVAL IS A PERMISSION PROMPT (Claude Code's): "Allow <agent> to
 * <plain action>?", the exact payload in a preview block beneath, then
 * [1] Allow once (recommended, ⌘↵) · [2] Always allow <this kind> in
 * <workspace> — only where the trust ladder would take it — · [3] Deny (Esc),
 * and "Something else…" in their own words back to the agent. One component:
 * there is no second approval UI.
 *
 * An answer is a typed `DecisionAnswer` handed to `onAnswer` — options by id,
 * their own words, or a skip — and never text in the composer. The surface
 * sends it to the agent that asked (`useChatSession.answerDecision`).
 */

export type DecisionCardProps = {
  decision: DecisionView;
  /** The agent that asked, by name, for the eyebrow. */
  agentName?: string | null;
  /** That agent's authored accent: its avatar heads the card ("Allow Dana to send this email?"). */
  agentAccent?: string | null;
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
  /** Where it waits, when not in this conversation ("Waiting on you"), for the eyebrow. */
  context?: string | null;
  /** Opens a link option's flow (a login, a token form). The page navigates by default. */
  onOpen?: (href: string) => void;
  /*
   * A STEP OF A WALK (connect your systems: one system at a time). The same
   * card, with what a step needs on top of a Decision's own fields.
   */
  /** The eyebrow in place of "<agent> asks", e.g. "Connect your systems". */
  eyebrow?: string;
  /** The why, when it is more than a line of text (a link, a count). */
  bodyNode?: ReactNode;
  /** What the step needs typed in (a key, a setting): between the question and the options; Enter submits it. */
  children?: ReactNode;
  /** A new step starts fresh on its recommendation; defaults to the Decision's key. */
  stepKey?: string;
  /** The Skip button's words; null hides it. */
  skipLabel?: string | null;
  /** The submit button's words. */
  submitLabel?: string;
  /** Esc and a labelled × button: back a step, or stop the walk — in place of folding. */
  onEscape?: () => void;
  escapeLabel?: string;
};

/**
 * The single choice a fresh card starts on: the recommendation, when there is one.
 * @param decision - The Decision.
 */
function initialSelection(decision: DecisionView): string[] {
  const rec = decision.options.filter(o => o.recommended).map(o => o.id);
  return decision.multiple ? rec : rec.slice(0, 1);
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

/**
 * Back to the top of whatever scrolls the dock (the composer's capped slot on
 * a phone), so a new Decision opens on its question — never mid-body where
 * the last one was left (2026-10-09: a review docked scrolled to its
 * deadline line, its question out of sight).
 * @param node - The card.
 */
function scrollSlotToTop(node: HTMLElement | null): void {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') {
      el.scrollTop = 0;
      return;
    }
  }
}

/**
 * Whether an option's link leaves this conversation (a vendor's login, a
 * token form) — "Opens ↗" — rather than starting a walk docked right here.
 * @param href - The option's link.
 */
function leavesConversation(href: string): boolean {
  return connectSystemsInputOfHref(href) === null;
}

/** 44px on a phone — a thumb's target (Apple HIG); the desktop keeps its density. */
const TAP = 'max-md:min-h-11';
/** The docked card's question, held at the top of its scrolling slot. */
const STICKY_HEAD = 'sticky top-0 z-10 -mx-4 -mt-3 rounded-t-xl bg-card px-4 pt-3 pb-1';
/** The docked card's Skip and Submit, held at the bottom of its scrolling slot. */
// A phone with the keyboard up has a slot shorter than head and foot
// together: there, only the question holds, and Submit scrolls with the rest.
const STICKY_FOOT = 'sticky bottom-0 z-10 -mx-4 -mb-3 rounded-b-xl bg-card px-4 pb-3 max-md:[@media(max-height:600px)]:static';
/** On a phone the why is one line, so the recommendation shows between the question and Submit. */
const PHONE_BODY = 'max-md:line-clamp-1';

export function DecisionCard({
  decision,
  agentName,
  agentAccent,
  variant = 'dock',
  position,
  collapsed = false,
  onCollapsedChange,
  onAnswer,
  busy = false,
  disabled = false,
  error = null,
  takeFocus = variant === 'dock',
  context = null,
  onOpen = href => window.location.assign(href),
  eyebrow,
  bodyNode,
  children,
  stepKey,
  skipLabel = 'Skip',
  submitLabel = 'Submit',
  onEscape,
  escapeLabel = 'Stop',
}: DecisionCardProps) {
  const uid = useId();
  const questionId = `${uid}-q`;
  const bodyId = `${uid}-b`;
  const optionId = (i: number) => `${uid}-o${i}`;
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const { options, multiple, allowOther } = decision;
  const hasForm = children !== undefined && children !== null && children !== false;
  const resetKey = stepKey ?? `${decision.subject ?? 'ask'}:${decision.id}`;
  const [selected, setSelected] = useState<string[]>(() => initialSelection(decision));
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(o => o.recommended)));
  const [other, setOther] = useState('');
  // A new Decision starts fresh: its own recommendation, nothing typed.
  const [seen, setSeen] = useState(resetKey);
  if (seen !== resetKey) {
    setSeen(resetKey);
    setSelected(initialSelection(decision));
    setActive(Math.max(0, options.findIndex(o => o.recommended)));
    setOther('');
  }
  const locked = busy || disabled;
  const hasOptions = options.length > 0;
  const title = decisionTitle(decision, agentName);
  // A permission prompt's Esc says no; anywhere else Esc only folds.
  const isApproval = decision.kind === 'approval' && !multiple;
  const escDenies = isApproval && options.some(o => o.id === DENY_ID);
  const recommendedIndex = options.findIndex(o => o.recommended);
  // An option whose effect has a picture (a drafted brand): drawn under the why.
  const lookOption = options.find(o => o.look);

  useLayoutEffect(() => {
    if (variant === 'dock') {
      scrollSlotToTop(rootRef.current);
    }
  }, [resetKey, variant]);

  useEffect(() => {
    if (!takeFocus || collapsed || busy || typingElsewhere()) {
      return;
    }
    // A step's form first when it has one; else the list; else the free text.
    const first = formRef.current?.querySelector<HTMLElement>('input, select, textarea');
    (first ?? (hasOptions ? listRef.current : otherRef.current))?.focus({ preventScroll: true });
  }, [resetKey, takeFocus, collapsed, hasOptions, hasForm, busy]);

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
        // Sent: the words leave the field (a walk's step stays docked while the agent answers them).
        setOther('');
      }
      return;
    }
    const chosen = selected.length > 0 ? selected : !multiple && options[active] ? [options[active]!.id] : [];
    // A link option opens its flow (a login, a token form); the flow answers
    // the Decision on its way back.
    const link = !multiple && chosen.length === 1 ? options.find(o => o.id === chosen[0])?.href : undefined;
    if (link) {
      onOpen(link);
      return;
    }
    // A step that is only a form (a key, a setting) submits the form; a
    // walk's several-choice step may be submitted with none.
    if (chosen.length > 0 || (hasForm && !hasOptions) || (multiple && onEscape)) {
      onAnswer({ kind: 'option', optionIds: multiple ? options.filter(o => chosen.includes(o.id)).map(o => o.id) : chosen.slice(0, 1) });
    }
  };

  // A step's form submits like the list: Enter (⌘↵ in a text area).
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

  const collapse = () => {
    if (onEscape) {
      onEscape();
      return;
    }
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isApproval && recommendedIndex !== -1) {
      e.preventDefault();
      const o = options[recommendedIndex]!;
      if (o.href) {
        onOpen(o.href);
      } else {
        onAnswer({ kind: 'option', optionIds: [o.id] });
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submit('list');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onEscape) {
        onEscape();
      } else if (escDenies) {
        onAnswer({ kind: 'option', optionIds: [DENY_ID] });
      } else {
        collapse();
      }
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
      // Words half-typed are put down first, never sent as a no.
      if (other.trim() && hasOptions) {
        setOther('');
        listRef.current?.focus();
      } else if (onEscape) {
        onEscape();
      } else if (escDenies && !locked) {
        onAnswer({ kind: 'option', optionIds: [DENY_ID] });
      } else {
        collapse();
      }
      return;
    }
    if (e.key === 'ArrowUp' && hasOptions && (e.currentTarget.selectionStart ?? 0) === 0) {
      e.preventDefault();
      listRef.current?.focus();
    }
  };

  // A walk says where it is even on its only step; a queue only when more wait.
  const queue = position && (position.total > 1 || (eyebrow !== undefined && position.total > 0)) ? `${position.index + 1} of ${position.total}` : null;
  // A sign-off is about an artifact: it opens beside the conversation, in place.
  const artifactRef = decision.refs?.find(r => r.type === 'artifact') ?? null;
  // "Waiting on you · Revenue lead asks", or "Waiting on you" alone — never
  // "Waiting on you · A decision for you", which says the same thing twice.
  const asker = eyebrow ?? (context ? (agentName ? `${context} · ${agentName} asks` : context) : agentName ? `${agentName} asks` : 'A decision for you');
  const canSubmit = !locked && (selected.length > 0 || (hasOptions && !!options[active]) || other.trim().length > 0 || hasForm || (multiple && !!onEscape));
  // Said once per Decision, for a screen reader: what arrived and how to answer it.
  const announcement = useMemo(
    () => `${asker}: ${title}. ${hasOptions ? `${options.length} ${options.length === 1 ? 'option' : 'options'}${options.some(o => o.recommended) ? ', the recommended one first' : ''}. Press a number to pick and Enter to submit.` : 'Type your answer and press Enter.'}`,
    [asker, title, hasOptions, options],
  );

  const headActions = (
    <>
      {artifactRef && (
        <button
          type="button"
          onClick={ev => openPreview({ type: 'artifact', id: artifactRef.id }, ev.currentTarget)}
          className="mt-0.5 shrink-0 text-[12px] text-muted-foreground hover:text-foreground hover:underline"
          data-testid="decision-open-artifact"
        >
          Open it
        </button>
      )}
      {decision.href && (
        <Link href={decision.href} className="mt-0.5 shrink-0 text-[12px] text-muted-foreground hover:text-foreground hover:underline" data-testid="decision-details">
          {decision.hrefLabel ?? 'Details'}
        </Link>
      )}
      {onEscape && (
        <button
          type="button"
          onClick={onEscape}
          aria-label={`${escapeLabel} (Esc)`}
          title={`${escapeLabel} (Esc)`}
          data-testid="decision-escape"
          className="-mt-0.5 -mr-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground max-md:h-11"
        >
          {escapeLabel}
          <X className="size-3.5" aria-hidden />
        </button>
      )}
      {variant === 'dock' && !onEscape && (
        <button
          type="button"
          onClick={collapse}
          aria-expanded
          aria-label="Fold the decision away (Esc)"
          title="Fold away (Esc)"
          className="-mt-0.5 -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface-hover hover:text-foreground max-md:size-11"
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
      )}
    </>
  );

  if (variant === 'dock' && collapsed) {
    return (
      <div className="mb-2" data-testid="decision-card" data-collapsed="true" data-decision-id={decision.id}>
        <button
          type="button"
          onClick={() => onCollapsedChange?.(false)}
          aria-expanded={false}
          className={`flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-[13px] transition hover:bg-surface-hover ${TAP}`}
        >
          <span className="shrink-0 font-medium text-foreground">{queue ? `${position!.total} decisions waiting` : '1 decision waiting'}</span>
          <span className="min-w-0 truncate text-muted-foreground">{title}</span>
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
      aria-describedby={decision.body || bodyNode ? bodyId : undefined}
      // Height on a phone is the composer's slot's to cap (`PINNED_MAX_CLASS`).
      className={variant === 'dock' ? 'mb-2 px-4 pt-3 pb-3 shadow-sm' : 'px-4 py-3'}
      data-testid="decision-card"
      data-decision-id={decision.id}
      data-variant={variant}
      ref={rootRef}
    >
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {/* Docked, the question and the buttons stay in view while the middle
          scrolls in the composer's capped slot (a phone, a keyboard, a phone
          on its side): the person always sees what they are answering and
          how to send it (2026-10-09). Inert where nothing scrolls. */}
      <div className={`flex items-start gap-2 ${variant === 'dock' ? STICKY_HEAD : ''}`} data-testid="decision-head">
        {/* The asking agent's own avatar, the same dot as the team. */}
        {agentName && <AgentDot name={agentName} accent={agentAccent} size="md" decorative className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase" data-testid="decision-eyebrow">
            {asker}
            {queue && (
              <span data-testid="decision-queue">
                {' · '}
                {queue}
              </span>
            )}
          </p>
          <h3 id={questionId} className="mt-1 text-[15px] leading-snug font-medium text-foreground">{title}</h3>
        </div>
        {headActions}
      </div>
      <div className="min-w-0">
        {bodyNode
          ? <div id={bodyId} className={`mt-1 text-[13px] leading-relaxed text-muted-foreground ${variant === 'dock' ? PHONE_BODY : ''}`}>{bodyNode}</div>
          : decision.body && <p id={bodyId} className={`mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground ${variant === 'dock' ? PHONE_BODY : ''}`}>{decision.body}</p>}
        {lookOption?.look && <DecisionLook look={lookOption.look} />}
        {decision.preview && (
          <pre
            className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-surface-soft px-3 py-2 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90"
            data-testid="decision-preview"
            aria-label="What it will do, exactly"
          >
            {decision.preview}
          </pre>
        )}
        {decision.deadline && <p className="mt-1 text-[12px] text-muted-foreground" data-testid="decision-deadline">{deadlineLine(decision.deadline)}</p>}
      </div>

      {hasForm && (
        // The inputs inside own their keys; this only adds Enter-to-submit and Esc.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div ref={formRef} onKeyDown={onFormKey} className="mt-3" data-testid="decision-form">
          {children}
        </div>
      )}

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
                className={`flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition ${TAP} ${isSelected ? 'bg-surface-soft' : 'hover:bg-surface-hover'} ${i === active ? 'ring-1 ring-border' : ''} ${locked ? 'cursor-default opacity-60' : ''}`}
              >
                <kbd className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded border font-sans text-[11px] font-medium ${isSelected ? 'border-transparent bg-action text-action-foreground' : 'border-border text-muted-foreground'}`}>{i + 1}</kbd>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[14px] font-medium text-foreground">{o.label}</span>
                    {o.recommended && <span className="text-[11px] font-medium text-[var(--brand-pass)]">Recommended</span>}
                    {o.href && leavesConversation(o.href) && <span className="text-[11px] text-muted-foreground" data-testid="decision-option-opens">Opens ↗</span>}
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
            placeholder={decision.kind === 'signoff' ? 'Revise — say what to change…' : hasOptions ? 'Something else…' : 'Your answer…'}
            data-testid="decision-other"
            className={`min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-foreground/40 ${TAP}`}
          />
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-[12px] text-[var(--brand-fail)]">{error}</p>}

      <div className={`mt-3 flex items-center gap-2 border-t border-border pt-2.5 ${variant === 'dock' ? STICKY_FOOT : ''}`} data-testid="decision-foot">
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
          {isApproval && recommendedIndex !== -1 && (
            <>
              {' · '}
              <kbd className="font-sans">⌘↵</kbd>
              {` ${options[recommendedIndex]!.label.toLowerCase()}`}
            </>
          )}
          {(variant === 'dock' || onEscape) && (
            <>
              {' · '}
              <kbd className="font-sans">Esc</kbd>
              {onEscape ? ` ${escapeLabel.toLowerCase()}` : escDenies ? ' deny' : ' fold'}
            </>
          )}
          {allowOther && hasOptions && (
            <>
              {' · '}
              <kbd className="font-sans">Tab</kbd>
              {' something else'}
            </>
          )}
        </p>
        <span className="flex-1 sm:hidden" />
        {skipLabel && (
          <button
            type="button"
            onClick={() => !locked && onAnswer({ kind: 'skip' })}
            disabled={locked}
            data-testid="decision-skip"
            className={`rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50 ${TAP}`}
          >
            {skipLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => submit(document.activeElement === otherRef.current || (!hasOptions && !hasForm) ? 'other' : 'list')}
          onMouseDown={e => e.preventDefault()}
          disabled={!canSubmit}
          data-testid="decision-submit"
          className={`inline-flex items-center gap-1.5 rounded-md bg-action px-3 py-1.5 text-[13px] font-medium text-action-foreground transition hover:opacity-90 disabled:opacity-40 ${TAP}`}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CornerDownLeft className="size-3.5" aria-hidden />}
          {submitLabel}
        </button>
      </div>
    </Surface>
  );
}
