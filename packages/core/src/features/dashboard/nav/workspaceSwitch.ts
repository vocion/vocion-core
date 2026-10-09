/**
 * Pure helpers behind the workspace switcher and the Find button — kept out
 * of React so the switch target, the empty-project rule and the hotkey guard
 * are unit-testable.
 */

import { WORKSPACE_ACCOUNT_PARAM, WORKSPACE_ORG_PARAM, workspaceUrl } from '@/libs/links';

export type SwitcherProject = {
  id: string;
  /** The account that owns it. Absent in stories that only show one account. */
  accountId?: string;
  slug: string;
  name: string;
  description?: string | null;
  agentCount?: number;
  /** Archived: hidden with the empty ones unless asked for, or unless it is the current one. */
  archived?: boolean;
};

/** An Org (`tenant_account`) the person belongs to, as the switcher labels it. */
export type SwitcherAccount = { id: string; name: string; slug: string };

/** The page a switch to `p` lands on, given the page the person is on. */
export type WorkspaceSwitcherTargetPath = (p: SwitcherProject, pathname: string) => string;

/** One heading's worth of the switcher list. */
export type AccountGroup<T extends SwitcherProject> = { account: SwitcherAccount; projects: T[] };

/**
 * Where a switch navigates: the workspace entry route for the SAME page
 * (`/w/<slug>/dashboard/inbox?x=1`), prefixed with the locale when it is not
 * the default — exactly what `WorkspaceMenu.switchTo` did, in one place.
 *
 * A switch into another Org carries `?org=<slug>`, because a workspace slug
 * is only unique inside an Org and the proxy would otherwise resolve it in
 * the Org the person is leaving. Any `org` (or older `account`) already in the
 * current query string is dropped first, so a hint from an earlier switch
 * never points the next one at the wrong Org. ("Org" is what people call a
 * `tenant_account`; identifiers here still say account.)
 * @param input.slug - Target project slug.
 * @param input.pathname - Locale-stripped current path.
 * @param input.search - Current query string (with or without `?`).
 * @param input.locale - Active locale.
 * @param input.defaultLocale - The routing default (no prefix).
 * @param input.accountSlug - The target's Org slug, only when the switch crosses Orgs.
 * @param input
 */
export function workspaceSwitchHref(input: { slug: string; pathname: string; search?: string; locale: string; defaultLocale: string; accountSlug?: string | null }): string {
  const prefix = input.locale !== input.defaultLocale ? `/${input.locale}` : '';
  const params = new URLSearchParams(input.search ?? '');
  params.delete(WORKSPACE_ACCOUNT_PARAM);
  params.delete(WORKSPACE_ORG_PARAM);
  if (input.accountSlug) {
    params.set(WORKSPACE_ORG_PARAM, input.accountSlug);
  }
  const query = params.toString();
  return `${prefix}${workspaceUrl(input.slug, `${input.pathname}${query ? `?${query}` : ''}`)}`;
}

/**
 * The account slug a switch to `target` must carry, or null when it stays in
 * the account the person is already in (or the account is unknown, as in a
 * single-account story).
 * @param target - The workspace being switched to.
 * @param activeAccountId - The account this session is in.
 * @param accounts - Every account the person belongs to.
 */
export function crossAccountSlug(target: SwitcherProject, activeAccountId: string | null | undefined, accounts: readonly SwitcherAccount[]): string | null {
  if (!target.accountId || target.accountId === activeAccountId) {
    return null;
  }
  return accounts.find(a => a.id === target.accountId)?.slug ?? null;
}

/**
 * The switcher list split under one heading per account, in the order the
 * accounts arrive (oldest membership first). Accounts with no visible
 * workspace are left out, so a search never shows an empty heading.
 * @param projects - The already-filtered workspaces.
 * @param accounts - Every account the person belongs to.
 */
export function groupByAccount<T extends SwitcherProject>(projects: readonly T[], accounts: readonly SwitcherAccount[]): AccountGroup<T>[] {
  const groups: AccountGroup<T>[] = [];
  for (const account of accounts) {
    const inAccount = projects.filter(p => p.accountId === account.id);
    if (inAccount.length > 0) {
      groups.push({ account, projects: inAccount });
    }
  }
  return groups;
}

/**
 * The chip's second line: the account's name, only when it says something
 * the workspace's name does not. A one-workspace account usually shares its
 * name ("Northwind / Northwind"), and the same word twice reads as a glitch.
 * @param workspaceName - The active workspace's name.
 * @param accountName - Its account's name, when there is one.
 */
export function accountLine(workspaceName: string | null | undefined, accountName: string | null | undefined): string | null {
  const account = accountName?.trim();
  if (!account) {
    return null;
  }
  return account.localeCompare((workspaceName ?? '').trim(), undefined, { sensitivity: 'accent' }) === 0 ? null : account;
}

/**
 * A project with no agents is a seed/empty row — hidden unless asked for.
 * An archived one is hidden the same way: nobody works there now.
 * @param p
 */
export function isEmptyProject(p: SwitcherProject): boolean {
  return (p.agentCount ?? 0) === 0 || p.archived === true;
}

/**
 * The switcher's list: filtered by a case-insensitive match on name or slug,
 * empty projects hidden unless `showEmpty`, the active one always kept.
 * @param projects
 * @param opts
 * @param opts.query
 * @param opts.showEmpty
 * @param opts.activeId
 */
export function filterProjects<T extends SwitcherProject>(projects: T[], opts: { query?: string; showEmpty?: boolean; activeId?: string | null }): T[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return projects.filter((p) => {
    if (!opts.showEmpty && isEmptyProject(p) && p.id !== opts.activeId) {
      return false;
    }
    return q === '' || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
  });
}

/**
 * Number of projects hidden by the empty-project rule (for the toggle's label).
 * @param projects
 * @param activeId
 */
export function countHiddenEmpty(projects: SwitcherProject[], activeId?: string | null): number {
  return projects.filter(p => isEmptyProject(p) && p.id !== activeId).length;
}

/**
 * Whether a bare `F` keypress should open Find (Vercel's rule): only when
 * nothing is being typed into and no modifier is held.
 * @param e - A keyboard-event-like object.
 * @param e.key
 * @param e.metaKey
 * @param e.ctrlKey
 * @param e.altKey
 * @param e.defaultPrevented
 * @param e.target
 */
export function shouldTriggerFindHotkey(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null;
}): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) {
    return false;
  }
  if (e.key !== 'f' && e.key !== 'F') {
    return false;
  }
  const t = e.target;
  if (!t) {
    return true;
  }
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) {
    return false;
  }
  if (t.getAttribute?.('role') === 'textbox' || t.getAttribute?.('contenteditable') === 'true') {
    return false;
  }
  return true;
}

const ACCENTS = ['oklch(0.62 0.17 65)', 'oklch(0.58 0.1 187)', 'oklch(0.55 0.15 280)', 'oklch(0.55 0.15 330)', 'oklch(0.55 0.13 145)', 'oklch(0.6 0.15 25)'];

/**
 * A stable accent per workspace slug for its avatar initial.
 * @param slug
 */
export function projectAccent(slug: string): string {
  let h = 0;
  for (const ch of slug) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return ACCENTS[h % ACCENTS.length]!;
}

/**
 * The workspaces in one Org (`tenant_account`), in the order given. A
 * workspace with no Org on it (a story) stays. An extension's Org header
 * reads it to find where picking that Org lands.
 * @param projects - Every workspace the person can open.
 * @param orgId - The Org's `tenant_account.id` (NOT a code `orgId`, which is a workspace).
 */
export function projectsInOrg<T extends SwitcherProject>(projects: readonly T[], orgId: string): T[] {
  return projects.filter(p => !p.accountId || p.accountId === orgId);
}
