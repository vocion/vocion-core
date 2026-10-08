import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import type { Tint } from '@/libs/tints';
import { ArrowRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { LetterTile } from './letter-tile';

/**
 * EmptyState — the one canonical empty state: a page with nothing in it yet
 * is a front door (`docs/design/patterns.md` § Front doors), so it has the
 * `CatalogCard` anatomy — a mark, a title, ONE sentence saying what this
 * place is for, and ONE action that starts it, as an arrow link. A quiet
 * second link (the docs) is allowed; a second button is not.
 *
 * Keep the polished custom empties in ChatShell + ReviewQueue as-is —
 * those have their own affordances (suggestion chips, queue-clear copy).
 *
 * Low-key on purpose: "the right place; you just haven't started yet", not
 * "ERROR / NOTHING HERE". No box — it sits in whatever surface it is in, so
 * it can never be a box in a box. `tint` puts the mark on a front-door tint
 * (an app's own colour, when the empty page belongs to one).
 */

type Action
  = | { label: string; href: string }
    | { label: string; onClick: () => void };

type Props = ComponentProps<'div'> & {
  icon: LucideIcon;
  title: string;
  /** One sentence: what this place is for, or what starts it. */
  description?: ReactNode;
  /** The one action — either internal link (href) or click handler. */
  action?: Action;
  /** Optional quiet link (e.g. "Read the docs"). */
  secondaryAction?: Action;
  /** The tint the mark sits on. Default: the soft surface. */
  tint?: Tint;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tint,
  className,
  ...rest
}: Props) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'mx-auto flex max-w-md flex-col items-center px-6 py-14 text-center',
        className,
      )}
      {...rest}
    >
      {tint
        ? <LetterTile name={title} icon={Icon} tint={tint} size="lg" />
        : (
            <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-xl bg-surface-soft text-muted-foreground">
              <Icon className="size-5" aria-hidden />
            </span>
          )}
      <div className="mt-4 text-[15px] font-semibold text-foreground">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{description}</div>
      )}
      {(action || secondaryAction) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          {action && <ActionLink variant="primary" action={action} />}
          {secondaryAction && <ActionLink variant="secondary" action={secondaryAction} />}
        </div>
      )}
    </div>
  );
}

function ActionLink({ action, variant }: { action: Action; variant: 'primary' | 'secondary' }) {
  // min-h-11 below `sm`: a 44px touch target on phones; desktop stays compact.
  const classes = variant === 'primary'
    ? 'group inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0'
    : 'inline-flex min-h-11 items-center text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-0';
  const body = (
    <>
      {action.label}
      {variant === 'primary' && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  if ('href' in action) {
    return <Link href={action.href} className={classes}>{body}</Link>;
  }
  return <button type="button" onClick={action.onClick} className={classes}>{body}</button>;
}
