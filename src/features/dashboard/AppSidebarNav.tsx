import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import Link from 'next/link';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';

export const AppSidebarNav = (props: {
  label?: string;
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
  }[];
} & ComponentPropsWithoutRef<typeof SidebarGroup>) => {
  const { toggleSidebar, isMobile } = useSidebar();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        {props.label && (<SidebarGroupLabel>{props.label}</SidebarGroupLabel>)}
        <SidebarMenu>
          {props.items.map(item => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                onClick={() => {
                  if (isMobile) {
                    toggleSidebar();
                  }
                }}
              >
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
