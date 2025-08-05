import { UserButton } from '@clerk/nextjs';
import { DarkModeToggle } from '@/components/DarkModeToggle';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SidebarTrigger } from '@/components/ui/sidebar';

export const AppSidebarHeader = () => (
  <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-2">
    <div className="flex items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1" />
    </div>

    <ul className="flex items-center gap-x-1.5">
      <li>
        <DarkModeToggle />
      </li>

      <li>
        <LocaleSwitcher />
      </li>

      <li>
        <UserButton
          userProfileMode="navigation"
          userProfileUrl="/dashboard/user-profile"
          afterSwitchSessionUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'px-2 py-1.5',
            },
          }}
        />
      </li>
    </ul>
  </header>
);
