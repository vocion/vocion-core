'use client';

import type { PaletteConversation, PaletteEntity, PaletteRow } from '@/features/dashboard/palette/paletteGroups';
import { BookOpen, Bot, Compass, Loader, LogOut, MessageSquare, MessagesSquare, Moon, Network, PanelLeft, PanelRight, Plus, Search, Sparkles, Sun } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { useSidebar } from '@/components/ui/useSidebar';
import { focusAgentComposer, requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { COMMAND_PALETTE_EVENT } from '@/features/dashboard/commandPaletteEvent';
import { buildPaletteGroups, paletteFilter } from '@/features/dashboard/palette/paletteGroups';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { client } from '@/libs/Orpc';

/**
 * The ⌘K command palette (B-034b §3 / #228 salvage): jump to any page, agent,
 * team or mission, reopen a recent conversation, or — when the query is free
 * text — hand it to the agent surface. Mounted once in the shell by
 * `AgentSurfaceHotkey`. Yields ⌘K on the docs and roadmap routes, whose own
 * search owns the key there. The rail's own hotkey is ⌘J (bound by the rail).
 *
 * Data: pages come from the static route registry; agents from the shell
 * (already loaded for the dock); teams, missions and the last conversations
 * are fetched lazily the first time the palette opens.
 * @param props
 * @param props.isAdmin - Whether admin-only routes are offered.
 * @param props.agents - The workspace's chat agents (slug, name, description).
 */
export function CommandPalette({ isAdmin = false, agents = [] }: { isAdmin?: boolean; agents?: PaletteEntity[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<PaletteEntity[]>();
  const [missions, setMissions] = useState<PaletteEntity[]>();
  const [conversations, setConversations] = useState<PaletteConversation[]>();
  const fetching = useRef(false);
  const loading = open && teams === undefined;
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || e.defaultPrevented) {
        return;
      }
      if (pathname.includes('/dashboard/docs') || pathname.includes('/dashboard/roadmap')) {
        return;
      }
      e.preventDefault();
      setOpen(o => !o);
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen);
    };
  }, [pathname]);

  // Lazy data — fetched once, the first time the palette opens.
  useEffect(() => {
    if (!open || teams !== undefined || fetching.current) {
      return;
    }
    let cancelled = false;
    fetching.current = true;
    Promise.allSettled([
      client.teams.list(),
      client.missions.list(),
      client.conversations.list({ limit: 8 }),
    ]).then(([t, m, c]) => {
      if (cancelled) {
        return;
      }
      setTeams(t.status === 'fulfilled' ? (t.value.teams ?? []).map(x => ({ slug: x.slug, name: x.name, description: x.description ?? undefined })) : []);
      setMissions(m.status === 'fulfilled' ? (m.value as Array<{ slug: string; name: string; description?: string | null }>).map(x => ({ slug: x.slug, name: x.name, description: x.description ?? undefined })) : []);
      setConversations(c.status === 'fulfilled' ? (c.value as Array<{ id: number; title: string; agentSlug: string }>).map(x => ({ id: x.id, title: x.title, agentSlug: x.agentSlug })) : []);
      fetching.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [open, teams]);

  const groups = useMemo(() => buildPaletteGroups({
    query,
    routes: DASHBOARD_ROUTES,
    isAdmin,
    agents,
    teams,
    missions,
    conversations,
    themeIsDark: resolvedTheme === 'dark',
  }), [query, isAdmin, agents, teams, missions, conversations, resolvedTheme]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const go = (url: string) => {
    close();
    if (url.startsWith('http')) {
      window.open(url, '_blank', 'noreferrer');
    } else {
      router.push(url);
    }
  };

  /**
   * Hand the query to whatever agent surface the page carries. The rail (R4)
   * extends `requestAgentSurface` to accept `{ prompt }`; on a core where it
   * still takes no arguments the extra object is ignored and we fall back to
   * focusing the composer, or to the chat page's `?prompt=` deep link.
   * @param text - The typed question, if any.
   */
  const ask = (text: string) => {
    close();
    const request = requestAgentSurface as unknown as (opts?: { prompt?: string }) => boolean;
    const claimed = request(text ? { prompt: text } : undefined);
    if (claimed) {
      focusAgentComposer(null);
      return;
    }
    router.push(text ? `/dashboard/chat?prompt=${encodeURIComponent(text)}` : '/dashboard/chat');
  };

  const run = (row: PaletteRow) => {
    if (row.url) {
      go(row.url);
      return;
    }
    switch (row.action) {
      case 'ask':
        ask(query.trim());
        return;
      case 'new-conversation':
        // The ONE entry function (§6): a mounted surface starts over in place;
        // none mounted, the chat page opens asking for a fresh thread.
        close();
        if (!requestAgentSurface({ newChat: true })) {
          router.push('/dashboard/chat?new=1');
        }
        return;
      case 'open-rail':
        close();
        if (!requestAgentSurface()) {
          router.push('/dashboard/chat');
        }
        return;
      case 'toggle-sidebar':
        close();
        toggleSidebar();
        return;
      case 'toggle-theme':
        close();
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
        return;
      case 'docs':
        go('https://www.vocion.ai/docs');
        return;
      case 'sign-out':
        close();
        void signOut({ callbackUrl: '/sign-in' });
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={o => (o ? setOpen(true) : close())} title="Search and commands" description="Jump to a page, an agent or a conversation, or ask Vocion." commandProps={{ filter: paletteFilter }}>
      <CommandInput placeholder="Search, or ask Vocion anything…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Nothing matches. Press Enter to ask Vocion instead.</CommandEmpty>
        {groups.map((group, i) => (
          <div key={group.heading}>
            {i > 0 && group.heading === 'Commands' && <CommandSeparator />}
            <CommandGroup heading={group.heading}>
              {group.rows.map(row => (
                <CommandItem key={row.value} value={row.value} onSelect={() => run(row)}>
                  <RowIcon row={row} />
                  <span className="min-w-0 flex-1 truncate">
                    {row.label}
                    {row.hint && <span className="ml-2 text-[12px] text-muted-foreground">{row.hint}</span>}
                  </span>
                  {row.shortcut && <CommandShortcut>{row.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
            <Loader className="size-3.5 animate-spin" aria-hidden />
            Loading teams, missions and conversations…
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function RowIcon({ row }: { row: PaletteRow }) {
  if (row.kind === 'route') {
    const route = DASHBOARD_ROUTES.find(r => r.url === row.url);
    if (route) {
      return <route.icon />;
    }
    return <Search />;
  }
  switch (row.kind) {
    case 'ask': return <Sparkles />;
    case 'agent': return <Bot />;
    case 'team': return <Network />;
    case 'mission': return <Compass />;
    case 'conversation': return <MessageSquare />;
    default: break;
  }
  switch (row.action) {
    case 'ask': return <Sparkles />;
    case 'new-conversation': return <Plus />;
    case 'all-conversations': return <MessagesSquare />;
    case 'open-rail': return <PanelRight />;
    case 'toggle-sidebar': return <PanelLeft />;
    case 'toggle-theme': return row.label.includes('light') ? <Sun /> : <Moon />;
    case 'docs': return <BookOpen />;
    case 'sign-out': return <LogOut />;
    default: return <Search />;
  }
}
