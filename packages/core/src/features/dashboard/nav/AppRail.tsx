'use client';

import type { AppSummary } from '@/features/navigation/apps';
import { Plus } from 'lucide-react';
import { LetterTile } from '@/components/ui/letter-tile';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { iconByName } from '@/features/dashboard/iconByName';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/** One app in the rail: an app this workspace has. */
export type RailApp = AppSummary & {
  /** Where picking it lands in this workspace. */
  href: string;
};

// Each app wears its tint (front doors, `libs/tints.ts`): a tinted tile with
// the app's icon, the same mark the app's nav header and the marketplace draw.
// The active app gets a ring, not a second colour.
const RAIL_BUTTON = 'grid size-10 place-items-center rounded-xl outline-hidden transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent';

/**
 * The app rail — the dashboard's far-left column (Vocion 5.0). THIS
 * workspace's apps: the core app (Workforce) first, then the others it has,
 * in manifest order, then "Add app", which opens Apps, where a plugin — and
 * with it its app — is turned on.
 *
 * Workspace first (founder, 2026-10-23: "I constantly find myself on the
 * wrong app inside of the Finance team"): picking an app always stays in
 * this workspace, and an app only another workspace has is not here at all;
 * the switcher lists every workspace with its apps. Each icon is a link, so
 * it also works as one. The rail stays in
 * the icon rail when the sidebar collapses: every icon has an accessible name
 * and a tooltip (hover or keyboard focus only). It carries no logo — the Org's
 * mark is the switcher's, once — and a phone has no rail at all: the drawer
 * lists the apps as rows (founder, 2026-10-08).
 * @param props - The rail's inputs.
 * @param props.apps - The apps to show, in rail order.
 * @param props.activeId - The app the sidebar is showing.
 * @param props.onPick - Called with the app a person picked.
 * @param props.label - Accessible name of the rail.
 * @param props.addLabel - The "Add app" label.
 * @param props.addHref - Where "Add app" goes.
 */
export function AppRail(props: {
  apps: readonly RailApp[];
  activeId: string | undefined;
  onPick: (app: RailApp) => void;
  label: string;
  addLabel: string;
  addHref: string;
}) {
  return (
    <nav aria-label={props.label} data-testid="app-rail" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border pt-4 pb-5">
      {props.apps.map((app) => {
        const Icon = iconByName(app.icon);
        const active = app.id === props.activeId;
        return (
          <Tooltip key={app.id}>
            <TooltipTrigger asChild>
              <Link
                href={app.href}
                aria-label={app.name}
                aria-current={active ? 'page' : undefined}
                data-active={active}
                data-app={app.id}
                onClick={() => props.onPick(app)}
                className={RAIL_BUTTON}
              >
                <LetterTile name={app.name} icon={Icon} tint={app.tint} size="sm" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" collisionPadding={8}>{app.name}</TooltipContent>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={props.addHref} aria-label={props.addLabel} className={cn(RAIL_BUTTON, 'mt-1')}>
            <LetterTile name={props.addLabel} icon={Plus} size="sm" muted />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" collisionPadding={8}>{props.addLabel}</TooltipContent>
      </Tooltip>
    </nav>
  );
}
