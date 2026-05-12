'use client';

import type { DocEntry } from '@/libs/docs';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { DocsSidebar } from '@/features/dashboard/DocsSidebar';

type Props = {
  entries: DocEntry[];
  currentSlug: string;
  publicBasePath?: string;
};

/**
 * Mobile-only docs sidebar trigger + drawer. Renders nothing on
 * `lg:+` breakpoints (the inline sidebar takes over).
 * @param root0
 * @param root0.entries
 * @param root0.currentSlug
 * @param root0.publicBasePath
 */
export function DocsMobileDrawer({ entries, currentSlug, publicBasePath }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm lg:hidden"
          aria-label="Open docs menu"
        >
          <Menu className="h-4 w-4" />
          Docs menu
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Docs</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <DocsSidebar entries={entries} currentSlug={currentSlug} publicBasePath={publicBasePath} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
