'use client';

import type { PinnableItem, PinPlace } from './navPins';
import { ArrowDown, ArrowUp, ChevronRight, GripVertical, Pin, PinOff } from 'lucide-react';

import { useRef, useState } from 'react';
import { PendingIcon } from '@/components/patterns/PendingIcon';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CountBadge } from '@/components/ui/count-badge';
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
import { cn } from '@/utils/Helpers';
import { dropPlace, pinStep, splitOverflow } from './navPins';

/**
 * A sidebar group whose rows can be pinned (ElevenLabs pattern, Chris
 * 2026-09-15): hovering a row reveals one pin/unpin icon; nothing else to
 * configure. Past `max` rows, a "More … ›" row opens a submenu listing the
 * rest, each with the same pin affordance. An item with `tabs` (a
 * combined page) reveals them as sub-rows while that page is open, so each
 * tab keeps its own pin — one row in the section otherwise.
 *
 * No pin icon sits on a row by default (founder, 2026-10-08: the phone
 * drawer was "overstuffed"). On a desktop it shows on hover or keyboard
 * focus; on a phone, where there is no hover, a long press on the row opens
 * a small menu with Pin / Unpin. A group may have no label: the main list
 * reads as the drawer's own list, not a section.
 *
 * REORDER — one mechanism for every list of pins (the Pinned group, and the
 * pinned work rows in the main list). The rows named in `order` move:
 *
 * - **Drag** the row (HTML5 drag, no dependency). The row is the drag source,
 *   not the link inside it — a link drags its URL, and a link dropped in
 *   Firefox opens it. A line shows where it will land (above or below the row
 *   under the pointer), and the drop names the pin it landed next to, never
 *   an index (`movePinNear`): a group shows only some of the person's pins,
 *   and an index from it, applied to all of them, landed in the wrong place.
 *   A grip sits in the gutter on hover, outside the row, so it never takes
 *   room from a long name or the pin control.
 * - **Alt+↑ / Alt+↓** on a focused row, which keeps its focus.
 * - **Move up / Move down** in a phone's long-press menu, beside Unpin.
 *
 * The order is stored like the pins themselves (`useNavPrefs`), so it holds
 * across reloads and devices.
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
 * @param props.order - The rows this group can reorder (urls); none when omitted.
 * @param props.moveUpLabel
 * @param props.moveDownLabel
 */
export function PinnableNav(props: {
  label?: string;
  items: PinnableItem[];
  pins: string[];
  onTogglePin: (url: string) => void;
  onMovePin?: (url: string, target: string, place: PinPlace) => void;
  max?: number;
  moreLabel: string;
  pinLabel: string;
  unpinLabel: string;
  order?: readonly string[];
  moveUpLabel?: string;
  moveDownLabel?: string;
}) {
  // `isMobile` comes from the sidebar's own context: at this width the
  // sidebar IS a sheet, which is exactly when a flyout has nowhere to fly to.
  const { toggleSidebar, isMobile, state } = useSidebar();
  const pathname = usePathname();
  // The row being dragged, and where it would land.
  const [drag, setDrag] = useState<{ url: string; over: { url: string; place: PinPlace } | null } | null>(null);
  // A drop is not a click: the release that ends a drag never navigates.
  const dropped = useRef(false);
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
  // "More" opens IN PLACE on the desktop sidebar (Chris, 2026-10-20: "More
  // doesn't work" — a menu flying out to the right reads as nothing
  // happening). The phone sheet and the collapsed icon rail have no room for
  // sub-rows, so they keep the menu. It starts open while one of its rows is
  // the page you are on.
  const inlineMore = !isMobile && state === 'expanded';
  const [moreToggled, setMoreToggled] = useState<boolean | null>(null);
  const moreOpen = moreToggled ?? more.some(item => isNavItemActive(pathname, item.url));

  if (props.items.length === 0) {
    return null;
  }

  const orderable = new Set(props.onMovePin ? props.order ?? [] : []);
  // The reorderable rows in the order they are drawn: a step moves past what the person can see.
  const shownOrder = shown.filter(item => orderable.has(item.url)).map(item => item.url);
  const move = (url: string, target: string, place: PinPlace) => {
    if (url !== target) {
      props.onMovePin?.(url, target, place);
    }
  };
  const step = (url: string, delta: -1 | 1) => pinStep(shownOrder, url, delta);
  const endDrag = () => {
    setDrag(null);
    dropped.current = true;
    setTimeout(() => {
      dropped.current = false;
    }, 0);
  };
  const pinIcon = (url: string) => (props.pins.includes(url) ? <PinOff /> : <Pin />);
  const pinTitle = (url: string) => (props.pins.includes(url) ? props.unpinLabel : props.pinLabel);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {props.label && <SidebarGroupLabel>{props.label}</SidebarGroupLabel>}
        <SidebarMenu>
          {shown.map((item) => {
            const movable = orderable.has(item.url);
            // A phone has no hover and no mouse drag; its long-press menu moves the row instead.
            const draggable = movable && !isMobile;
            const line = drag && drag.over?.url === item.url && drag.url !== item.url ? drag.over.place : null;
            const up = movable ? step(item.url, -1) : null;
            const down = movable ? step(item.url, 1) : null;
            return (
              <SidebarMenuItem
                key={item.url}
                draggable={draggable || undefined}
                onDragStart={draggable
                  ? (e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox starts no drag without data; text, so it reads as the row's name anywhere it lands.
                      e.dataTransfer.setData('text/plain', item.title);
                      setDrag({ url: item.url, over: null });
                    }
                  : undefined}
                onDragOver={drag && movable
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const place = dropPlace(e.clientY, e.currentTarget.getBoundingClientRect());
                      if (drag.over?.url !== item.url || drag.over.place !== place) {
                        setDrag({ ...drag, over: { url: item.url, place } });
                      }
                    }
                  : undefined}
                onDrop={drag && movable
                  ? (e) => {
                      // Never the browser's drop: Firefox would open the dragged text as a search or a URL.
                      e.preventDefault();
                      move(drag.url, item.url, dropPlace(e.clientY, e.currentTarget.getBoundingClientRect()));
                      endDrag();
                    }
                  : undefined}
                onDragEnd={draggable ? endDrag : undefined}
                data-pin-row={movable ? item.url : undefined}
                className={cn(
                  drag?.url === item.url && 'opacity-50',
                  // The drop line: where the row will land.
                  line === 'before' && 'before:pointer-events-none before:absolute before:inset-x-1 before:-top-px before:z-10 before:h-0.5 before:rounded-full before:bg-primary',
                  line === 'after' && 'after:pointer-events-none after:absolute after:inset-x-1 after:-bottom-px after:z-10 after:h-0.5 after:rounded-full after:bg-primary',
                )}
              >
                {draggable && (
                  // In the group's gutter, outside the row: it never takes room from the name or the pin control.
                  <span aria-hidden className="absolute top-1/2 -left-2.5 flex h-6 w-2.5 -translate-y-1/2 cursor-grab items-center justify-center text-muted-foreground/50 opacity-0 transition-opacity group-hover/menu-item:opacity-100 group-data-[collapsible=icon]:hidden active:cursor-grabbing" data-pin-grip>
                    <GripVertical className="size-3 shrink-0" />
                  </span>
                )}
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={isNavItemActive(pathname, item.url)}
                  onClick={(e) => {
                    if (longPressed.current || dropped.current) {
                      e.preventDefault();
                      longPressed.current = false;
                      return;
                    }
                    if (isMobile) {
                      toggleSidebar();
                    }
                  }}
                  onKeyDown={movable
                    ? (e) => {
                        const to = e.altKey && e.key === 'ArrowUp' ? up : e.altKey && e.key === 'ArrowDown' ? down : undefined;
                        if (to === undefined) {
                          return;
                        }
                        e.preventDefault();
                        if (to) {
                          move(item.url, to.target, to.place);
                          // The row re-renders in its new place; keep the person on it.
                          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pin-row="${CSS.escape(item.url)}"] [data-sidebar="menu-button"]`)?.focus());
                        }
                      }
                    : undefined}
                  aria-keyshortcuts={movable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                  {...(item.pinnable !== false ? pressHandlers(item.url) : {})}
                >
                  {/* Not draggable itself: the row is, so a drag moves the row rather than carrying the link's URL. */}
                  <Link href={item.url} draggable={draggable ? false : undefined} className="[-webkit-touch-callout:none]">
                    <PendingIcon icon={item.icon} />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge
                  ? (
                      <SidebarMenuBadge className="h-auto min-w-0 px-0 group-hover/menu-item:hidden">
                        <CountBadge count={item.badge} />
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
                      {up && (
                        <DropdownMenuItem onSelect={() => move(item.url, up.target, up.place)} data-testid="pin-menu-move-up">
                          <ArrowUp />
                          {props.moveUpLabel ?? 'Move up'}
                        </DropdownMenuItem>
                      )}
                      {down && (
                        <DropdownMenuItem onSelect={() => move(item.url, down.target, down.place)} data-testid="pin-menu-move-down">
                          <ArrowDown />
                          {props.moveDownLabel ?? 'Move down'}
                        </DropdownMenuItem>
                      )}
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
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5' })}
                        >
                          {pinIcon(tab.url)}
                        </button>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                )}
              </SidebarMenuItem>
            );
          })}

          {more.length > 0 && inlineMore && (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={props.moreLabel}
                className="text-muted-foreground"
                aria-expanded={moreOpen}
                data-testid="nav-more-toggle"
                onClick={() => setMoreToggled(!moreOpen)}
              >
                <ChevronRight className={cn('transition-transform', moreOpen && 'rotate-90')} />
                <span>{props.moreLabel}</span>
              </SidebarMenuButton>
              {moreOpen && (
                <SidebarMenuSub>
                  {more.map(item => (
                    <SidebarMenuSubItem key={item.url} className="group/more flex items-center">
                      <SidebarMenuSubButton asChild isActive={isNavItemActive(pathname, item.url)} className="min-w-0 flex-1">
                        <Link href={item.url}>
                          <item.icon aria-hidden />
                          <span className="truncate">{item.title}</span>
                        </Link>
                      </SidebarMenuSubButton>
                      {item.pinnable !== false && (
                        <button
                          type="button"
                          title={pinTitle(item.url)}
                          aria-label={`${pinTitle(item.url)}: ${item.title}`}
                          onClick={() => props.onTogglePin(item.url)}
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'opacity-0 group-hover/more:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5' })}
                        >
                          {pinIcon(item.url)}
                        </button>
                      )}
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              )}
            </SidebarMenuItem>
          )}

          {more.length > 0 && !inlineMore && (
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
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'opacity-0 group-hover/more:opacity-100 focus-visible:opacity-100 [&_svg]:size-3.5' })}
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
