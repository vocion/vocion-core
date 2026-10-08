import type { LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Tint } from '@/libs/tints';
import { TINT_BG } from '@/libs/tints';
import { cn } from '@/utils/Helpers';

/**
 * LetterTile — the one square mark for a connector, a plugin, an app. A
 * brand's logo when it has one (`logo`, resolved by `IntegrationLogo` from a
 * descriptor's `brand`), else an icon (an app's), else a monogram (one or two
 * letters); on the surface colour with a hairline, or on its tint.
 * `muted` is the dashed outline of something not here yet (a Coming item,
 * "Add app").
 *
 * A logo always sits on the surface, never a tint: its fills were chosen for
 * contrast against `--card` in each theme (`libs/brands/contrast.ts`).
 *
 * Decorative: the name it stands for is always text beside it.
 */

const SIZE = {
  xs: 'size-4 rounded-[5px] text-[8px] [&>svg]:size-2.5',
  sm: 'size-7 rounded-lg text-[11px] [&>svg]:size-3.5',
  md: 'size-9 rounded-xl text-[13px] [&>svg]:size-4',
  lg: 'size-11 rounded-xl text-[15px] [&>svg]:size-5',
} as const;

/** A brand's mark sits a step larger than a lucide icon: it is the whole tile's content. */
const LOGO_SIZE = { xs: '[&>svg]:size-3', sm: '[&>svg]:size-4', md: '[&>svg]:size-5', lg: '[&>svg]:size-6' } as const;

/**
 * A brand mark to draw in the tile: one SVG path in a 24×24 box and its fill
 * in each theme — the brand colour, or null to draw in the tile's ink.
 */
export type TileLogo
  = | { kind: 'path'; path: string; fills: { light: string | null; dark: string | null } }
    | { kind: 'file'; light: string; dark: string | null };

/** A vendor file sits a little larger than a path mark: kits draw their own clear space into the file. */
const FILE_SIZE = { xs: 'size-3.5', sm: 'size-5', md: 'size-6', lg: 'size-7' } as const;

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

export function LetterTile({ name, logo, icon: Icon, tint, size = 'md', muted = false, className }: {
  /** What the tile stands for; its monogram is drawn when there is no logo or icon. */
  name: string;
  /** A brand's mark, drawn ahead of the icon and the monogram. */
  logo?: TileLogo | null;
  /** An icon instead of the monogram (an app's lucide icon). */
  icon?: LucideIcon;
  /** Sit on this tint instead of the surface. */
  tint?: Tint;
  size?: keyof typeof SIZE;
  /** Not here yet: a dashed outline, muted ink. */
  muted?: boolean;
  className?: string;
}) {
  // Something not here yet draws its mark in muted ink, like its monogram would.
  const fills = logo?.kind === 'path' && !muted ? logo.fills : { light: null, dark: null };
  // A vendor's file is never recoloured: with no dark variant in its kit it
  // keeps the white it was drawn for, in both themes.
  const whiteTile = logo?.kind === 'file' && !logo.dark && !muted;
  return (
    <span
      aria-hidden
      data-slot="letter-tile"
      data-logo={logo ? logo.kind : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold tracking-tight select-none',
        SIZE[size],
        logo?.kind === 'path' && LOGO_SIZE[size],
        muted
          ? 'border border-dashed border-ink-secondary/40 text-muted-foreground'
          : tint && !logo
            ? [TINT_BG[tint], 'text-foreground']
            : whiteTile
              ? 'border border-border bg-white text-foreground'
              : 'border border-border bg-card text-foreground',
        className,
      )}
    >
      {logo?.kind === 'path' && (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          focusable="false"
          className="fill-(--logo-light) dark:fill-(--logo-dark)"
          style={{ '--logo-light': fills.light ?? 'currentColor', '--logo-dark': fills.dark ?? 'currentColor' } as CSSProperties}
        >
          <path d={logo.path} />
        </svg>
      )}
      {logo?.kind === 'file' && (
        <>
          {/* The vendor's file, served unmodified (libs/brands/ATTRIBUTION.md). */}
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={logo.light} alt="" aria-hidden className={cn(FILE_SIZE[size], 'object-contain', logo.dark && 'dark:hidden', muted && 'opacity-50 grayscale')} />
          {logo.dark && (
            // eslint-disable-next-line next/no-img-element
            <img src={logo.dark} alt="" aria-hidden className={cn(FILE_SIZE[size], 'hidden object-contain dark:block', muted && 'opacity-50 grayscale')} />
          )}
        </>
      )}
      {!logo && (Icon ? <Icon aria-hidden /> : monogram(name))}
    </span>
  );
}
