'use client';

import { BarChart3, Check, ChevronRight, FileText, LogOut, Settings2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * Bottom-left workspace row + menu — the ChatGPT/Vercel pattern.
 *
 * The primary nav stays pure daily-work links. WHERE you are (workspace) and
 * everything about CONFIGURING it live in one row pinned to the bottom:
 * click it for workspace switching (submenu) plus the management links
 * (Agents/Teams…, Members, System, Docs) and sign-out. No mode toggle in the
 * nav, no config sections competing with daily work.
 *
 * Layout stability: the row renders at a FIXED height with a skeleton while
 * the workspace list loads, so nothing shifts when it arrives (the old
 * top-of-nav switcher popped in and shoved every link down).
 * @param props.isAdmin
 * @param props
 */
type Project = { id: string; slug: string; name: string; description: string | null };

export function WorkspaceMenu({ isAdmin = false, onManage }: { isAdmin?: boolean; onManage?: () => void }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.projects.list()
      .then((r) => {
        if (!cancelled) {
          const rows = r as { projects?: Project[] } | Project[];
          setProjects(Array.isArray(rows) ? rows : rows.projects ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeId = session?.user?.projectId ?? null;
  const active = projects?.find(p => p.id === activeId) ?? projects?.[0] ?? null;

  const switchTo = async (id: string) => {
    setSwitching(id);
    try {
      await client.projects.setActive({ projectId: id });
      router.refresh();
      window.location.reload();
    } finally {
      setSwitching(null);
    }
  };

  // Fixed-height row: skeleton while loading so the nav never shifts.
  const rowClass = 'flex min-h-12 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-sidebar-accent';

  // The row is ALWAYS an interactive trigger — the menu (switch workspace +
  // manage links) must be reachable while the name is still loading. Only the
  // NAME skeletonizes; the row keeps its size so nothing shifts.
  const loading = projects === null;
  const label = active?.name ?? (loading ? '' : 'Workspace');
  const initial = (label || 'W').charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={rowClass} aria-label="Workspace and settings">
        <span className={`grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold ${loading ? 'animate-pulse bg-muted text-transparent' : 'bg-brand-amber-tint text-brand-amber-deep'}`}>
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          {loading
            ? <span className="block h-3 w-24 animate-pulse rounded bg-muted" />
            : <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{label}</span>}
          <span className="mt-0.5 block truncate text-[11px] text-sidebar-foreground/50">{session?.user?.email ?? 'Manage workspace'}</span>
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-sidebar-foreground/40" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-60">
        {(projects?.length ?? 0) > 1 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="flex-1 truncate">Switch workspace</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {(projects ?? []).map(p => (
                  <DropdownMenuItem key={p.id} onClick={() => void switchTo(p.id)} disabled={switching !== null}>
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.id === active?.id && <Check className="ml-2 size-4 shrink-0" aria-hidden />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Short by design: the CONFIG NAV lives in the sidebar (Manage
            workspace swaps to it) — not crammed into this dropdown. */}
        <DropdownMenuItem onClick={() => onManage?.()}>
          <Settings2 className="mr-2 size-4 text-muted-foreground" aria-hidden />
          Manage workspace
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/dashboard/adoption">
              <BarChart3 className="mr-2 size-4 text-muted-foreground" aria-hidden />
              Adoption
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href="https://www.vocion.ai/docs" target="_blank" rel="noreferrer">
            <FileText className="mr-2 size-4 text-muted-foreground" aria-hidden />
            Docs
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/auth/signout">
            <LogOut className="mr-2 size-4 text-muted-foreground" aria-hidden />
            Sign out
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
