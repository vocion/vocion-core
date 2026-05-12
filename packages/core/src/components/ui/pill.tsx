import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * Pill — marketing-side primitive for the hand-rolled hero pills,
 * feature tags, version chips, and the small "Recommended" / "Beta"
 * style badges scattered across the marketing pages.
 *
 * Two visual flavors:
 *   - `round`  — fully rounded, soft muted bg (default for hero / nav).
 *   - `square` — rounded-md, tighter; closer to a tag/keyword chip.
 *
 * Two tones:
 *   - `neutral` — border + muted bg + foreground text (default).
 *   - `amber`   — brand-amber tint + deep amber text (for the
 *                 "Recommended" / "New" callouts).
 *
 * The dashboard-side StatusPill remains its own thing (semantic
 * statuses with tokens); this Pill is intentionally cosmetic.
 */

type Props = ComponentProps<'span'> & {
  variant?: 'round' | 'square';
  tone?: 'neutral' | 'amber';
  children: ReactNode;
};

export function Pill({ variant = 'round', tone = 'neutral', className, children, ...rest }: Props) {
  return (
    <span
      data-slot="pill"
      data-variant={variant}
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 border px-3 py-1 text-xs font-medium whitespace-nowrap',
        variant === 'round' ? 'rounded-full' : 'rounded-md',
        tone === 'amber'
          ? 'border-[var(--brand-amber)]/30 bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]'
          : 'border-border bg-muted/40 text-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
