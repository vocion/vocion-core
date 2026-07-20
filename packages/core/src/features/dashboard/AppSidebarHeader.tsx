'use client';

import { BookOpen, LogOut, User as UserIcon, Users as UsersIcon } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Link } from '@/libs/I18nNavigation';

export const AppSidebarHeader = () => {
  const { data: session } = useSession();
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

      <ul className="flex items-center gap-x-1.5">
        <li>
          <ThemeSwitcher />
        </li>
        <li>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium hover:bg-muted/80">
              {initials}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex flex-col">
                <span className="font-medium">{user?.name ?? 'Account'}</span>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
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
        </li>
      </ul>
    </header>
  );
};
