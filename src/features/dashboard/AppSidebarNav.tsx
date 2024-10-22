import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

export const AppSidebarNav = (props: {
  label?: string;
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
  }[];
} & ComponentPropsWithoutRef<typeof SidebarGroup>) => {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        {props.label && (<SidebarGroupLabel>{props.label}</SidebarGroupLabel>)}
        <SidebarMenu>
          {props.items.map(item => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild>
                <Link href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
