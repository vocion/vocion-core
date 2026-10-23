'use client';

import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * One agent in an overlapping stack (`AgentDots`, the empty chat's
 * `TeamCluster`): every stack of agents behaves the same way (principle 6).
 * Hovered or focused, the agent comes forward over its neighbours, lifts and
 * scales a little while the rest of the stack dims, says who it is in a
 * tooltip, and opens its profile on click. The stack wraps its items in
 * `group/stack`, which is what lets the others dim.
 *
 * The stacking order is the caller's (`z`): first in front. A hover lifts
 * any item above all of them.
 */
const ITEM = cn(
  'relative inline-flex rounded-full ring-2 ring-background outline-none',
  'transition-[transform,opacity,box-shadow] duration-150 ease-out motion-reduce:transition-none',
  'group-hover/stack:opacity-55 group-focus-within/stack:opacity-55',
  'hover:!z-30 hover:!opacity-100 hover:-translate-y-0.5 hover:scale-110 hover:shadow-[0_4px_14px_oklch(0_0_0/18%)]',
  'focus-visible:!z-30 focus-visible:!opacity-100 focus-visible:-translate-y-0.5 focus-visible:scale-110 focus-visible:ring-foreground/40',
);

export function AgentStackItem({ label, href, z, className, children, testId }: {
  /** Who it is: the tooltip and the link's accessible name. */
  label: string;
  /** The agent's profile. Absent, the item still comes forward and says who it is, but opens nothing. */
  href?: string;
  /** Stacking order in the resting stack. */
  z?: number;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const style = z === undefined ? undefined : { zIndex: z };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href
          ? <Link href={href} aria-label={label} data-testid={testId} className={cn(ITEM, className)} style={style}>{children}</Link>
          : <span role="img" aria-label={label} data-testid={testId} className={cn(ITEM, className)} style={style}>{children}</span>}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The "+N" at the end of a stack: the agents the stack does not draw. It
 * opens the whole team, where every one of them is.
 * @param props - The "+N".
 * @param props.count - How many the stack does not draw.
 * @param props.href - The team page.
 * @param props.label - Its accessible name and tooltip.
 * @param props.className - Size and type.
 * @param props.testId - A test id.
 */
export function AgentStackMore({ count, href, label, className, testId }: {
  count: number;
  /** The team page. */
  href: string;
  /** "See all 9 agents". */
  label: string;
  className?: string;
  testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} aria-label={label} data-testid={testId} className={cn(ITEM, 'grid place-items-center bg-surface-soft font-medium text-muted-foreground hover:text-foreground', className)}>
          {`+${count}`}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
