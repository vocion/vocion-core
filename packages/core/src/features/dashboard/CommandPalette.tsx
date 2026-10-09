'use client';

import type { PaletteCodeHit, PaletteConversation, PaletteEntity, PaletteRow } from '@/features/dashboard/palette/paletteGroups';
import { BookOpen, Bot, Compass, Hash, Loader, LogOut, MessageSquare, MessagesSquare, Moon, Network, PanelLeft, PanelRight, Pin, Plus, Search, Sparkles, Sun } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { toast } from '@/components/ui/toast';
import { useSidebar } from '@/components/ui/useSidebar';
import { focusAgentComposer, requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { COMMAND_PALETTE_EVENT } from '@/features/dashboard/commandPaletteEvent';
import { pinPath, pinTarget, unpinKey, usePin } from '@/features/dashboard/nav/useNavPrefs';
import { buildPaletteGroups, codeRowValue, paletteFilter } from '@/features/dashboard/palette/paletteGroups';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { useCurrentPinTarget } from '@/features/pins/PinControls';
import { parseCode } from '@/libs/codes';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
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
 * @param props.enabledPlugins
 * @param props.agents - The workspace's chat agents (slug, name, description).
 */
export function CommandPalette({ isAdmin = false, enabledPlugins, agents = [] }: { isAdmin?: boolean; enabledPlugins?: readonly string[]; agents?: PaletteEntity[] }) {
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
  const t = useTranslations('DashboardLayout');
  // What "this" is: the thing the page is about, when it is pinnable.
  const here = useCurrentPinTarget();
  const { pinned: herePinned, key: hereKey } = usePin(here?.target ?? null);
  // A keyboard pin has no button to change, so it says what it did, with Undo.
  const togglePinHere = async () => {
    if (!here || !hereKey) {
      return;
    }
    const { target, known } = here;
    if (herePinned) {
      await unpinKey(hereKey);
      toast.success(t('unpinned'), { action: { label: 'Undo', onClick: () => void pinTarget(target, known) } });
      return;
    }
    // A declared thing pins as itself; a page read from its path is checked by the server.
    const res = known ? await pinTarget(target, known) : await pinPath(pathname);
    if (res.ok) {
      toast.success(t('pinned'), { action: { label: 'Undo', onClick: () => void unpinKey(hereKey) } });
    } else {
      toast.error(res.error ?? t('pin_this'));
    }
  };
  const togglePinRef = useRef(togglePinHere);
  useEffect(() => {
    togglePinRef.current = togglePinHere;
  });

  // ⌘⇧P pins (or unpins) the thing on screen, from anywhere on the page.
  useEffect(() => {
    function onPinKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.key.toLowerCase() !== 'p' || e.defaultPrevented) {
        return;
      }
      e.preventDefault();
      void togglePinRef.current();
    }
    window.addEventListener('keydown', onPinKey);
    return () => window.removeEventListener('keydown', onPinKey);
  }, []);

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

  // A typed code (FE-294, RUN-439) is looked up as it is typed, so ↵ opens it.
  const [codeHit, setCodeHit] = useState<PaletteCodeHit | null>(null);
  // The highlighted row. A code's hit arrives after the typing, so it takes
  // the highlight then — ↵ opens FE-294, not "Ask Vocion: FE-294".
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const typed = query.trim();
    const parsed = parseCode(typed);
    if (!open || !parsed || (!parsed.prefix && !typed.startsWith('#'))) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`/api/v1/codes/${encodeURIComponent(typed)}`, { credentials: 'same-origin' })
        .then(res => (res.ok ? res.json() as Promise<{ code: string; title?: string; href: string }> : null))
        .then((body) => {
          if (!cancelled) {
            const hit = body ? { query: typed, code: body.code, title: body.title, href: body.href } : null;
            setCodeHit(hit);
            if (hit) {
              setSelected(codeRowValue(hit));
            }
          }
        })
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const groups = useMemo(() => buildPaletteGroups({
    query,
    routes: DASHBOARD_ROUTES,
    isAdmin,
    enabledPlugins,
    agents,
    teams,
    missions,
    conversations,
    codeHit,
    themeIsDark: resolvedTheme === 'dark',
    pinHere: here ? { pinned: herePinned, pinLabel: t('pin_this'), unpinLabel: t('unpin_this') } : null,
  }), [query, isAdmin, enabledPlugins, agents, teams, missions, conversations, codeHit, resolvedTheme, here, herePinned, t]);

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
        return;
      case 'pin-this':
        close();
        void togglePinHere();
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={o => (o ? setOpen(true) : close())} title="Search and commands" description="Jump to a page, an agent or a conversation, or ask Vocion." commandProps={{ filter: paletteFilter, value: selected, onValueChange: setSelected }}>
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
    case 'code': return <Hash />;
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
    case 'pin-this': return <Pin />;
    default: return <Search />;
  }
}
