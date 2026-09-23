'use client';

import { Layers } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/libs/I18nNavigation';

/**
 * The way into the bulk actions view (Metacto ticket 071). It carries the
 * queue's current URL state (lane, search, briefed windows) so the view opens
 * on exactly the leads the queue is showing, and nothing is selected here:
 * the queue stays a plain list.
 */
export const BulkActionsButton = () => {
  const params = useSearchParams();
  const search = params.toString();
  return (
    <Link
      href={search ? `/gtm/personalization/bulk?${search}` : '/gtm/personalization/bulk'}
      data-testid="bulk-actions"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      <Layers className="size-3.5" aria-hidden />
      Bulk actions
    </Link>
  );
};
