import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { Link } from '@/libs/I18nNavigation';

export const AppSidebarNav = (props: {
  label?: string;
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
    disabled?: boolean;
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
              {item.disabled
                ? (
                    <SidebarMenuButton disabled className="pointer-events-none opacity-40">
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  )
                : (
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
                  )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
