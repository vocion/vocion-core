'use client';

import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { Link } from '@/libs/I18nNavigation';

/**
 * Collapsible variant of `AppSidebarNav` — the group label becomes a
 * toggle (shadcn sidebar Collapsible pattern). Used by the Organization
 * group; reusable for any section that earns sub-navigation.
 */
export const AppSidebarNavGroup = (props: {
  label: string;
  defaultOpen?: boolean;
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
  }[];
}) => {
  const { toggleSidebar, isMobile } = useSidebar();

  return (
    <Collapsible defaultOpen={props.defaultOpen ?? true} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="w-full">
            {props.label}
            <ChevronRight className="ml-auto size-3.5 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
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
                    {/* External URLs (e.g. the public docs site) bypass the
                        locale-aware Link, which would prefix them. */}
                    {item.url.startsWith('http')
                      ? (
                          <a href={item.url} target="_blank" rel="noreferrer">
                            <item.icon />
                            <span>{item.title}</span>
                          </a>
                        )
                      : (
                          <Link href={item.url}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
};
