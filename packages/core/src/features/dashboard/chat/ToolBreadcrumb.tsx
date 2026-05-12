'use client';

import { AlertCircle, ArrowRight, Check } from 'lucide-react';

/**
 * Inline tool breadcrumb (Phase C — rev-ai pattern).
 *
 * Rendered between text runs inside an `<AgentMessage>`. Three states:
 *   - pending: brand-amber border + pulsing dot
 *   - done:    brand-amber border + checkmark
 *   - error:   destructive border + alert icon
 *
 * Visual: `border-l-2` left rail, `font-mono`, `text-xs`. Pattern
 * ported from rev-ai's `.msg-tool` CSS class (templates/dashboard/chat.html).
 */

export type ToolBreadcrumbProps = {
  name: string;
  state?: 'pending' | 'done' | 'error';
  /** Optional short input preview (e.g. `query="discovery call this week"`). */
  inputPreview?: string;
  /** Optional click handler to expand into a detail panel (ThinkingPanel). */
  onClick?: () => void;
};

const STATE_STYLES = {
  pending: 'border-brand-amber/70 text-brand-amber-deep',
  done: 'border-brand-amber/40 text-zinc-700',
  error: 'border-red-400 text-red-700',
} as const;

export function ToolBreadcrumb({ name, state = 'done', inputPreview, onClick }: ToolBreadcrumbProps) {
  const stateClass = STATE_STYLES[state];
  const Icon = state === 'error' ? AlertCircle : state === 'pending' ? null : Check;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`my-2 flex w-fit items-center gap-2 border-l-2 ${stateClass} py-1 pl-3 font-mono text-xs transition hover:bg-brand-amber-tint/50 ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      disabled={!onClick}
    >
      <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
      <span className="font-semibold">{name}</span>
      {inputPreview ? <span className="text-zinc-500">{inputPreview}</span> : null}
      {state === 'pending'
        ? (
            <span
              className="size-1.5 animate-pulse rounded-full bg-brand-amber"
              aria-label="pending"
            />
          )
        : Icon
          ? <Icon className="size-3 shrink-0" aria-hidden="true" />
          : null}
    </button>
  );
}
