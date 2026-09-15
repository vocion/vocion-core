'use client';

import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { isNavItemActive } from '@/features/dashboard/isNavItemActive';
import { NavPendingIcon } from '@/features/dashboard/NavPendingIcon';
import { Link } from '@/libs/I18nNavigation';

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** A live count (e.g. "Needs you"). Omitted or 0 renders nothing. */
  badge?: number;
};

/**
 * A flat sidebar group. Airy pass (B-034b §3): rows are h-9, 13px, icons
 * stroke 1.5; the active item is a quiet grey pill (tokens), and every row
 * carries a tooltip so the collapsed icon rail stays legible.
 * @param props
 * @param props.label
 * @param props.items
 */
export const AppSidebarNav = (props: {
  label?: string;
  items: SidebarNavItem[];
} & ComponentPropsWithoutRef<typeof SidebarGroup>) => {
  const { label, items, ...rest } = props;
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();

  return (
    <SidebarGroup {...rest}>
      <SidebarGroupContent>
        {label && (<SidebarGroupLabel>{label}</SidebarGroupLabel>)}
        <SidebarMenu>
          {items.map(item => (
            <SidebarMenuItem key={item.title}>
              {item.disabled
                ? (
                    <SidebarMenuButton disabled className="pointer-events-none opacity-40" tooltip={item.title}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  )
                : (
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={isNavItemActive(pathname, item.url)}
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
              {item.badge ? (
                <SidebarMenuBadge className="rounded-full bg-brand-amber/12 px-1.5 text-[11px] font-medium text-brand-amber-deep">
                  {item.badge > 99 ? '99+' : item.badge}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
