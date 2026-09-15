'use client';

import type { PinnableItem } from './navPins';
import { ChevronRight, GripVertical, Pin, PinOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useSidebar } from '@/components/ui/useSidebar';
import { isNavItemActive } from '@/features/dashboard/isNavItemActive';
import { NavPendingIcon } from '@/features/dashboard/NavPendingIcon';
import { Link } from '@/libs/I18nNavigation';
import { splitOverflow } from './navPins';

const formatBadge = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * A sidebar group whose rows can be pinned (ElevenLabs pattern, Chris
 * 2026-09-15): hovering a row reveals one pin/unpin icon; nothing else to
 * configure. Past `max` rows, a "More … ›" row opens a submenu listing the
 * rest, each with the same pin affordance. In the Pinned group, rows can be
 * dragged to reorder (HTML5 drag, no dependency).
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
  label: string;
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
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();
  const [dragging, setDragging] = useState<string | null>(null);
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
        <SidebarGroupLabel>{props.label}</SidebarGroupLabel>
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
                onClick={() => {
                  if (isMobile) {
                    toggleSidebar();
                  }
                }}
              >
                <Link href={item.url}>
                  {props.reorderable
                    ? <GripVertical className="hidden text-muted-foreground/40 group-hover/menu-item:block" aria-hidden />
                    : null}
                  <NavPendingIcon icon={item.icon} />
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
              <SidebarMenuAction
                showOnHover
                title={pinTitle(item.url)}
                aria-label={`${pinTitle(item.url)}: ${item.title}`}
                onClick={() => props.onTogglePin(item.url)}
                className="text-muted-foreground hover:text-foreground"
              >
                {pinIcon(item.url)}
              </SidebarMenuAction>
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
                <DropdownMenuContent side="right" align="start" className="w-64 shadow-(--shadow-pop)">
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
