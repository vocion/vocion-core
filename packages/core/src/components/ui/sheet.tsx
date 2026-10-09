'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/Helpers';
import { ModalLayerContext } from './modalLayer';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * THE GRABBER ON A BOTTOM SHEET, DRAGGED DOWN, CLOSES IT (Chris, 2026-09-29,
 * on the phone chat drawer: "Toggle drag bar on mobile app drawer doesn't do
 * anything. It should allow drag to close."). The bar and a 28px band around
 * it take the drag; the sheet follows the finger, and past a quarter of its
 * height — or on a quick flick — it closes, otherwise it springs back.
 * @param props - Props.
 * @param props.onDismiss - Close the sheet (its `onOpenChange(false)`).
 * @param props.className - Extra classes for the band.
 */
function SheetGrabber({ onDismiss, className }: { onDismiss: () => void; className?: string }) {
  const drag = React.useRef<{ y: number; t: number; sheet: HTMLElement | null } | null>(null);
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d?.sheet) {
      return;
    }
    const dy = Math.max(0, e.clientY - d.y);
    d.sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.sheet) {
      return;
    }
    const dy = Math.max(0, e.clientY - d.y);
    const speed = dy / Math.max(1, e.timeStamp - d.t);
    d.sheet.style.transition = '';
    if (dy > d.sheet.offsetHeight / 4 || speed > 0.6) {
      onDismiss();
      return;
    }
    d.sheet.style.transform = '';
  };
  return (
    <div
      data-slot="sheet-grabber"
      role="presentation"
      className={cn('flex h-7 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing', className)}
      onPointerDown={(e) => {
        const sheet = e.currentTarget.closest('[data-slot="sheet-content"]') as HTMLElement | null;
        drag.current = { y: e.clientY, t: e.timeStamp, sheet };
        if (sheet) {
          sheet.style.transition = 'none';
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // A pointer the browser no longer tracks: the drag still follows moves on the band.
        }
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div aria-hidden className="h-1 w-9 rounded-full bg-border" />
    </div>
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  closeClassName,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Reposition the close control — for a sheet that opens with its own header row. */
  closeClassName?: string;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
          side === 'right'
          && 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left'
          && 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top'
          && 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
          side === 'bottom'
          && 'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
          className,
        )}
        {...props}
      >
        <ModalLayerContext value>{children}</ModalLayerContext>
        {/* `closeClassName` lets a sheet whose first row is its own header put
            this on that row's baseline. Without it the close is pinned to the
            sheet's top corner, and a sheet that opens with a grabber above a
            48px header drew the X a clear 24px above the controls beside it
            (Chris, 2026-09-22: "some alignment issues in chat head"). */}
        <SheetPrimitive.Close className={cn('absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary', closeClassName)}>
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetGrabber,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
