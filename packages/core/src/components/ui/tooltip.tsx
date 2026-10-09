'use client';

/**
 * The tooltip surface is the INK primary, not the brand accent.
 *
 * It was `bg-primary`, and `--primary` is `--brand-amber`, so every tooltip in
 * the product — the collapsed sidebar, the autonomy control, a chip's raw id —
 * arrived as a bright orange slab. Chris, 2026-09-16: *"maybe not bright
 * orange though."*
 *
 * Amber is the attention colour; a tooltip is not attention, it is the thing
 * you already asked for by hovering. `--action` / `--action-foreground` is the
 * one ink primary the buttons already use, and it inverts correctly in both
 * themes — near-black on light, near-white on dark — so the accent stays spent
 * where something actually needs it.
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';
import { cn } from '@/utils/Helpers';

/**
 * WHEN A TOOLTIP MAY OPEN: on a real hover with a fine pointer
 * (`(hover: hover) and (pointer: fine)`), or on keyboard focus
 * (`:focus-visible`). Never on touch, and never on focus that a drawer or
 * dialog moved there when it opened: on a phone, opening the sidebar drawer
 * landed focus on a rail button and its tooltip ("Software Factory · in
 * another workspace") covered the switcher (founder, 2026-10-08).
 *
 * Radix opens on any pointer move that is not touch and on any focus; the
 * trigger records why it is asking, and the root refuses an open it was not
 * asked for by one of the two allowed causes. A tooltip whose `open` the
 * caller controls is left to the caller.
 */
const TooltipGate = React.createContext<React.MutableRefObject<boolean> | null>(null);

function finePointerHover(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const allowedRef = React.useRef(false);
  const [open, setOpen] = React.useState(defaultOpen ?? false);
  const controlled = openProp !== undefined;
  const change = React.useCallback((next: boolean) => {
    if (next && !allowedRef.current) {
      return;
    }
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  return (
    <TooltipProvider>
      <TooltipGate value={allowedRef}>
        <TooltipPrimitive.Root
          data-slot="tooltip"
          open={controlled ? openProp : open}
          onOpenChange={controlled ? onOpenChange : change}
          {...props}
        />
      </TooltipGate>
    </TooltipProvider>
  );
}

function TooltipTrigger({
  onPointerMove,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const allowedRef = React.use(TooltipGate);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerMove={(e) => {
        if (allowedRef) {
          allowedRef.current = e.pointerType === 'mouse' && finePointerHover();
        }
        onPointerMove?.(e);
      }}
      onPointerLeave={(e) => {
        if (allowedRef) {
          allowedRef.current = false;
        }
        onPointerLeave?.(e);
      }}
      onFocus={(e) => {
        if (allowedRef) {
          allowedRef.current = focusVisible(e.currentTarget);
        }
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (allowedRef) {
          allowedRef.current = false;
        }
        onBlur?.(e);
      }}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-[var(--action)] text-[var(--action-foreground)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-[var(--action)] fill-[var(--action)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
