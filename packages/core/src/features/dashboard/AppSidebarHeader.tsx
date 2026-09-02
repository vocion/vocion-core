'use client';

import { BookOpen, LogOut, Monitor, Moon, Sun, User as UserIcon, Users as UsersIcon } from 'lucide-react';
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
import { Link } from '@/libs/I18nNavigation';
import { ShellBarActionsOutlet } from './ShellBarActions';

/**
 * The dashboard top bar — consolidated to two quiet controls: the sidebar
 * toggle on the left, one tucked account menu on the right. Theme lives inside
 * the account menu (not a standalone toggle), and page-level actions (chat's
 * New chat / Switch agent) portal into the outlet beside it via
 * ShellBarActions. Fewer, calmer controls — the bar is chrome, so it stays out
 * of the way.
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
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-2">
      <div className="flex items-center gap-2 px-2 sm:px-4">
        <SidebarTrigger className="-ml-1 size-11 sm:size-7" />
      </div>

      <div className="flex items-center gap-x-1.5 pr-1">
        {/* Page-owned controls (e.g. chat's New chat / Switch agent) land here. */}
        <ShellBarActionsOutlet />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex size-11 items-center justify-center rounded-full text-sm font-medium text-muted-foreground transition hover:text-foreground data-[state=open]:text-foreground sm:size-9"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-muted">{initials}</span>
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
