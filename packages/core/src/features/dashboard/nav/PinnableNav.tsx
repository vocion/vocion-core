'use client';

import type { PinnableItem } from './navPins';
import { ChevronRight, GripVertical, Pin, PinOff } from 'lucide-react';

import { useRef, useState } from 'react';
import { PendingIcon } from '@/components/patterns/PendingIcon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { isNavItemActive } from '@/features/dashboard/isNavItemActive';
import { Link, usePathname } from '@/libs/I18nNavigation';
import { splitOverflow } from './navPins';

const formatBadge = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * A sidebar group whose rows can be pinned (ElevenLabs pattern, Chris
 * 2026-09-15): hovering a row reveals one pin/unpin icon; nothing else to
 * configure. Past `max` rows, a "More … ›" row opens a submenu listing the
 * rest, each with the same pin affordance. In the Pinned group, rows can be
 * dragged to reorder (HTML5 drag, no dependency). An item with `tabs` (a
 * combined page) reveals them as sub-rows while that page is open, so each
 * tab keeps its own pin — one row in the section otherwise.
 *
 * No pin icon sits on a row by default (founder, 2026-10-08: the phone
 * drawer was "overstuffed"). On a desktop it shows on hover or keyboard
 * focus; on a phone, where there is no hover, a long press on the row opens
 * a small menu with Pin / Unpin. A group may have no label: the main list
 * reads as the drawer's own list, not a section.
 * @param props
 * @param props.label
 * @param props.items
 * @param props.pins
 * @param props.onTogglePin
 * @param props.onMovePin
 * @param props.max
 * @param props.moreLabel
 * @param props.pinLabel
 * @param props.unpinLabel
 * @param props.reorderable
 */
export function PinnableNav(props: {
  label?: string;
  items: PinnableItem[];
  pins: string[];
  onTogglePin: (url: string) => void;
  onMovePin?: (url: string, toIndex: number) => void;
  max?: number;
  moreLabel: string;
  pinLabel: string;
  unpinLabel: string;
  reorderable?: boolean;
}) {
  // `isMobile` comes from the sidebar's own context: at this width the
  // sidebar IS a sheet, which is exactly when a flyout has nowhere to fly to.
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();
  const [dragging, setDragging] = useState<string | null>(null);
  // Phone: a long press on a row opens its pin menu, and the tap that ends it does not navigate.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const pressHandlers = (url: string) => (isMobile
    ? {
        onPointerDown: () => {
          longPressed.current = false;
          cancelPress();
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            setMenuFor(url);
          }, 500);
        },
        onPointerUp: cancelPress,
        onPointerLeave: cancelPress,
        onPointerCancel: cancelPress,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {});
  const { shown, more } = splitOverflow(props.items, props.max ?? 7);

  if (props.items.length === 0) {
    return null;
  }

  const dropOn = (url: string, index: number) => {
    if (dragging && dragging !== url) {
      props.onMovePin?.(dragging, index);
    }
    setDragging(null);
  };
  const pinIcon = (url: string) => (props.pins.includes(url) ? <PinOff /> : <Pin />);
  const pinTitle = (url: string) => (props.pins.includes(url) ? props.unpinLabel : props.pinLabel);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {props.label && <SidebarGroupLabel>{props.label}</SidebarGroupLabel>}
        <SidebarMenu>
          {shown.map((item, index) => (
            <SidebarMenuItem
              key={item.url}
              draggable={props.reorderable}
              onDragStart={props.reorderable ? () => setDragging(item.url) : undefined}
              onDragOver={props.reorderable ? e => e.preventDefault() : undefined}
              onDrop={props.reorderable ? () => dropOn(item.url, index) : undefined}
              onDragEnd={props.reorderable ? () => setDragging(null) : undefined}
              className={dragging === item.url
                ? 'opacity-50'
                : undefined}
            >
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={isNavItemActive(pathname, item.url)}
                onClick={(e) => {
                  if (longPressed.current) {
                    e.preventDefault();
                    longPressed.current = false;
                    return;
                  }
                  if (isMobile) {
                    toggleSidebar();
                  }
                }}
                {...(item.pinnable !== false ? pressHandlers(item.url) : {})}
              >
                <Link href={item.url} className="[-webkit-touch-callout:none]">
                  {props.reorderable
                    ? <GripVertical className="hidden text-muted-foreground/40 group-hover/menu-item:block" aria-hidden />
                    : null}
                  <PendingIcon icon={item.icon} />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
              {item.badge
                ? (
                    <SidebarMenuBadge className="rounded-full bg-brand-amber/12 px-1.5 text-[11px] font-medium text-brand-amber-deep group-hover/menu-item:hidden">
                      {formatBadge(item.badge)}
                    </SidebarMenuBadge>
                  )
                : null}
              {item.pinnable !== false && isMobile && (
                <DropdownMenu open={menuFor === item.url} onOpenChange={open => setMenuFor(open ? item.url : null)}>
                  <DropdownMenuTrigger asChild>
                    <span className="pointer-events-none absolute inset-0" aria-hidden data-testid="pin-menu-anchor" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end" collisionPadding={12}>
                    <DropdownMenuItem
                      onSelect={() => props.onTogglePin(item.url)}
                      data-testid="pin-menu-toggle"
                    >
                      {pinIcon(item.url)}
                      {`${pinTitle(item.url)}: ${item.title}`}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {item.pinnable !== false && !isMobile && (
                <SidebarMenuAction
                  showOnHover
                  title={pinTitle(item.url)}
                  aria-label={`${pinTitle(item.url)}: ${item.title}`}
                  onClick={() => props.onTogglePin(item.url)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {pinIcon(item.url)}
                </SidebarMenuAction>
              )}
              {/* Tabs of a combined page — only while you are on it. */}
              {item.tabs && item.tabs.length > 0 && [item, ...item.tabs].some(i => isNavItemActive(pathname, i.url)) && (
                <SidebarMenuSub>
                  {item.tabs.map(tab => (
                    <SidebarMenuSubItem key={tab.url} className="group/tab flex items-center">
                      <SidebarMenuSubButton asChild size="sm" isActive={isNavItemActive(pathname, tab.url)} className="min-w-0 flex-1 text-[13px]">
                        <Link href={tab.url}>
                          <span>{tab.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                      <button
                        type="button"
                        title={pinTitle(tab.url)}
                        aria-label={`${pinTitle(tab.url)}: ${tab.title}`}
                        onClick={() => props.onTogglePin(tab.url)}
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5"
                      >
                        {pinIcon(tab.url)}
                      </button>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          ))}

          {more.length > 0 && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton tooltip={props.moreLabel} className="text-muted-foreground">
                    <ChevronRight />
                    <span>{props.moreLabel}</span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                {/* On a phone the sidebar is a sheet that already fills most
                    of the screen, so a 16rem menu opening to its RIGHT is
                    clipped by the viewport — its items were unreadable and
                    barely tappable. It drops BELOW the trigger there, inside
                    the sheet, and never exceeds the screen at any width.
                    `collisionPadding` keeps it off the edges when it flips. */}
                <DropdownMenuContent
                  side={isMobile ? 'bottom' : 'right'}
                  align="start"
                  collisionPadding={12}
                  className="w-[min(16rem,calc(100vw-2rem))] shadow-(--shadow-pop)"
                >
                  {more.map(item => (
                    <DropdownMenuItem key={item.url} asChild className="group/more flex items-center gap-2 pr-1">
                      <div>
                        <Link href={item.url} className="flex min-w-0 flex-1 items-center gap-2">
                          <item.icon className="size-4 text-muted-foreground" aria-hidden />
                          <span className="truncate">{item.title}</span>
                        </Link>
                        <button
                          type="button"
                          title={pinTitle(item.url)}
                          aria-label={`${pinTitle(item.url)}: ${item.title}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            props.onTogglePin(item.url);
                          }}
                          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity group-hover/more:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5"
                        >
                          {pinIcon(item.url)}
                        </button>
                      </div>
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
}
