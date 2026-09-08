'use client';

import { BookOpen, LogOut, Moon, PanelLeft, Search, Sparkles, Sun } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command';
import { useSidebar } from '@/components/ui/useSidebar';
import { AGENT_PREFILL_EVENT, requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { COMMAND_PALETTE_EVENT } from '@/features/dashboard/commandPaletteEvent';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';

const GROUP_ORDER = ['Workspace', 'Team', 'Knowledge', 'Build', 'Observability', 'Organization'] as const;

/**
 * The ⌘K command palette: jump to any page, ask the agent, search knowledge,
 * flip theme or sidebar, sign out. Mounted once in the shell. Yields ⌘K on
 * the in-app docs and roadmap routes, whose own search owns the key there.
 * @param props - Palette props.
 * @param props.isAdmin - Whether admin-only routes are offered.
 */
export function CommandPalette({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
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

  const go = (url: string) => {
    setOpen(false);
    setQuery('');
    if (url.startsWith('http')) {
      window.open(url, '_blank', 'noreferrer');
    } else {
      router.push(url);
    }
  };

  const ask = () => {
    const text = query.trim();
    setOpen(false);
    setQuery('');
    if (requestAgentSurface()) {
      if (text) {
        window.dispatchEvent(new CustomEvent(AGENT_PREFILL_EVENT, { detail: { text } }));
      }
      return;
    }
    router.push(text ? `/dashboard/chat?prompt=${encodeURIComponent(text)}` : '/dashboard/chat');
  };

  const closeThen = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const flipTheme = closeThen(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'));
  const flipSidebar = closeThen(toggleSidebar);
  const doSignOut = closeThen(() => void signOut({ callbackUrl: '/sign-in' }));

  const routes = DASHBOARD_ROUTES.filter(r => isAdmin || !r.adminOnly);
  const trimmed = query.trim();

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search and commands" description="Jump to a page, ask the agent, or run a command.">
      <CommandInput placeholder="Search pages, or type a question…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>Nothing matches. Press Enter to ask the agent instead.</CommandEmpty>

        {trimmed && (
          <CommandGroup heading="Ask">
            <CommandItem value={`ask ${trimmed}`} onSelect={ask}>
              <Sparkles />
              <span className="truncate">
                Ask the agent:
                {' '}
                <span className="text-foreground/80">{trimmed}</span>
              </span>
              <CommandShortcut>↵</CommandShortcut>
            </CommandItem>
            <CommandItem value={`search knowledge ${trimmed}`} onSelect={() => go(`/dashboard/search?q=${encodeURIComponent(trimmed)}`)}>
              <Search />
              <span className="truncate">
                Search knowledge for
                {' '}
                <span className="text-foreground/80">{trimmed}</span>
              </span>
            </CommandItem>
          </CommandGroup>
        )}

        {GROUP_ORDER.map((group) => {
          const items = routes.filter(r => r.group === group);
          return items.length === 0
            ? null
            : (
                <CommandGroup key={group} heading={group}>
                  {items.map(r => (
                    <CommandItem key={r.url} value={[r.title, ...(r.keywords ?? [])].join(' ')} onSelect={() => go(r.url)}>
                      <r.icon />
                      <span>{r.title}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
        })}

        <CommandSeparator />
        <CommandGroup heading="Commands">
          {!trimmed && (
            <CommandItem value="ask the agent" onSelect={ask}>
              <Sparkles />
              <span>Ask the agent</span>
              <CommandShortcut>⌘J</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem
            value="toggle sidebar"
            onSelect={flipSidebar}
          >
            <PanelLeft />
            <span>Toggle sidebar</span>
            <CommandShortcut>⌘B</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle theme dark light"
            onSelect={flipTheme}
          >
            {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
            <span>{resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
          </CommandItem>
          <CommandItem value="documentation docs help" onSelect={() => go('https://www.vocion.ai/docs')}>
            <BookOpen />
            <span>Open the docs</span>
          </CommandItem>
          <CommandItem
            value="sign out log out"
            onSelect={doSignOut}
          >
            <LogOut />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
