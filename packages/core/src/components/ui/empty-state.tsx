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
 * loud "ERROR / NOTHING HERE" announcement. Airy pass (B-034b §2): no
 * tinted field, no box — an icon in a soft circle, a title, one ink
 * button and one text link, with room around it.
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
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
      {...rest}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-surface-soft text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="text-[15px] font-semibold text-foreground">{title}</div>
      {description && (
        <div className="max-w-sm text-[13px] text-muted-foreground">{description}</div>
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
  // min-h-11 below `sm`: a 44px touch target on phones; desktop stays compact.
  const classes = variant === 'primary'
    ? 'inline-flex min-h-11 items-center rounded-lg bg-action px-3.5 py-1.5 text-[13px] font-medium text-action-foreground transition-colors hover:bg-action/90 sm:min-h-0'
    : 'inline-flex min-h-11 items-center px-1 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:min-h-0';
  if ('href' in action) {
    return <Link href={action.href} className={classes}>{action.label}</Link>;
  }
  return <button type="button" onClick={action.onClick} className={classes}>{action.label}</button>;
}
