'use client';

import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The card's context menu: the places this row can ALSO go, behind one
 * quiet control, so the card itself stays one tap to one place. A product
 * card opens Work filtered to the product; its record, its releases and
 * its wiki are here (Chris, 2026-09-24: "give those cards a context menu to
 * get to more info or context").
 * @param props
 * @param props.items - Resolved links, in order.
 * @param props.label - What the control is called for a screen reader and the tooltip.
 */
export function RowMenu({ items, label = 'More' }: { items: Array<{ label: string; href: string }>; label?: string }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={label}
              data-testid="row-menu"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {items.map(item => (
          <DropdownMenuItem key={item.label} asChild>
            <a href={item.href}>{item.label}</a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
