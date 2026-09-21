import type { DashboardRoute } from '@/features/navigation/dashboardNav';
import { chatHotkeyLabel } from '@/features/dashboard/chat/chatHotkeys';
import { DASHBOARD_GROUPS, routeVisible } from '@/features/navigation/dashboardNav';

/**
 * Pure model for the ⌘K palette — what the dialog renders, computed away
 * from React so it can be unit-tested. cmdk does its own fuzzy filtering
 * over `value`; this module decides WHICH rows exist and in what order.
 */

export type PaletteEntity = { slug: string; name: string; description?: string };
export type PaletteConversation = { id: number; title: string; agentSlug: string };

export type PaletteRow = {
  /** Stable key + the string cmdk filters on. */
  value: string;
  label: string;
  hint?: string;
  kind: 'route' | 'agent' | 'team' | 'mission' | 'conversation' | 'action' | 'ask';
  /** Navigation target, when the row is a link. */
  url?: string;
  /** Named action, when the row runs something instead. */
  action?: 'ask' | 'new-conversation' | 'all-conversations' | 'open-rail' | 'toggle-sidebar' | 'toggle-theme' | 'docs' | 'sign-out';
  shortcut?: string;
};

export type PaletteGroup = { heading: string; rows: PaletteRow[] };

/** Page headings in registry order — the same order the sidebar's MANAGE view uses, with You (Profile) last. */
export const ROUTE_GROUP_ORDER: readonly string[] = DASHBOARD_GROUPS.map(g => g.title);

export function buildPaletteGroups(input: {
  query: string;
  routes: readonly DashboardRoute[];
  isAdmin: boolean;
  /** Plugins the workspace turned on; a plugin-owned route hides while its plugin is off. Omit = no plugin gating. */
  enabledPlugins?: readonly string[];
  agents?: PaletteEntity[];
  teams?: PaletteEntity[];
  missions?: PaletteEntity[];
  conversations?: PaletteConversation[];
  themeIsDark?: boolean;
}): PaletteGroup[] {
  const q = input.query.trim();
  const groups: PaletteGroup[] = [];

  if (q) {
    groups.push({
      heading: 'Ask',
      rows: [
        { value: `ask ${q}`, label: `Ask Vocion: ${q}`, kind: 'ask', action: 'ask', shortcut: '↵' },
        { value: `search knowledge ${q}`, label: `Search knowledge for “${q}”`, kind: 'route', url: `/dashboard/search?q=${encodeURIComponent(q)}` },
      ],
    });
  }

  for (const heading of ROUTE_GROUP_ORDER) {
    const rows = input.routes
      .filter(r => r.group === heading && routeVisible(r, { isAdmin: input.isAdmin, enabledPlugins: input.enabledPlugins }))
      .map<PaletteRow>(r => ({
        value: [r.title, ...(r.keywords ?? [])].join(' '),
        label: r.title,
        // A tab names the page it sits on ("Agents · Teams & agents").
        hint: r.tabOf ? input.routes.find(o => o.url === r.tabOf)?.title : undefined,
        kind: 'route',
        url: r.url,
        // The chat page has a key of its own (`chatHotkeys.ts`).
        ...(r.url === '/dashboard/chat' ? { shortcut: chatHotkeyLabel('go-to-chat') } : {}),
      }));
    if (rows.length > 0) {
      groups.push({ heading, rows });
    }
  }

  const entity = (heading: string, kind: PaletteRow['kind'], items: PaletteEntity[] | undefined, urlFor: (slug: string) => string) => {
    if (!items || items.length === 0) {
      return;
    }
    groups.push({
      heading,
      rows: items.map(i => ({ value: `${heading} ${i.name} ${i.slug}`, label: i.name, hint: i.description, kind, url: urlFor(i.slug) })),
    });
  };
  entity('Agents', 'agent', input.agents, s => `/dashboard/agents/${s}`);
  entity('Teams', 'team', input.teams, s => `/dashboard/teams/${s}`);
  entity('Missions', 'mission', input.missions, s => `/dashboard/missions/${s}`);

  if (input.conversations && input.conversations.length > 0) {
    groups.push({
      heading: 'Recent conversations',
      rows: input.conversations.slice(0, 8).map(c => ({
        value: `conversation ${c.title}`,
        label: c.title,
        hint: c.agentSlug,
        kind: 'conversation',
        url: `/dashboard/chat?conversation=${c.id}&agent=${encodeURIComponent(c.agentSlug)}`,
      })),
    });
  }

  groups.push({
    heading: 'Commands',
    rows: [
      ...(q ? [] : [{ value: 'ask vocion agent', label: 'Ask Vocion', kind: 'action', action: 'ask', shortcut: '⌘J' } satisfies PaletteRow]),
      { value: 'new conversation chat clear', label: 'New chat', kind: 'action', action: 'new-conversation', shortcut: chatHotkeyLabel('new-chat') },
      { value: 'all conversations history threads list chats', label: 'All conversations', kind: 'action', action: 'all-conversations', url: '/dashboard/conversations', shortcut: chatHotkeyLabel('all-conversations') },
      { value: 'open the rail conversation', label: 'Open the rail', kind: 'action', action: 'open-rail', shortcut: '⌘J' },
      { value: 'toggle sidebar', label: 'Toggle sidebar', kind: 'action', action: 'toggle-sidebar', shortcut: '⌘B' },
      { value: 'toggle theme dark light', label: input.themeIsDark ? 'Switch to light theme' : 'Switch to dark theme', kind: 'action', action: 'toggle-theme' },
      { value: 'documentation docs help', label: 'Open the docs', kind: 'action', action: 'docs' },
      { value: 'sign out log out', label: 'Sign out', kind: 'action', action: 'sign-out' },
    ],
  });

  return groups;
}

/**
 * How the palette ranks a row against what was typed — replaces cmdk's fuzzy
 * score, which put "Ask Vocion: Cha" and "Search knowledge for Cha" above the
 * Chat page for the query "Cha" (Chris, 2026-09-18: "the Chat isn't the first
 * result to hit enter. It should be."). A page whose name starts with the
 * query outranks everything; a word-start match next; a substring after that;
 * the two free-text rows (Ask, Search knowledge) sit at a fixed low score so
 * they are always there but never first when a real row matches.
 * @param value - The row's `value` (title plus keywords).
 * @param search - What the person typed.
 * @returns 0 hides the row; higher sorts earlier.
 */
export function paletteFilter(value: string, search: string): number {
  const q = search.trim().toLowerCase();
  if (!q) {
    return 1;
  }
  const v = value.toLowerCase();
  if (v.startsWith('ask ') || v.startsWith('search knowledge ')) {
    return 0.5;
  }
  if (v.startsWith(q)) {
    return 1;
  }
  if (v.split(/\s+/).some(w => w.startsWith(q))) {
    return 0.9;
  }
  return v.includes(q) ? 0.6 : 0;
}
