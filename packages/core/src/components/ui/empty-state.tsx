import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * EmptyState — the one canonical empty-state component for catalog
 * pages (Agents, Skills, Workflows, Objects, Sources, Logs). Replaces
 * the bare dashed-border boxes that were the v0.2 default. Branded
 * amber-tinted icon + display-font title + muted description + optional
 * action link.
 *
 * Keep the polished custom empties in ChatShell + ReviewQueue as-is —
 * those have their own affordances (suggestion chips, queue-clear copy).
 *
 * The visual treatment is intentionally low-key: this should feel like
 * "the right place; you just haven't authored anything yet" — not a
 * loud "ERROR / NOTHING HERE" announcement. Anchored to design tokens
 * (`--brand-amber-tint` / `--brand-amber-deep`) so it stays on-brand.
 */

type Action
  = | { label: string; href: string }
    | { label: string; onClick: () => void };

type Props = ComponentProps<'div'> & {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Optional CTA — either internal link (href) or click handler. */
  action?: Action;
  /** Optional secondary action (e.g. "Read the docs"). */
  secondaryAction?: Action;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  ...rest
}: Props) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-background/60 px-6 py-12 text-center',
        className,
      )}
      {...rest}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-amber-tint)] text-[var(--brand-amber-deep)]">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="font-display text-base font-semibold text-foreground">{title}</div>
      {description && (
        <div className="max-w-sm text-sm text-muted-foreground">{description}</div>
      )}
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          {action && <ActionButton variant="primary" action={action} />}
          {secondaryAction && <ActionButton variant="secondary" action={secondaryAction} />}
        </div>
      )}
    </div>
  );
}

function ActionButton({ action, variant }: { action: Action; variant: 'primary' | 'secondary' }) {
  const classes = variant === 'primary'
    ? 'inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90'
    : 'inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition hover:border-primary/30';
  if ('href' in action) {
    return <Link href={action.href} className={classes}>{action.label}</Link>;
  }
  return <button type="button" onClick={action.onClick} className={classes}>{action.label}</button>;
}
