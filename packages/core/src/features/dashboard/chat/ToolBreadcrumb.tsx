'use client';

import { AlertCircle, ArrowRight, Check } from 'lucide-react';

/**
 * Inline tool breadcrumb — N.4 polish.
 *
 * Rendered between text runs inside an `<AgentMessage>`. Three states:
 *   - pending: amber border + pulsing dot
 *   - done:    pass-green border + checkmark
 *   - error:   fail-red border + alert icon
 *
 * Was: a 40-char gray micro-text input preview that was easy to miss.
 * Now: name on the header row + 2-line monospace input preview
 * underneath when present. State borders use the same design tokens
 * as StatusPill so the visual language stays consistent.
 */

export type ToolBreadcrumbProps = {
  name: string;
  state?: 'pending' | 'done' | 'error';
  /** Optional short input preview (e.g. `query="discovery call this week"`). */
  inputPreview?: string;
  /** Optional output preview shown when state is `done` or `error`. */
  outputPreview?: string;
  /** Optional click handler to expand into a detail panel (ThinkingPanel). */
  onClick?: () => void;
};

const STATE_STYLES = {
  pending: 'border-[var(--brand-amber)]/60',
  done: 'border-[var(--brand-pass)]/40',
  error: 'border-[var(--brand-fail)]/60 bg-[var(--brand-fail-bg)]/30',
} as const;

const ICON_COLOR = {
  pending: 'text-[var(--brand-amber-deep)]',
  done: 'text-[var(--brand-pass)]',
  error: 'text-[var(--brand-fail)]',
} as const;

export function ToolBreadcrumb({ name, state = 'done', inputPreview, outputPreview, onClick }: ToolBreadcrumbProps) {
  const stateBorder = STATE_STYLES[state];
  const iconColor = ICON_COLOR[state];
  const Icon = state === 'error' ? AlertCircle : state === 'pending' ? null : Check;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`my-2 flex w-full max-w-full flex-col gap-1 rounded-md border-l-2 ${stateBorder} py-1.5 pr-2 pl-3 text-left transition hover:bg-muted/40 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      disabled={!onClick}
    >
      <span className="flex items-center gap-2 text-xs">
        <ArrowRight className={`size-3 shrink-0 ${iconColor}`} aria-hidden="true" />
        <span className="font-mono font-semibold">{name}</span>
        {state === 'pending'
          ? (
              <span
                className="size-1.5 animate-pulse rounded-full bg-[var(--brand-amber)]"
                aria-label="pending"
              />
            )
          : Icon
            ? <Icon className={`size-3 shrink-0 ${iconColor}`} aria-hidden="true" />
            : null}
      </span>
      {inputPreview && (
        <div className="ml-5 line-clamp-2 font-mono text-xs leading-relaxed break-all text-foreground/70">
          {inputPreview}
        </div>
      )}
      {outputPreview && state !== 'pending' && (
        <div className={`ml-5 line-clamp-1 font-mono text-[11px] break-all ${state === 'error' ? 'text-[var(--brand-fail)]' : 'text-muted-foreground'}`}>
          → {outputPreview}
        </div>
      )}
    </button>
  );
}
