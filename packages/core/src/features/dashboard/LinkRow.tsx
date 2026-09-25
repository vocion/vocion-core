'use client';

import { ChevronRight, Loader } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { beginNavigation } from './navigationInFlight';

/**
 * A table row that IS the link: the whole row opens `href` on click or
 * Enter/Space, and a trailing chevron says so. Cells that carry their own
 * links keep working (their click stops here).
 *
 * The tap is acknowledged at once (backlog 013): `active:` answers the
 * finger, the navigation runs in a transition so the row can dim and swap
 * its chevron for a spinner while the page is on its way, and the top
 * progress bar is told — a row navigates in code, so no link click reaches
 * the bar's listener.
 * @param props
 * @param props.href
 * @param props.children
 */
export function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = () => {
    beginNavigation();
    startTransition(() => router.push(href));
  };
  return (
    <tr
      role="link"
      tabIndex={0}
      aria-busy={pending || undefined}
      data-pending={pending ? 'true' : undefined}
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
      className="group cursor-pointer border-b border-border/60 transition outline-none last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 active:bg-muted/60 data-[pending=true]:opacity-60"
    >
      {children}
      <td className="w-8 px-2 py-2.5 text-right">
        {pending
          ? <Loader className="inline size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          : <ChevronRight className="inline size-4 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />}
      </td>
    </tr>
  );
}
