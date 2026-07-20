'use client';

import { Check, ChevronsUpDown, Folder } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { client } from '@/libs/Orpc';

type Project = { id: string; slug: string; name: string; description: string | null };

/**
 * The current-workspace row at the top of the sidebar drawer. Always names
 * the workspace you're in; when the account has more than one project it
 * doubles as a small picker — choosing one sets the `vocion_active_project`
 * cookie (the session callback re-resolves tenancy from it) and reloads.
 * Quiet by design: one labeled row, one small menu, nothing else.
 */
export const ProjectSwitcher = () => {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.projects.list().then((r) => {
      if (!cancelled) {
        setProjects(r.projects);
      }
    }).catch(() => {
      if (!cancelled) {
        setProjects([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide until the list loads — no flash of a wrong state.
  if (!projects || projects.length === 0) {
    return null;
  }

  const activeId = session?.user?.projectId ?? null;
  const active = projects.find(p => p.id === activeId) ?? projects[0]!;

  // Single-project deployments still get the workspace NAME (you should
  // always know where you are) — just without a picker.
  if (projects.length < 2) {
    return (
      <div className="flex min-h-11 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm sm:min-h-9">
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{active.name}</span>
      </div>
    );
  }

  const switchTo = async (projectId: string) => {
    if (projectId === activeId) {
      return;
    }
    setSwitching(projectId);
    try {
      // Server validates the project belongs to the caller's account.
      await client.projects.setActive({ projectId });
      // Set the cookie client-side — the session callback re-resolves
      // tenancy from this cookie on every read, so a reload is enough.
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `vocion_active_project=${projectId}; path=/; max-age=${oneYear}; SameSite=Lax`;
      window.location.reload();
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-11 w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted sm:min-h-9"
        title="Switch workspace"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{active.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] min-w-56">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {projects.map(p => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => switchTo(p.id)}
            disabled={switching !== null}
            className="flex items-center justify-between"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{p.name}</span>
              {p.description && <span className="truncate text-xs text-muted-foreground">{p.description}</span>}
            </span>
            {p.id === activeId && <Check className="ml-2 size-4 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
