/**
 * How the All workspaces page orders what it lists — pure, so the order is
 * tested without a browser (founder, 2026-10-09: "This isn't a great UI").
 *
 * - **Personal first**, on its own, above every Org: it is the person's home.
 * - **Then one group per Org**, in the order the person joined them. A
 *   single-Org install has one group and draws no header for it.
 * - **Inside a group, most recently used first.** A placeholder (a name
 *   recovered from an address, `libs/workspaceName.ts`) and an empty
 *   workspace (no agents, never used) are listed like the rest but never
 *   above a real one.
 * - **Archived ones apart**, behind "Show archived", wherever they belong.
 * - **Search** matches the workspace's name, its Org's name and its lead's.
 */

import type { SwitcherAccount } from './workspaceSwitch';

/** One row as the page reads it (`projects.overview`). */
export type PageWorkspace = {
  id: string;
  accountId: string;
  slug: string;
  name: string;
  kind: 'shared' | 'personal';
  agentCount: number;
  archived?: boolean;
  placeholder?: boolean;
  leadName: string | null;
  lastActiveAt: string | null;
};

export type WorkspaceGroup<T extends PageWorkspace> = { account: SwitcherAccount | null; workspaces: T[] };

export type ArrangedWorkspaces<T extends PageWorkspace> = {
  personal: T[];
  groups: WorkspaceGroup<T>[];
  archived: T[];
};

/** What the order reads off a workspace. */
type Ranked = Pick<PageWorkspace, 'name' | 'placeholder' | 'agentCount' | 'lastActiveAt'>;

/**
 * 0 for a workspace with something in it, 1 for an empty one, 2 for a
 * placeholder: a placeholder someone merely landed on is still not real.
 * @param w - The workspace.
 */
export function emptiness(w: Pick<PageWorkspace, 'placeholder' | 'agentCount' | 'lastActiveAt'>): 0 | 1 | 2 {
  if (w.placeholder) {
    return 2;
  }
  return w.agentCount === 0 && !w.lastActiveAt ? 1 : 0;
}

/**
 * Real before empty, then most recent first, then by name.
 * @param a - A workspace.
 * @param b - Another.
 */
export function byRecentUse(a: Ranked, b: Ranked): number {
  const empty = emptiness(a) - emptiness(b);
  if (empty !== 0) {
    return empty;
  }
  const at = (b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0) - (a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0);
  return at !== 0 ? at : a.name.localeCompare(b.name);
}

/**
 * Whether a workspace matches what was typed: its name, its Org's, its lead's.
 * @param w - The workspace.
 * @param query - What was typed.
 * @param orgName - Its Org's name.
 */
export function matches(w: PageWorkspace, query: string, orgName: string | undefined): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  return [w.name, orgName ?? '', w.leadName ?? ''].some(s => s.toLowerCase().includes(q));
}

/**
 * The page's sections.
 * @param workspaces - Everything `projects.overview` returned.
 * @param opts - How to arrange them.
 * @param opts.accounts - The person's Orgs, oldest membership first.
 * @param opts.multiOrg - Whether to group by Org at all.
 * @param opts.query - The search box.
 */
export function arrangeWorkspaces<T extends PageWorkspace>(workspaces: readonly T[], opts: { accounts: readonly SwitcherAccount[]; multiOrg: boolean; query?: string }): ArrangedWorkspaces<T> {
  const orgName = new Map(opts.accounts.map(a => [a.id, a.name]));
  const found = workspaces.filter(w => matches(w, opts.query ?? '', orgName.get(w.accountId)));
  const live = found.filter(w => !w.archived);
  const personal = live.filter(w => w.kind === 'personal').sort(byRecentUse);
  const shared = live.filter(w => w.kind !== 'personal');
  const groups: WorkspaceGroup<T>[] = [];
  if (opts.multiOrg && opts.accounts.length > 1) {
    for (const account of opts.accounts) {
      const inOrg = shared.filter(w => w.accountId === account.id).sort(byRecentUse);
      if (inOrg.length > 0) {
        groups.push({ account, workspaces: inOrg });
      }
    }
    const known = new Set(opts.accounts.map(a => a.id));
    const stray = shared.filter(w => !known.has(w.accountId)).sort(byRecentUse);
    if (stray.length > 0) {
      groups.push({ account: null, workspaces: stray });
    }
  } else if (shared.length > 0) {
    groups.push({ account: null, workspaces: [...shared].sort(byRecentUse) });
  }
  return { personal, groups, archived: found.filter(w => w.archived).sort(byRecentUse) };
}

/**
 * The one quiet line under a name: "Atlas · 7 agents · active 2h ago". A
 * missing fact leaves no separator; a workspace with nothing says "Empty".
 * @param w - The workspace.
 * @param words - The translated pieces.
 * @param words.agents - "7 agents".
 * @param words.active - "active 2h ago", or null when never used.
 * @param words.empty - "Empty".
 */
export function rowLine(w: Pick<PageWorkspace, 'leadName' | 'agentCount'>, words: { agents: string | null; active: string | null; empty: string }): string {
  const parts = [w.leadName, w.agentCount > 0 ? words.agents : null, words.active].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : words.empty;
}
