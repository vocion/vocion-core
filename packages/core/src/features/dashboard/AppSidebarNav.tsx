'use client';

import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { PendingIcon } from '@/components/patterns/PendingIcon';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { isNavItemActive } from '@/features/dashboard/isNavItemActive';
import { Link, usePathname } from '@/libs/I18nNavigation';

const formatBadge = (n: number) => (n > 99 ? '99+' : String(n));

export type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** A live count (e.g. "Review queue"). Omitted or 0 renders nothing. */
  badge?: number;
  /** Sits under the group's "More ›" row however few rows there are (a route a plugin offers but does not own). */
  secondary?: boolean;
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
  /** The "More ›" row's label, when any item is `secondary`. */
  moreLabel?: string;
} & ComponentPropsWithoutRef<typeof SidebarGroup>) => {
  const { label, items: allItems, moreLabel, ...rest } = props;
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();
  const items = allItems.filter(i => !i.secondary);
  const more = allItems.filter(i => i.secondary);

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
                              <PendingIcon icon={item.icon} />
                              <span>{item.title}</span>
                            </Link>
                          )}
                    </SidebarMenuButton>
                  )}
              {item.badge
                ? (
                    <SidebarMenuBadge className="rounded-full bg-brand-amber/12 px-1.5 text-[11px] font-medium text-brand-amber-deep">
                      {formatBadge(item.badge)}
                    </SidebarMenuBadge>
                  )
                : null}
            </SidebarMenuItem>
          ))}

          {/* Secondary rows live under one "More ›" row — the same submenu
              the pinnable groups use, without the pin control. Drops below
              the trigger on a phone, where the sheet already fills the screen. */}
          {more.length > 0 && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton tooltip={moreLabel ?? 'More'} className="text-muted-foreground">
                    <ChevronRight />
                    <span>{moreLabel ?? 'More'}</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side={isMobile ? 'bottom' : 'right'}
                  align="start"
                  collisionPadding={12}
                  className="w-[min(16rem,calc(100vw-2rem))] shadow-(--shadow-pop)"
                >
                  {more.map(item => (
                    <DropdownMenuItem key={item.url} asChild className="flex items-center gap-2">
                      <Link href={item.url} className="flex min-w-0 flex-1 items-center gap-2">
                        <item.icon className="size-4 text-muted-foreground" aria-hidden />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};
