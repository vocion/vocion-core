'use client';

import { BookOpen, LogOut, Monitor, Moon, Search, Sparkles, Sun, User as UserIcon, Users as UsersIcon } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
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
import { Breadcrumb } from '@/features/dashboard/Breadcrumb';
import { AgentSurfaceButton } from '@/features/dashboard/chat/AgentSurfaceButton';
import { openCommandPalette } from '@/features/dashboard/commandPaletteEvent';
import { FeedbackButton } from '@/features/dashboard/FeedbackButton';
import { Link } from '@/libs/I18nNavigation';
import { workspaceUrl } from '@/libs/links';
import { ShellBarActionsOutlet } from './ShellBarActions';

/**
 * The dashboard top bar. Airy pass (B-034b §3): 60px tall; sidebar toggle,
 * workspace chip and breadcrumb on the left; on the right a soft-grey search
 * field that opens the ⌘K palette, then Feedback / Docs / Ask as quiet pills,
 * the page-owned outlet (chat's New chat / Switch agent) and one account menu.
 * Theme and the © attribution live inside the account menu — the bar is
 * chrome, so it stays out of the way.
 *
 * `workspace` names the active project beside the trigger as a small chip:
 * its slug, linking to the workspace's own URL (`/w/<slug>`), so the answer to
 * "which workspace am I looking at" is on screen and copyable. Absent, nothing
 * renders (no project resolved).
 * @param props - Component props.
 * @param props.workspace - Active project's slug and name, or null.
 */
export const AppSidebarHeader = ({ workspace = null }: { workspace?: { slug: string; name: string } | null }) => {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const t = useTranslations('ThemeSwitcher');
  const tl = useTranslations('DashboardLayout');
  const user = session?.user;
  const initials = user?.name
    ?.split(' ')
    .map(p => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';
  const attribution = process.env.NEXT_PUBLIC_BRAND_ATTRIBUTION || 'Vocion · Apache 2.0';

  return (
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background px-3 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 size-11 text-muted-foreground sm:size-8" />
        {workspace && (
          <a
            href={workspaceUrl(workspace.slug, '/dashboard')}
            title={`${workspace.name} — copy this link to open this workspace`}
            data-testid="workspace-chip"
            className="hidden max-w-48 truncate rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:text-foreground sm:inline-block"
          >
            {workspace.slug}
          </a>
        )}
        <Breadcrumb />
      </div>

      <div className="flex items-center gap-x-1 pr-0.5">
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label={tl('search_hint')}
          className="hidden h-9 w-56 items-center gap-2 rounded-lg bg-surface-soft px-3 text-[13px] text-muted-foreground/70 transition-colors hover:bg-surface-hover hover:text-muted-foreground lg:flex"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 text-left">{tl('search_hint')}</span>
          <kbd className="rounded border border-border/70 bg-background px-1 font-sans text-[10px] text-muted-foreground/70">⌘K</kbd>
        </button>

        {/* Page-owned controls (e.g. chat's New chat / Switch agent) land here. */}
        <ShellBarActionsOutlet />

        <FeedbackButton />

        <a
          href="https://www.vocion.ai/docs"
          target="_blank"
          rel="noreferrer"
          className="hidden h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground md:inline-flex"
        >
          <BookOpen className="size-4" aria-hidden />
          {tl('docs')}
        </a>

        {/* The titlebar entry point — one function, whichever surface the
            page carries (agent-chat-surface.md §6). Amber sparkle only. */}
        <span className="[&_button]:text-brand-amber-deep [&_button:hover]:bg-surface-hover">
          <AgentSurfaceButton />
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="ml-1 flex size-11 items-center justify-center rounded-full text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground sm:size-9"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-soft text-[12px]">{initials}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 shadow-(--shadow-pop)">
            <DropdownMenuLabel className="flex flex-col">
              <span className="font-medium">{user?.name ?? 'Account'}</span>
              <span className="text-xs text-muted-foreground">{user?.email}</span>
            </DropdownMenuLabel>
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
            <DropdownMenuItem asChild>
              <Link href="/dashboard/chat">
                <Sparkles className="mr-2 size-4" />
                {tl('chat')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/sign-in' })}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
      </div>
    </header>
  );
};
