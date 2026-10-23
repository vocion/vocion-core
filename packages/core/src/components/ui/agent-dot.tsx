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
 * passes it; rosters keep the initial. Below 24px (inline in chat, history
 * rows) there is no letter at all: the colour and the name beside it say who.
 * `working` turns the dot into the spark while the agent works, and
 * `settling` lets it go once the work ends.
 *
 * Drawn as a soft orb (design refresh, 2026-10-23): the accent lit from the
 * top left and deepening to its AA `dot` shade at the bottom right, where
 * the initial's contrast is measured. Colour, not a flat disc, is what made
 * the old roster read as a row of mismatched stickers.
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

/** Below 24px a letter is noise: the colour and the name beside it say who. */
const SHOWS_INITIAL: Record<keyof typeof SIZE, boolean> = { xs: false, sm: false, md: true, lg: true, xl: true };

export function AgentDot({ name, accent, icon: Icon, size = 'md', decorative = false, working = false, settling = false, className }: {
  /** The agent's display name; its first letter is drawn. */
  name: string;
  /** The agent's authored icon, drawn instead of the initial (profiles). */
  icon?: LucideIcon;
  /** The agent's authored `accent` name. Absent reads as the brand amber. */
  accent?: string | null;
  size?: AgentDotSize;
  /** True when the name is already visible beside the dot. */
  decorative?: boolean;
  /**
   * The agent is at work: the spark blooms over its colour, turns and
   * breathes, then settles back when this goes false (`.agent-dot-spark`,
   * styles/global.css). The same element across the change is what makes
   * the transition; a dot that mounts working blooms in.
   */
  working?: boolean;
  /** Work just ended: the spark shows once more and fades back to the agent's colour. */
  settling?: boolean;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const { dot } = agentAccent(accent);
  return (
    <span
      data-slot="agent-dot"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : name}
      data-working={working || undefined}
      data-settling={(settling && !working) || undefined}
      data-flat={size === 'xs' || size === 'sm' || undefined}
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold text-white select-none', SIZE[size], className)}
      style={{
        background: `radial-gradient(circle at 30% 25%, oklch(1 0 0 / 38%), oklch(1 0 0 / 0%) 55%), linear-gradient(135deg, color-mix(in oklch, ${dot} 78%, white), ${dot} 60%)`,
        textShadow: `0 1px 1px color-mix(in oklch, ${dot} 70%, black)`,
      }}
    >
      <span className="agent-dot-face inline-flex items-center justify-center">
        {Icon ? <Icon className={GLYPH[size]} strokeWidth={2} aria-hidden /> : SHOWS_INITIAL[size] ? initial : null}
      </span>
      <span className="agent-dot-spark" aria-hidden />
    </span>
  );
}

/**
 * AgentDots — a small overlapping stack of agents, as a picture: for a stack
 * drawn inside another control (the timeline's step row). Where the stack is
 * its own thing, use `AgentStack` (`agent-stack.tsx`), which lifts, names and
 * opens each agent.
 * @param props - The stack.
 * @param props.agents - The agents, front first.
 * @param props.max - How many to draw before "+N".
 * @param props.size - Dot size.
 * @param props.className - Extra classes on the stack.
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

/** The dot sizes, for a stack drawn around `AgentDot`. */
export const AGENT_DOT_SIZE = SIZE;
