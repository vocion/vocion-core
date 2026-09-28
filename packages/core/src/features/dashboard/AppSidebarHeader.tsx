'use client';

import { ArrowLeftRight, Bell, LogOut, MessageSquareText, Monitor, Moon, Pause, Search, Settings2, Sun, User as UserIcon, Users as UsersIcon } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { Suspense, useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Breadcrumb } from '@/features/dashboard/Breadcrumb';
import { AgentSurfaceButton } from '@/features/dashboard/chat/AgentSurfaceButton';
import { openCommandPalette } from '@/features/dashboard/commandPaletteEvent';
import { FeedbackDialog } from '@/features/dashboard/FeedbackButton';
import { shouldTriggerFindHotkey } from '@/features/dashboard/nav/workspaceSwitch';
import { openWorkspaceSwitcher } from '@/features/dashboard/nav/WorkspaceSwitcher';
import { openManageView } from '@/features/dashboard/useNavView';
import { WorkspacePauseDialog } from '@/features/dashboard/WorkspaceOffSwitch';
import { envLabel as readEnvLabel } from '@/libs/envLabel';
import { Link } from '@/libs/I18nNavigation';
import { buildInfo, versionLabel } from '@/libs/version';
import { NavigationProgress } from './NavigationProgress';
import { ShellBarActionsOutlet } from './ShellBarActions';

/**
 * The dashboard top bar (ElevenLabs pattern, Chris 2026-09-15): breadcrumb
 * left, starting with the workspace name; a search-shaped "Search everything
 * ⌘K" field centred (opens the palette; a bare `F` does too); on the right
 * Ask · a reserved notifications bell · the account avatar (Feedback and Docs
 * moved off the bar on 2026-09-18 — into this menu and the Manage view),
 * which wears a thin ring showing this workspace's budget used when a budget
 * exists. The avatar menu leads with that spend and the current workspace
 * (⇄ opens the sidebar switcher), then theme, profile, members, sign out and
 * the © attribution. Page-owned controls still portal in via ShellBarActions.
 * @param props
 * @param props.workspace - Active project's slug and name, or null.
 * @param props.usage - This workspace's spend this period vs its hard cap (cents), when budgets exist.
 * @param props.canPauseWorkspace - Show the off switch: an admin, on a workspace that is running. A paused one is owned by the banner instead.
 */
export const AppSidebarHeader = ({ workspace = null, usage = null, canPauseWorkspace = false }: {
  workspace?: { slug: string; name: string } | null;
  usage?: { spentCents: number; capCents: number | null } | null;
  canPauseWorkspace?: boolean;
}) => {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const t = useTranslations('ThemeSwitcher');
  const tl = useTranslations('DashboardLayout');
  const user = session?.user;
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const initials = user?.name
    ?.split(' ')
    .map(p => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';
  const attribution = process.env.NEXT_PUBLIC_BRAND_ATTRIBUTION || 'Vocion · Apache 2.0';
  const build = buildInfo();

  // Bare `F` opens search when nothing is being typed (Vercel/ElevenLabs).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (shouldTriggerFindHotkey({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, defaultPrevented: e.defaultPrevented, target: e.target as HTMLElement | null })) {
        e.preventDefault();
        openCommandPalette();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // `NEXT_PUBLIC_ENV_LABEL` is inlined at build time, so production ships
  // this as a literal null and the branch disappears entirely.
  const envLabel = readEnvLabel();
  const pct = usage && usage.capCents && usage.capCents > 0 ? Math.min(100, Math.round((usage.spentCents / usage.capCents) * 100)) : null;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    // FLEX below md, grid at md and up — and that difference is a bug fix, not
    // a preference. The centre search is `hidden md:flex`, and a `display:none`
    // element is not a grid item at all: below md the grid had three tracks and
    // two items, so auto-placement put the ACTIONS in the middle `auto` track
    // and left the trailing `1fr` empty. On a phone that drew the whole right
    // group — pause, chat, avatar — ending around the middle of the bar with a
    // third of the width blank beside it (Chris, 2026-09-22: "mobile header and
    // nav still misaligned"). Flex has no tracks to mis-place into: left group,
    // right group, edge to edge, whatever is hidden between them.
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 md:grid md:grid-cols-[1fr_minmax(0,auto)_1fr] lg:px-6">
      {/* The one page-loading signal, along the top edge of every page
          (backlog 013). Suspense because it reads the query string. */}
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 size-11 text-muted-foreground sm:size-8" />
        {/* WHICH INSTANCE THIS IS. The favicon and the page title already say
            it, and neither survives a screenshot: a phone screenshot crops
            the tab strip away entirely, so a preview screenshot and a
            production screenshot were indistinguishable — which is how a dev
            screen gets filed as a production bug, and how the reverse
            happens, which is worse. It sits BEFORE the breadcrumb because it
            qualifies everything after it, and it is absent in production, so
            the presence of a badge always means something. */}
        {envLabel !== null && (
          <span
            data-testid="env-badge"
            aria-label={`This is the ${envLabel} instance, not production`}
            className="shrink-0 rounded-md bg-amber-500 px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold tracking-wide text-white uppercase"
          >
            {envLabel}
          </span>
        )}
        <Breadcrumb workspaceName={workspace?.name ?? null} />
      </div>

      {/* Centre: the one search field. A bordered field with the ⌘K hint
          inside it — as a borderless chip it read as an orphaned label
          floating in the bar rather than something you click into. */}
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label={tl('search_everything')}
        className="hidden h-9 w-full max-w-[22rem] min-w-40 items-center gap-2 rounded-lg border border-border/70 bg-surface-soft px-3 text-[13px] text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:outline-none md:flex"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{tl('search_everything')}</span>
        <kbd className="shrink-0 rounded border border-border/70 bg-background px-1 font-sans text-[10px] text-muted-foreground/70">⌘K</kbd>
      </button>

      <div className="flex items-center justify-end gap-x-1 pr-0.5">
        {/* Page-owned controls (e.g. chat's New chat / Switch agent) land here. */}
        <ShellBarActionsOutlet />

        {/* Feedback and Docs left the bar on 2026-09-18 (Chris: "clean up this
            main header"): Feedback is a row in the account menu below, Docs
            is a row in the Manage workspace view of the sidebar. */}
        {/* The titlebar entry point — one function, whichever surface the
            page carries (agent-chat-surface.md §6). Amber sparkle only. */}
        <span className="[&_button]:text-brand-amber-deep [&_button:hover]:bg-surface-hover">
          <AgentSurfaceButton />
        </span>

        {/* Reserved: notifications. No behaviour yet — the slot keeps the layout stable when it arrives. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={tl('notifications')} disabled className="hidden size-9 items-center justify-center rounded-full text-muted-foreground/50 sm:flex">
              <Bell className="size-4" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tl('notifications_soon')}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="ml-1 flex size-11 items-center justify-center rounded-full text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground sm:size-9"
          >
            <span className="relative flex size-8 items-center justify-center">
              {pct !== null && (
                // Thin ring = % of this workspace's budget used this period.
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 32 32" aria-hidden>
                  <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="2" />
                  <circle cx="16" cy="16" r="15" fill="none" stroke={pct >= 90 ? 'var(--brand-fail)' : 'var(--brand-amber)'} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 94.2} 94.2`} />
                </svg>
              )}
              <span className="flex size-7 items-center justify-center rounded-full bg-surface-soft text-[12px]">{initials}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 shadow-(--shadow-pop)">
            <DropdownMenuLabel className="flex flex-col">
              <span className="font-medium">{user?.name ?? 'Account'}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {usage && (usage.capCents || usage.spentCents > 0) && (
              <div className="px-2 py-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">{tl('usage_this_period')}</span>
                  <span className="font-medium tabular-nums">
                    {dollars(usage.spentCents)}
                    {usage.capCents ? ` / ${dollars(usage.capCents)}` : ''}
                  </span>
                </div>
                {pct !== null && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--brand-fail)' : 'var(--brand-amber)' }} />
                  </div>
                )}
              </div>
            )}

            {/* Everything configurational — teams, agents, connectors, members,
                tokens — lives in the sidebar's manage view. This is one of its
                three doors (the sidebar row is the primary one). */}
            <DropdownMenuItem onClick={openManageView}>
              <Settings2 className="mr-2 size-4 text-muted-foreground" aria-hidden />
              {tl('workspace_settings')}
            </DropdownMenuItem>

            {workspace && (
              <DropdownMenuItem onClick={openWorkspaceSwitcher} className="justify-between">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{tl('current_workspace')}</span>
                  {' '}
                  <span className="font-medium">{workspace.name}</span>
                </span>
                <ArrowLeftRight className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sun className="mr-2 size-4 dark:hidden" />
                <Moon className="mr-2 hidden size-4 dark:block" />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="mr-2 size-4" />
                    {t('theme_light_label')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="mr-2 size-4" />
                    {t('theme_dark_label')}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Monitor className="mr-2 size-4" />
                    {t('theme_system_label')}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/profile">
                <UserIcon className="mr-2 size-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/members">
                <UsersIcon className="mr-2 size-4" />
                Members
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>
              <MessageSquareText className="mr-2 size-4 text-muted-foreground" aria-hidden />
              Send feedback
            </DropdownMenuItem>
            {/* The stop. It was a labelled button on the bar; on a phone that
                put the widest word up there beside the workspace name, where
                it read as something about the page rather than about the
                workspace. It is a decision about the workspace, so it sits
                with the workspace — and when it has been pulled, the banner
                across every page is the loud half. */}
            {canPauseWorkspace && (
              <DropdownMenuItem onSelect={() => setPauseOpen(true)} data-testid="workspace-pause">
                <Pause className="mr-2 size-4 text-muted-foreground" aria-hidden />
                Pause workspace
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/sign-in' })}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* WHAT IS RUNNING.
                "Is my fix deployed?" was answered by SSHing to the box and
                reading a submodule pin out of a deploy repo — by hand, and
                twice wrongly, which sent two fixes chasing a bug that was
                already fixed but not shipped. The build knows this; now so
                does anyone who opens this menu. The title carries the commit
                subject and build time, and /version.txt serves the same stamp
                without a login. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="/version.txt"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="build-version"
                  className="block px-2 py-1.5 font-mono text-[11px] text-muted-foreground/70 transition hover:text-foreground"
                >
                  {versionLabel(build)}
                </a>
              </TooltipTrigger>
              <TooltipContent side="left" collisionPadding={8} className="max-w-72 text-left whitespace-pre-line">
                {`${build.subject}\ncommit ${build.commit}\nbranch ${build.branch}\nbuilt ${build.builtAt}`}
              </TooltipContent>
            </Tooltip>
            {/* Deployments override via NEXT_PUBLIC_BRAND_ATTRIBUTION (same
                pattern as the NEXT_PUBLIC_BRAND_* logo vars). */}
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70">
              ©
              {' '}
              {new Date().getFullYear()}
              {' '}
              {attribution}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        <WorkspacePauseDialog open={pauseOpen} onOpenChange={setPauseOpen} />
      </div>
    </header>
  );
};
