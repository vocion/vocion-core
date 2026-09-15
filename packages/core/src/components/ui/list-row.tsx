import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * ListRow — the navigational row that replaces tile grids on catalog pages
 * (Learnings, Skills, Tools, Connectors): icon, title, optional meta line,
 * optional trailing content (a count, a status pill), chevron. Rows sit in a
 * `<ListRows>` parent that draws the hairlines between them. Airy pass
 * (B-034b §2) — no borders on the rows themselves, hover is a soft fill.
 */

type RowProps = {
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

export function ListRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-slot="list-rows" className={cn('divide-y divide-border/70', className)}>
      {children}
    </div>
  );
}

export function ListRow({ href, onClick, icon: Icon, title, meta, trailing, className }: RowProps) {
  const body = (
    <>
      {Icon && (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-soft text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{meta}</span>}
      </span>
      {trailing && <span className="shrink-0 text-[12px] text-muted-foreground">{trailing}</span>}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </>
  );
  const classes = cn(
    'group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover',
    className,
  );
  if (href) {
    return <Link href={href} data-slot="list-row" className={classes}>{body}</Link>;
  }
  return <button type="button" onClick={onClick} data-slot="list-row" className={classes}>{body}</button>;
}
