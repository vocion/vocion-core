'use client';

import { BookOpen, CreditCard, HeartPulse, LifeBuoy, LogOut, Map, Send, User as UserIcon } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
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
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
      </div>

      <ul className="flex items-center gap-x-1.5">
        <li>
          <ThemeSwitcher />
        </li>
        <li>
          <LocaleSwitcher />
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
                <Link href="/dashboard/billing">
                  <CreditCard className="mr-2 size-4" />
                  Billing
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/admin">
                  <HeartPulse className="mr-2 size-4" />
                  System
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/docs">
                  <BookOpen className="mr-2 size-4" />
                  Docs
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/roadmap">
                  <Map className="mr-2 size-4" />
                  Roadmap
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="mailto:support@vocion.ai">
                  <LifeBuoy className="mr-2 size-4" />
                  Support
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="mailto:feedback@vocion.ai">
                  <Send className="mr-2 size-4" />
                  Feedback
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/account/profile">
                  <UserIcon className="mr-2 size-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/' })}>
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
