'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/Helpers';

/**
 * StickyActionBar — the decision bar that never scrolls away. One ink
 * primary, ghost secondaries, an optional collapsed field (feedback, a note)
 * that expands inline, and an optional slot for a snooze picker. Sticks to the
 * bottom of the content column it sits in — not the viewport — so a
 * conversation rail beside the page is never covered. On a phone the buttons
 * stack full-width, primary first, over the safe area.
 *
 * Chris, 2026-09-15: "the action bar should be fixed/sticky to the bottom so
 * I don't have to scroll to take action." Manifesto #11: the important thing
 * (deciding) is obvious at every scroll position.
 *
 * The inbox's `AskSheet` carries its own fixed bottom bar with the same
 * shape (border-top, blur, safe-area padding). Left alone here on purpose —
 * it is another PR's surface — but it is the obvious second consumer once
 * this bar has settled.
 *
 * The collapsed field's toggle takes its wording as a prop (English default)
 * rather than reading `useTranslations('Review')`: the bar is a pattern-library
 * primitive and also renders on surfaces that mount no intl provider (the lead
 * page, the stories, the browser tests). Translated surfaces pass the strings
 * in. Re-exported from `components/patterns`.
 */

export type BarAction = {
  'label': ReactNode;
  'onClick': () => void;
  'disabled'?: boolean;
  'busy'?: boolean;
  'icon'?: LucideIcon;
  /** A one-key hint shown as a kbd chip, e.g. "a". */
  'shortcut'?: string;
  /** Ghost by default; `danger` reddens on hover. The primary is always ink. */
  'tone'?: 'ghost' | 'danger';
  /**
   * Why the button is dead, when it is. A disabled control takes no pointer
   * events, so the reason rides a wrapper that still hovers, and an
   * `aria-describedby` so it is not hover-only.
   */
  'hint'?: string;
  'data-testid'?: string;
};

export type BarField = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Renders beside the field once it is expanded (Regenerate, Rewrite). */
  action?: BarAction;
  /** A quiet line under the field, e.g. "Type feedback to regenerate". */
  hint?: ReactNode;
  /** Open on mount — when the field already has text, for instance. */
  defaultOpen?: boolean;
};

// `--action`, `--surface-hover`, `--surface-soft` are the airy-shell tokens
// (PR #330); each falls back to a token main already has, so the bar reads
// the same on either branch.
const INK = 'bg-[var(--action,var(--foreground))] text-[var(--action-foreground,var(--background))] shadow-none hover:bg-[var(--action,var(--foreground))] hover:text-[var(--action-foreground,var(--background))] hover:opacity-90';
const GHOST = 'text-foreground/80 hover:bg-[var(--surface-hover,var(--muted))] hover:text-foreground';
const SOFT = 'bg-[var(--surface-soft,var(--muted))]';

function ActionButton({ a, primary }: { a: BarAction; primary?: boolean }) {
  const Icon = a.icon;
  const hintId = a.hint ? `bar-hint-${String(a['data-testid'] ?? 'action')}` : undefined;
  const button = (
    <Button
      variant="ghost"
      size="default"
      onClick={a.onClick}
      disabled={a.disabled || a.busy}
      data-testid={a['data-testid']}
      aria-describedby={hintId}
      className={cn(
        'h-11 w-full gap-2 rounded-lg text-sm sm:h-10 sm:w-auto',
        primary ? `${INK} sm:min-w-36` : GHOST,
        !primary && a.tone === 'danger' && 'hover:text-red-600 dark:hover:text-red-400',
      )}
    >
      {a.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon && <Icon className="size-4" aria-hidden />}
      <span>{a.label}</span>
      {a.shortcut && (
        // Decorative, like the icon above it: the letter is a hint at the
        // keyboard shortcut, not part of what the button is called. Without
        // this it joins the accessible name ("Snooze s"), which is what a
        // screen reader announces and what `getByRole('button', {name})`
        // matches on.
        <kbd aria-hidden className={cn('ml-0.5 hidden rounded border px-1 font-mono text-[10px] leading-4 sm:inline', primary ? 'border-current/30 opacity-80' : 'border-border text-muted-foreground')}>
          {a.shortcut}
        </kbd>
      )}
    </Button>
  );
  if (!a.hint) {
    return button;
  }
  return (
    // A real box, not `display:contents`: the disabled button takes no pointer
    // events, so THIS is what the pointer lands on and what the tooltip hangs off.
    <span title={a.hint} className="flex w-full sm:w-auto">
      {button}
      <span id={hintId} className="sr-only">{a.hint}</span>
    </span>
  );
}

export function StickyActionBar(props: {
  primary: BarAction;
  secondary?: BarAction[];
  field?: BarField;
  /** The collapsed field's toggle. Translated surfaces pass their own strings. */
  labels?: { addField?: string; hideField?: string };
  /** A slot beside the verbs: a snooze picker, for instance. */
  aside?: ReactNode;
  className?: string;
}) {
  const addLabel = props.labels?.addField ?? 'Add feedback';
  const hideLabel = props.labels?.hideField ?? 'Hide feedback';
  const { primary, secondary = [], field, aside } = props;
  const [fieldOpen, setFieldOpen] = useState(field?.defaultOpen ?? false);
  const showField = field !== undefined && (fieldOpen || field.value.trim().length > 0);

  return (
    <div
      data-testid="sticky-action-bar"
      className={cn(
        // Sticky to the bottom of the column it lives in; bleeds to the page
        // gutter so the hairline runs edge to edge; safe-area padding on phones.
        'sticky bottom-0 z-20 -mx-4 mt-8 border-t border-rule bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6',
        props.className,
      )}
    >
      {showField && (
        <div className="mb-3">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start">
            <textarea
              aria-label={field.label}
              className={cn('min-h-16 w-full flex-1 resize-y rounded-lg px-3 py-2 text-sm leading-relaxed transition outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-ring/30', SOFT)}
              placeholder={field.placeholder}
              value={field.value}
              onChange={ev => field.onChange(ev.target.value)}
              disabled={field.disabled}
            />
            {field.action && (
              <Button
                variant="ghost"
                size="sm"
                onClick={field.action.onClick}
                disabled={field.action.disabled || field.action.busy}
                className={cn('h-9 shrink-0 gap-1.5', GHOST)}
              >
                {field.action.busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : field.action.icon && <field.action.icon className="size-3.5" aria-hidden />}
                {field.action.label}
              </Button>
            )}
          </div>
          {field.hint && <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>}
        </div>
      )}

      {/* Wraps at `sm`+ too: beside a conversation rail the column can be
          narrower than the verbs, and they must never run under the rail. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {field && (
          <button
            type="button"
            onClick={() => setFieldOpen(o => !o)}
            className={cn('order-last inline-flex h-10 items-center gap-1 self-start rounded-lg px-2 text-[13px] text-muted-foreground transition sm:order-none', GHOST)}
            aria-expanded={showField}
          >
            {showField ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
            {showField ? hideLabel : addLabel}
          </button>
        )}
        {aside && <div className="flex items-center gap-2 sm:ml-2">{aside}</div>}
        <div className="hidden flex-1 sm:block" />
        <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {secondary.map((a, i) => <ActionButton key={i} a={a} />)}
          <ActionButton a={primary} primary />
        </div>
      </div>
    </div>
  );
}
