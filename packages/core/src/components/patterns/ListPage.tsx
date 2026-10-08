import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Tint } from '@/libs/tints';
import { EmptyState } from '@/components/ui/empty-state';
import { HowItsAuthored } from '@/components/ui/how-its-authored';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { Link } from '@/libs/I18nNavigation';
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
 * @param props.tint
 * @param props.authoring - Developer detail, behind "How it's authored".
 * @param props.className
 */
export function ListEmpty(props: {
  variant?: 'page' | 'inline';
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  secondaryAction?: { label: string; href: string } | { label: string; onClick: () => void };
  /** The front-door tint the page mark sits on (the owning app's). */
  tint?: Tint;
  /** Developer detail (paths, manifest keys, commands), behind "How it's authored". */
  authoring?: ReactNode;
  className?: string;
}) {
  if (props.variant === 'inline' || !props.icon) {
    const action = props.action;
    return (
      <div data-pattern="list-empty" className={cn('flex flex-col items-center py-10 text-center text-sm text-muted-foreground', props.className)}>
        <p>{props.title}</p>
        {props.description && <p className="mt-1 text-[13px]">{props.description}</p>}
        {action && ('href' in action
          ? <Link href={action.href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0">{action.label}</Link>
          : <button type="button" onClick={action.onClick} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-foreground underline-offset-4 hover:underline sm:min-h-0">{action.label}</button>)}
        {props.authoring && <HowItsAuthored className="mt-3">{props.authoring}</HowItsAuthored>}
      </div>
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
      tint={props.tint}
      authoring={props.authoring}
      className={props.className}
    />
  );
}
