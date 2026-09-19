'use client';

/**
 * The shell's reading-width cap, and the routes that opt out of it.
 *
 * The rule itself is pure and lives beside the nav registry
 * (`features/navigation/pageWidth.ts`); this is only the seam that applies it,
 * and it is a client component for one reason: a server layout is not told
 * which page is rendering inside it, and the pathname is. `usePathname` is
 * resolved on the server render too, so there is no flash — the cap is right
 * on the first paint, including the first paint after a client navigation.
 */

import { usePathname } from 'next/navigation';
import { isFullBleedPath, READING_WIDTH_CLASS } from '@/features/navigation/pageWidth';
import { cn } from '@/utils/Helpers';

export function PageWidth(props: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const full = isFullBleedPath(pathname);
  return (
    // Deliberately the same plain block box it has always been, minus the
    // cap: every dashboard page lays itself out inside this, and turning the
    // wrapper into a flex container would quietly re-flow all of them.
    <div data-page-width={full ? 'full' : 'reading'} className={cn(full ? 'w-full' : READING_WIDTH_CLASS)}>
      {props.children}
    </div>
  );
}
