'use client';

import { BookOpen, LogOut, Monitor, Moon, Search, Sun, User as UserIcon, Users as UsersIcon } from 'lucide-react';
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
import { AppBreadcrumb } from '@/features/dashboard/AppBreadcrumb';
import { AgentSurfaceButton } from '@/features/dashboard/chat/AgentSurfaceButton';
import { openCommandPalette } from '@/features/dashboard/commandPaletteEvent';
import { FeedbackButton } from '@/features/dashboard/FeedbackButton';
import { Link } from '@/libs/I18nNavigation';
import { ShellBarActionsOutlet } from './ShellBarActions';

/**
 * The dashboard top bar. Left: sidebar toggle + a breadcrumb that says where
 * you are. Right: search (⌘K palette), Feedback, Docs, the page's own
 * portalled controls, the Ask button (⌘J), and one tucked account menu with
 * the theme inside it. Everything is quiet, text-sized and hairline-bordered —
 * the bar is chrome, so it stays out of the way, but it now answers "where am
 * I" and "how do I find X" without a trip to the sidebar.
 */
export const AppSidebarHeader = () => {
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();
  const t = useTranslations('ThemeSwitcher');
  const user = session?.user;
  const initials = user?.name
    ?.split(' ')
    .map(p => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2 sm:px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <SidebarTrigger className="-ml-0.5 size-9 text-muted-foreground sm:size-8" />
        <AppBreadcrumb />
      </div>

      <div className="flex items-center gap-x-1 pr-1">
        {/* Search everything — opens the ⌘K palette. Reads as an input on wide
            screens, collapses to an icon below md. */}
        <button
          type="button"
          onClick={openCommandPalette}
          aria-label="Search (⌘K)"
          className="inline-flex h-8 items-center gap-2 rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground max-md:size-9 max-md:justify-center md:w-56 md:border md:border-border md:bg-background md:px-2.5 md:hover:bg-background"
        >
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden flex-1 text-left text-[13px] md:inline">Search everything…</span>
          <kbd className="hidden rounded border border-border bg-muted px-1 font-sans text-[10px] text-muted-foreground lg:inline">⌘K</kbd>
        </button>

        <FeedbackButton />

        <a
          href="https://www.vocion.ai/docs"
          target="_blank"
          rel="noreferrer"
          className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground md:inline-flex"
        >
          <BookOpen className="size-4" aria-hidden />
          Docs
        </a>

        {/* Page-owned controls (e.g. chat's New chat / Switch agent) land here. */}
        <ShellBarActionsOutlet />

        {/* The titlebar entry point — one function, whichever surface the
            page carries (agent-chat-surface.md §6). */}
        <AgentSurfaceButton />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="ml-1 flex size-9 items-center justify-center rounded-full text-sm font-medium text-muted-foreground transition hover:text-foreground data-[state=open]:text-foreground"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs">{initials}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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
              <a href="https://www.vocion.ai/docs" target="_blank" rel="noreferrer">
                <BookOpen className="mr-2 size-4" />
                Docs
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/sign-in' })}>
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
