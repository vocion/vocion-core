import type { LucideIcon } from 'lucide-react';
import { LetterTile } from '@/components/ui/letter-tile';
import { resolveBrandMark } from '@/libs/brands/catalog';

type IntegrationLogoProps = {
  /** The descriptor's `brand` — a catalog key. Unknown or absent draws the fallback. */
  brand?: string | null;
  /** The integration's name: the monogram when there is no mark and no icon. */
  name: string;
  /** The fallback when there is no mark (a connector's lucide icon). */
  icon?: LucideIcon;
  /** `xs` (16px) sits inline in a line of small text; `sm` leads a row; `md` a card; `lg` a page. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Not here yet: the tile's dashed outline, the mark in muted ink. */
  muted?: boolean;
  /**
   * Draw nothing when the brand has no mark, rather than the fallback tile:
   * for a line of text that already names the integration, where its initials
   * beside its name would say nothing twice.
   */
  markOnly?: boolean;
  className?: string;
};

/**
 * IntegrationLogo — the tile for anything Vocion connects to: a connector, a
 * credential platform, a model provider, a tool provider. It is a `LetterTile`
 * (one shape, principle 6) whose content is the brand's mark when the
 * descriptor names a brand that has one, and otherwise exactly what the tile
 * drew before — the icon, or the monogram.
 *
 * The brand comes from the descriptor (`brand` on a platform in
 * `libs/platforms/registry.ts`, on a connector in `libs/sources/*.ts`), never
 * from the caller's own list: no surface names a vendor. Which brands have a
 * mark, and why the rest do not, is `libs/brands/catalog.ts`.
 *
 * Decorative, like every tile: the integration's name is always text beside it.
 * @param props - See {@link IntegrationLogoProps}.
 */
export function IntegrationLogo(props: IntegrationLogoProps) {
  const logo = resolveBrandMark(props.brand);
  if (!logo && props.markOnly) {
    return null;
  }
  return <LetterTile name={props.name} logo={logo} icon={props.icon} size={props.size} muted={props.muted} className={props.className} />;
}
