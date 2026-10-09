'use client';

import type { AppSummary } from '@/features/navigation/apps';
import { Plus } from 'lucide-react';
import { LetterTile } from '@/components/ui/letter-tile';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/useSidebar';
import { iconByName } from '@/features/dashboard/iconByName';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/** One app in the rail: installed in this workspace (`href` set) or only in another one. */
export type RailApp = AppSummary & {
  /** Where picking it lands in this workspace; absent when this workspace does not have it. */
  href?: string;
};

// Each app wears its tint (front doors, `libs/tints.ts`): a tinted tile with
// the app's icon, the same mark the app's nav header and the marketplace draw.
// The active app gets a ring, not a second colour.
const RAIL_BUTTON = 'grid size-10 place-items-center rounded-xl outline-hidden transition-colors hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent';

/**
 * The app rail — the dashboard's far-left column (Vocion 5.0). The core app
 * (Workforce) first, then every other app the person has in some workspace,
 * in manifest order, then "Add app", which opens Apps, where a
 * plugin — and with it its app — is turned on.
 *
 * Picking an app this workspace has opens it (a link, so it also works as
 * one); picking one only another workspace has shows that app's nav with its
 * workspace picker, so the person chooses where to open it. The rail stays in
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
 * @param props.elsewhereLabel - Tooltip suffix for an app this workspace does not have.
 */
export function AppRail(props: {
  apps: readonly RailApp[];
  activeId: string | undefined;
  onPick: (app: RailApp) => void;
  label: string;
  addLabel: string;
  addHref: string;
  elsewhereLabel: string;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeSheet = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <nav aria-label={props.label} data-testid="app-rail" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border pt-4 pb-5">
      {props.apps.map((app) => {
        const Icon = iconByName(app.icon);
        const active = app.id === props.activeId;
        const tooltip = app.href ? app.name : `${app.name} · ${props.elsewhereLabel}`;
        return (
          <Tooltip key={app.id}>
            <TooltipTrigger asChild>
              {app.href
                ? (
                    <Link
                      href={app.href}
                      aria-label={app.name}
                      aria-current={active ? 'page' : undefined}
                      data-active={active}
                      data-app={app.id}
                      onClick={() => {
                        props.onPick(app);
                        closeSheet();
                      }}
                      className={RAIL_BUTTON}
                    >
                      <LetterTile name={app.name} icon={Icon} tint={app.tint} size="sm" />
                    </Link>
                  )
                : (
                    <button
                      type="button"
                      aria-label={tooltip}
                      aria-pressed={active}
                      data-active={active}
                      data-app={app.id}
                      onClick={() => props.onPick(app)}
                      className={RAIL_BUTTON}
                    >
                      {/* Only in another workspace: the mark without its tint, so "here" and "elsewhere" read apart. */}
                      <LetterTile name={app.name} icon={Icon} size="sm" className="text-muted-foreground" />
                    </button>
                  )}
            </TooltipTrigger>
            <TooltipContent side="right" collisionPadding={8}>{tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={props.addHref} aria-label={props.addLabel} onClick={closeSheet} className={cn(RAIL_BUTTON, 'mt-1')}>
            <LetterTile name={props.addLabel} icon={Plus} size="sm" muted />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" collisionPadding={8}>{props.addLabel}</TooltipContent>
      </Tooltip>
    </nav>
  );
}
