'use client';

import { UserButton } from '@clerk/nextjs';
import { BookOpen, CreditCard, HeartPulse, LifeBuoy, Map, Send } from 'lucide-react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { SidebarTrigger } from '@/components/ui/sidebar';

export const AppSidebarHeader = () => (
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
        <UserButton
          userProfileMode="navigation"
          userProfileUrl="/dashboard/user-profile"
          afterSwitchSessionUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: 'px-2 py-1.5',
            },
          }}
        >
          <UserButton.MenuItems>
            <UserButton.Link label="Billing" labelIcon={<CreditCard className="size-4" />} href="/dashboard/billing" />
            <UserButton.Link label="System" labelIcon={<HeartPulse className="size-4" />} href="/dashboard/admin" />
            <UserButton.Link label="Docs" labelIcon={<BookOpen className="size-4" />} href="/dashboard/docs" />
            <UserButton.Link label="Roadmap" labelIcon={<Map className="size-4" />} href="/dashboard/roadmap" />
            <UserButton.Link label="Support" labelIcon={<LifeBuoy className="size-4" />} href="mailto:support@vocion.ai" />
            <UserButton.Link label="Feedback" labelIcon={<Send className="size-4" />} href="mailto:feedback@vocion.ai" />
          </UserButton.MenuItems>
        </UserButton>
      </li>
    </ul>
  </header>
);
