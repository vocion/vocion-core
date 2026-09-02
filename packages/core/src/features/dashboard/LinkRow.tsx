'use client';

import { ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

/**
 * A table row that IS the link: the whole row opens `href` on click or
 * Enter/Space, and a trailing chevron says so. Cells that carry their own
 * links keep working (their click stops here).
 * @param props
 * @param props.href
 * @param props.children
 */
export function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  const go = () => router.push(href);
  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a,button,input,textarea,select')) {
          return;
        }
        go();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      }}
      className="group cursor-pointer border-b border-border/60 transition outline-none last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      {children}
      <td className="w-8 px-2 py-2.5 text-right">
        <ChevronRight className="inline size-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </td>
    </tr>
  );
}
