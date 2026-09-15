import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EntityStatus } from '@/types/Status';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { StatusPill } from './status-pill';

/**
 * CatalogCard — one card shape for every catalog list (Agents, Skills,
 * Workflows, Sources). Wraps a Link, keeps the visual rhythm
 * consistent across pages.
 *
 * Slots:
 *   - icon          (Lucide) + optional accent stripe color (per-agent)
 *   - title         entity name
 *   - slug          font-mono secondary line
 *   - description   short text (truncated to 2 lines via line-clamp)
 *   - status        EntityStatus → renders as StatusPill
 *   - footer        free-form metadata row at the bottom (e.g.
 *                   "Last run 2h ago · 84% success")
 *
 * Stays purely presentational — caller handles data fetching + routing.
 */

type Props = {
  href: string;
  icon: LucideIcon;
  title: string;
  slug?: string;
  description?: string | null;
  status?: EntityStatus;
  footer?: ReactNode;
  /**
   * Optional left-border accent color (e.g. per-agent accent from
   * libs/agentAccent.ts). Pass any valid CSS color or a `var(--...)`.
   */
  accentColor?: string;
  className?: string;
};

export function CatalogCard({
  href,
  icon: Icon,
  title,
  slug,
  description,
  status,
  footer,
  accentColor,
  className,
}: Props) {
  return (
    <Link
      href={href}
      data-slot="catalog-card"
      className={cn(
        // Airy pass (B-034b §2): 1px hairline at 6%, no shadow, no accent bar — the
        // accent moves to a 6px dot before the title.
        'group relative flex flex-col gap-2 rounded-xl border border-border/70 bg-background p-4 transition-colors hover:bg-surface-hover',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {accentColor
          ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: accentColor }} aria-hidden />
          : <Icon className="size-4 text-muted-foreground" aria-hidden />}
        <span className="text-sm leading-tight font-semibold">{title}</span>
        {status && (
          <span className="ml-auto">
            <StatusPill status={status} size="sm" />
          </span>
        )}
      </div>
      {slug && <div className="font-mono text-[11px] text-muted-foreground">{slug}</div>}
      {description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {footer && (
        <div className="mt-auto border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
          {footer}
        </div>
      )}
    </Link>
  );
}
