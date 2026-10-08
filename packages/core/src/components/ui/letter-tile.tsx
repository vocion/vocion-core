import type { LucideIcon } from 'lucide-react';
import type { Tint } from '@/libs/tints';
import { TINT_BG } from '@/libs/tints';
import { cn } from '@/utils/Helpers';

/**
 * LetterTile — the one square mark for a thing that has no logo of its own:
 * a connector, a plugin, an app. A monogram (one or two letters) or, for an
 * app, its icon; on the surface colour with a hairline, or on its tint.
 * `muted` is the dashed outline of something not here yet (a Coming item,
 * "Add app").
 *
 * Decorative: the name it stands for is always text beside it.
 */

const SIZE = {
  sm: 'size-7 rounded-lg text-[11px] [&>svg]:size-3.5',
  md: 'size-9 rounded-xl text-[13px] [&>svg]:size-4',
  lg: 'size-11 rounded-xl text-[15px] [&>svg]:size-5',
} as const;

/**
 * Up to two letters for a name: the first letter of the first two words, or
 * the first two letters of a single word ("Northwind" → "No", "Kestrel
 * Capital" → "KC").
 * @param name - The name the tile stands for.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    const w = words[0]!;
    return (w.charAt(0).toUpperCase() + w.charAt(1).toLowerCase()).trim();
  }
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

export function LetterTile({ name, icon: Icon, tint, size = 'md', muted = false, className }: {
  /** What the tile stands for; its monogram is drawn when there is no icon. */
  name: string;
  /** An icon instead of the monogram (an app's lucide icon). */
  icon?: LucideIcon;
  /** Sit on this tint instead of the surface. */
  tint?: Tint;
  size?: keyof typeof SIZE;
  /** Not here yet: a dashed outline, muted ink. */
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-slot="letter-tile"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight select-none',
        SIZE[size],
        muted
          ? 'border border-dashed border-ink-secondary/40 text-muted-foreground'
          : tint
            ? [TINT_BG[tint], 'text-foreground']
            : 'border border-border bg-card text-foreground',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden /> : monogram(name)}
    </span>
  );
}
