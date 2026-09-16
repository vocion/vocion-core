import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cn } from '@/utils/Helpers';

/**
 * ListPage — the List archetype's frame: title, one-line description, an
 * optional right slot for the one or two things the page is reached to do,
 * then the list. Nothing here is a box; the toolbar and rows draw their own
 * hairlines. See `docs/design/patterns.md` § List.
 * @param props
 * @param props.title
 * @param props.description
 * @param props.actions - Right slot on the title row. One primary at most.
 * @param props.children - The toolbar and the rows.
 * @param props.className
 */
export function ListPage(props: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-pattern="list-page" className={cn('flex flex-col', props.className)}>
      <TitleBar title={props.title} description={props.description} actions={props.actions} />
      {props.children}
    </div>
  );
}

/**
 * ListEmpty — the two empties a list has. `page` is the whole list empty (an
 * icon in a soft circle, a title, one action); `inline` is "nothing in this
 * lane / no match", one muted line where the rows would be, so the toolbar
 * stays put and the person can change the filter.
 * @param props
 * @param props.variant
 * @param props.icon
 * @param props.title
 * @param props.description
 * @param props.action
 * @param props.secondaryAction
 * @param props.className
 */
export function ListEmpty(props: {
  variant?: 'page' | 'inline';
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  secondaryAction?: { label: string; href: string } | { label: string; onClick: () => void };
  className?: string;
}) {
  if (props.variant === 'inline' || !props.icon) {
    return (
      <p data-pattern="list-empty" className={cn('py-10 text-center text-sm text-muted-foreground', props.className)}>
        {props.title}
        {props.description && <span className="mt-1 block text-[13px]">{props.description}</span>}
      </p>
    );
  }
  return (
    <EmptyState
      data-pattern="list-empty"
      icon={props.icon}
      title={props.title}
      description={props.description}
      action={props.action}
      secondaryAction={props.secondaryAction}
      className={props.className}
    />
  );
}
