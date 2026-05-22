'use client';

import { ChevronsUpDown, Folder } from 'lucide-react';
import { useSession } from 'next-auth/react';

/**
 * Placeholder project selector. Self-hosted today has exactly one
 * project; this just labels it. Multi-project switching lands when the
 * session reads `vocion_active_project` from a cookie and the dashboard
 * tracks which project's content to filter to.
 */
export const ProjectSwitcher = () => {
  const { data: session } = useSession();
  const label = session?.user?.accountId ? 'Default project' : '—';

  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
      disabled
      title="Multi-project switching ships in a follow-up"
    >
      <span className="flex items-center gap-2">
        <Folder className="size-4 text-muted-foreground" />
        {label}
      </span>
      <ChevronsUpDown className="size-4 text-muted-foreground" />
    </button>
  );
};
