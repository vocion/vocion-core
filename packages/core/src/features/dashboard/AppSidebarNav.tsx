'use client';

import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { isNavItemActive } from '@/features/dashboard/isNavItemActive';
import { NavPendingIcon } from '@/features/dashboard/NavPendingIcon';
import { Link } from '@/libs/I18nNavigation';

export type AppSidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  disabled?: boolean;
};

/**
 * One sidebar nav group. Items light up when active, collapse to an icon rail
 * with tooltips, and — when `onTogglePin` is supplied — grow a hover pin so a
 * user can promote them to the Pinned group.
 * @param props - Group props.
 * @param props.label - Optional group heading (hidden in the icon rail).
 * @param props.items - Nav items.
 * @param props.onTogglePin - Pin/unpin handler; omit to hide the pin action.
 * @param props.isPinned - Predicate telling whether an item is pinned.
 */
export const AppSidebarNav = ({ label, items, onTogglePin, isPinned, ...props }: {
  label?: string;
  items: AppSidebarNavItem[];
  onTogglePin?: (url: string) => void;
  isPinned?: (url: string) => boolean;
} & ComponentPropsWithoutRef<typeof SidebarGroup>) => {
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        {label && (<SidebarGroupLabel>{label}</SidebarGroupLabel>)}
        <SidebarMenu>
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.url);
            const pinned = isPinned?.(item.url) ?? false;
            return (
              <SidebarMenuItem key={item.url}>
                {item.disabled
                  ? (
                      <SidebarMenuButton disabled tooltip={item.title} className="pointer-events-none opacity-40">
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    )
                  : (
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
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
                                <NavPendingIcon icon={item.icon} />
                                <span>{item.title}</span>
                              </Link>
                            )}
                      </SidebarMenuButton>
                    )}
                {onTogglePin && !item.disabled && (
                  <SidebarMenuAction
                    showOnHover={!pinned}
                    onClick={() => onTogglePin(item.url)}
                    aria-label={pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    className={pinned ? 'text-sidebar-foreground/60' : ''}
                  >
                    {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                  </SidebarMenuAction>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
