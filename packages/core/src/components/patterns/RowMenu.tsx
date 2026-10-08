'use client';

import type { LucideIcon } from 'lucide-react';
import { MoreHorizontal } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** One entry: a place to go (`href`) or a thing to do (`onClick`). */
export type RowMenuItem
  = | { label: string; href: string; icon?: LucideIcon }
    | { label: string; onClick: () => void; icon?: LucideIcon; disabled?: boolean };

/**
 * A row's overflow menu: everything a row CAN do beyond its one quiet
 * primary action, behind one control, so the row itself stays calm
 * (`docs/design/patterns.md` § Row anatomy — one primary per row). A product
 * card opens Work filtered to the product, and its record, releases and wiki
 * are here (Chris, 2026-09-24: "give those cards a context menu to get to more
 * info or context"); a connected connector syncs from its row, and Edit and
 * Delete are here.
 *
 * No red in the menu: a destructive entry opens its own confirm dialog, and
 * the dialog's confirm button is the one red thing.
 * @param props
 * @param props.items - Links or actions, in order.
 * @param props.label - What the control is called for a screen reader and the tooltip.
 */
export function RowMenu({ items, label = 'More' }: { items: RowMenuItem[]; label?: string }) {
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
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {items.map((item) => {
          const Icon = item.icon;
          return 'href' in item
            ? (
                <DropdownMenuItem key={item.label} asChild>
                  <a href={item.href}>
                    {Icon && <Icon aria-hidden />}
                    {item.label}
                  </a>
                </DropdownMenuItem>
              )
            : (
                <DropdownMenuItem key={item.label} onSelect={item.onClick} disabled={item.disabled}>
                  {Icon && <Icon aria-hidden />}
                  {item.label}
                </DropdownMenuItem>
              );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
