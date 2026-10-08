import type { LucideIcon } from 'lucide-react';
import { agentAccent } from '@/libs/agentAccents';
import { cn } from '@/utils/Helpers';

/**
 * AgentDot — the one shape an agent's identity takes, everywhere it appears:
 * a round dot in the agent's authored `accent` (`libs/agentAccents.ts`) with
 * its initial in white (AA on every accent). Chat, team rosters, Needs you
 * and run records all draw an agent with this; nothing hand-rolls an avatar
 * (principle 6).
 *
 * `decorative` when the name is already text beside it (a roster row): then
 * the dot says nothing to a screen reader. Otherwise the name is its
 * accessible label and its tooltip.
 *
 * `icon` draws the agent's authored `icon:` (white, on the same accent)
 * instead of its initial. The profile — where the agent is the whole page —
 * passes it; rosters and chat keep the initial, which reads at 16px where a
 * glyph does not.
 */

const SIZE = {
  xs: 'size-4 text-[8px]',
  sm: 'size-5 text-[10px]',
  md: 'size-6 text-[11px]',
  lg: 'size-8 text-[13px]',
  xl: 'size-14 text-xl',
} as const;

const GLYPH: Record<keyof typeof SIZE, string> = { xs: 'size-2.5', sm: 'size-3', md: 'size-3.5', lg: 'size-4', xl: 'size-6' };

export type AgentDotSize = keyof typeof SIZE;

export function AgentDot({ name, accent, icon: Icon, size = 'md', decorative = false, className }: {
  /** The agent's display name; its first letter is drawn. */
  name: string;
  /** The agent's authored icon, drawn instead of the initial (profiles). */
  icon?: LucideIcon;
  /** The agent's authored `accent` name. Absent reads as the brand amber. */
  accent?: string | null;
  size?: AgentDotSize;
  /** True when the name is already visible beside the dot. */
  decorative?: boolean;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      data-slot="agent-dot"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold text-white select-none', SIZE[size], className)}
      style={{ background: agentAccent(accent).dot }}
    >
      {Icon ? <Icon className={GLYPH[size]} strokeWidth={2} aria-hidden /> : initial}
    </span>
  );
}

/**
 * A few agents, overlapped: a team's roster in the space of one dot.
 * @param props
 * @param props.agents - Who, in order; the first is on top.
 * @param props.max - How many dots before "+N".
 * @param props.size - Dot size.
 * @param props.className
 */
export function AgentDots({ agents, max = 4, size = 'sm', className }: {
  agents: ReadonlyArray<{ name: string; accent?: string | null }>;
  max?: number;
  size?: AgentDotSize;
  className?: string;
}) {
  const shown = agents.slice(0, max);
  const more = agents.length - shown.length;
  return (
    <span data-slot="agent-dots" className={cn('inline-flex items-center -space-x-1.5', className)} aria-label={agents.map(a => a.name).join(', ')} role="img">
      {shown.map(a => <AgentDot key={a.name} name={a.name} accent={a.accent} size={size} decorative className="ring-2 ring-background" />)}
      {more > 0 && <span aria-hidden className="pl-2.5 text-[11px] text-muted-foreground">{`+${more}`}</span>}
    </span>
  );
}
