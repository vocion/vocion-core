import type { DashboardRoute } from '@/features/navigation/dashboardNav';
import { chatHotkeyLabel } from '@/features/dashboard/chat/chatHotkeys';
import { DASHBOARD_GROUPS } from '@/features/navigation/dashboardNav';

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
      .filter(r => r.group === heading && (input.isAdmin || !r.adminOnly))
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
