'use client';

import { ChevronsUpDown, Folder } from 'lucide-react';
import { useSession } from 'next-auth/react';

/**
 * Workspace selector. Self-hosted today has exactly one workspace, so this
 * renders a plain label (no dropdown affordance). When multi-workspace
 * switching lands, pass `count > 1` to show the switcher chevron + menu.
 * @param props
 * @param props.count - number of workspaces available (default 1 → plain label)
 */
export const ProjectSwitcher = (props: { count?: number }) => {
  const { data: session } = useSession();
  const count = props.count ?? 1;
  const multi = count > 1;

  // Single-workspace deployment: nothing to switch, and a static "Workspace"
  // label just duplicates the section header below. Render nothing until
  // multi-workspace switching lands (count > 1).
  if (!multi) {
    return null;
  }

  const label = session?.user?.accountId ? 'Workspace' : '—';

  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm enabled:hover:bg-muted disabled:cursor-default"
      disabled={!multi}
      title={multi ? 'Switch workspace' : undefined}
    >
      <span className="flex items-center gap-2">
        <Folder className="size-4 text-muted-foreground" />
        {label}
      </span>
      {multi && <ChevronsUpDown className="size-4 text-muted-foreground" />}
    </button>
  );
};
