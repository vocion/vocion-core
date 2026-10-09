'use client';

import type { PinnableItem } from './navPins';
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, MoreHorizontal, Pin, PinOff, X } from 'lucide-react';

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
import { keyOf, splitOverflow } from './navPins';

const formatBadge = (n: number) => (n > 99 ? '99+' : String(n));
const ROW_ICON = 'flex size-5 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-3.5';

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
 *
 * The Pinned group (`reorderable`) is where a person keeps their own things —
 * sections and objects alike (founder, 2026-10-09: "Pin artifacts/wikis/chats/
 * data rooms … that show up in my sidebar"). Each row is its kind's icon and
 * its title on one line, the whole title in a tooltip. On a desktop, hovering
 * a row shows an × to unpin and a ⋯ with Move up, Move down and Unpin; the
 * same moves are Alt+↑ / Alt+↓ on a focused row, so drag is never the only
 * way to reorder. On a phone the long press menu carries all three.
 *
 * A row closes the phone's drawer by the one global rule (a link was
 * activated, `components/ui/drawerClose.ts`), never by a close of its own.
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
 * @param props.moveUpLabel
 * @param props.moveDownLabel
 * @param props.rowMenuLabel
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
  /** The Pinned group's row verbs (`reorderable`): Move up / Move down, and the ⋯'s name. */
  moveUpLabel?: string;
  moveDownLabel?: string;
  rowMenuLabel?: string;
}) {
  // `isMobile` comes from the sidebar's own context: at this width the
  // sidebar IS a sheet, which is exactly when a flyout has nowhere to fly to.
  const { isMobile } = useSidebar();
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
  // The keyboard and menu way to reorder: one place up or down.
  const canMove = props.reorderable && props.onMovePin;
  const move = (key: string, index: number, by: -1 | 1) => {
    const to = index + by;
    if (canMove && to >= 0 && to < props.items.length) {
      props.onMovePin!(key, to);
    }
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
              key={keyOf(item)}
              data-pin-key={props.reorderable ? keyOf(item) : undefined}
              draggable={props.reorderable}
              onDragStart={props.reorderable ? () => setDragging(keyOf(item)) : undefined}
              onDragOver={props.reorderable ? e => e.preventDefault() : undefined}
              onDrop={props.reorderable ? () => dropOn(keyOf(item), index) : undefined}
              onDragEnd={props.reorderable ? () => setDragging(null) : undefined}
              className={dragging === keyOf(item)
                ? 'opacity-50'
                : undefined}
            >
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={isNavItemActive(pathname, item.url)}
                // The title keeps its width until the row's controls show.
                className={canMove && !isMobile ? 'group-focus-within/menu-item:pr-14! group-hover/menu-item:pr-14! group-has-data-[sidebar=menu-action]/menu-item:pr-2' : undefined}
                onClick={(e) => {
                  // The drawer closes by the global rule (a link was activated);
                  // only the tap that ends a long press is kept from navigating.
                  if (longPressed.current) {
                    e.preventDefault();
                    longPressed.current = false;
                  }
                }}
                onKeyDown={canMove
                  ? (e) => {
                      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        move(keyOf(item), index, e.key === 'ArrowUp' ? -1 : 1);
                      }
                    }
                  : undefined}
                {...(item.pinnable !== false ? pressHandlers(keyOf(item)) : {})}
              >
                <Link href={item.url} title={canMove ? item.title : undefined} className="[-webkit-touch-callout:none]">
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
                <DropdownMenu open={menuFor === keyOf(item)} onOpenChange={open => setMenuFor(open ? keyOf(item) : null)}>
                  <DropdownMenuTrigger asChild>
                    <span className="pointer-events-none absolute inset-0" aria-hidden data-testid="pin-menu-anchor" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="bottom" align="end" collisionPadding={12}>
                    {canMove && index > 0 && (
                      <DropdownMenuItem onSelect={() => move(keyOf(item), index, -1)} data-testid="pin-menu-up">
                        <ArrowUp />
                        {props.moveUpLabel}
                      </DropdownMenuItem>
                    )}
                    {canMove && index < props.items.length - 1 && (
                      <DropdownMenuItem onSelect={() => move(keyOf(item), index, 1)} data-testid="pin-menu-down">
                        <ArrowDown />
                        {props.moveDownLabel}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => props.onTogglePin(keyOf(item))}
                      data-testid="pin-menu-toggle"
                    >
                      {pinIcon(keyOf(item))}
                      {`${pinTitle(keyOf(item))}: ${item.title}`}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {item.pinnable !== false && !isMobile && !canMove && (
                <SidebarMenuAction
                  showOnHover
                  title={pinTitle(keyOf(item))}
                  aria-label={`${pinTitle(keyOf(item))}: ${item.title}`}
                  onClick={() => props.onTogglePin(keyOf(item))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {pinIcon(keyOf(item))}
                </SidebarMenuAction>
              )}
              {/* Pinned, on a desktop: ⋯ (move up, move down, unpin) and ×,
                  shown on hover or keyboard focus only. */}
              {item.pinnable !== false && !isMobile && canMove && (
                <div
                  data-sidebar="menu-action"
                  className="absolute top-1.5 right-1 flex items-center gap-0.5 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden has-data-[state=open]:opacity-100 md:opacity-0"
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title={props.rowMenuLabel}
                        aria-label={`${props.rowMenuLabel ?? ''}: ${item.title}`}
                        data-testid="pinned-row-menu"
                        className={ROW_ICON}
                      >
                        <MoreHorizontal />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" collisionPadding={12}>
                      <DropdownMenuItem disabled={index === 0} onSelect={() => move(keyOf(item), index, -1)}>
                        <ArrowUp />
                        {props.moveUpLabel}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={index === props.items.length - 1} onSelect={() => move(keyOf(item), index, 1)}>
                        <ArrowDown />
                        {props.moveDownLabel}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => props.onTogglePin(keyOf(item))} data-testid="pinned-row-unpin">
                        <PinOff />
                        {props.unpinLabel}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    title={props.unpinLabel}
                    aria-label={`${props.unpinLabel}: ${item.title}`}
                    data-testid="pinned-row-remove"
                    onClick={() => props.onTogglePin(keyOf(item))}
                    className={ROW_ICON}
                  >
                    <X />
                  </button>
                </div>
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
                    <DropdownMenuItem key={keyOf(item)} asChild className="group/more flex items-center gap-2 pr-1">
                      <div>
                        <Link href={item.url} title={item.title} className="flex min-w-0 flex-1 items-center gap-2">
                          <item.icon className="size-4 text-muted-foreground" aria-hidden />
                          <span className="truncate">{item.title}</span>
                        </Link>
                        <button
                          type="button"
                          title={pinTitle(keyOf(item))}
                          aria-label={`${pinTitle(keyOf(item))}: ${item.title}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            props.onTogglePin(keyOf(item));
                          }}
                          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity group-hover/more:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 [&_svg]:size-3.5"
                        >
                          {canMove ? <X /> : pinIcon(keyOf(item))}
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
