/**
 * Pure helpers behind the workspace switcher and the Find button — kept out
 * of React so the switch target, the empty-project rule and the hotkey guard
 * are unit-testable.
 */

import { workspaceUrl } from '@/libs/links';

export type SwitcherProject = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  agentCount?: number;
};

/**
 * Where a switch navigates: the workspace entry route for the SAME page
 * (`/w/<slug>/dashboard/inbox?x=1`), prefixed with the locale when it is not
 * the default — exactly what `WorkspaceMenu.switchTo` did, in one place.
 * @param input.slug - Target project slug.
 * @param input.pathname - Locale-stripped current path.
 * @param input.search - Current query string (with or without `?`).
 * @param input.locale - Active locale.
 * @param input.defaultLocale - The routing default (no prefix).
 * @param input
 */
export function workspaceSwitchHref(input: { slug: string; pathname: string; search?: string; locale: string; defaultLocale: string }): string {
  const prefix = input.locale !== input.defaultLocale ? `/${input.locale}` : '';
  const search = input.search ? (input.search.startsWith('?') ? input.search : `?${input.search}`) : '';
  return `${prefix}${workspaceUrl(input.slug, `${input.pathname}${search}`)}`;
}

/** A project with no agents is a seed/empty row — hidden unless asked for. */
export function isEmptyProject(p: SwitcherProject): boolean {
  return (p.agentCount ?? 0) === 0;
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

/** Number of projects hidden by the empty-project rule (for the toggle's label). */
export function countHiddenEmpty(projects: SwitcherProject[], activeId?: string | null): number {
  return projects.filter(p => isEmptyProject(p) && p.id !== activeId).length;
}

/**
 * Whether a bare `F` keypress should open Find (Vercel's rule): only when
 * nothing is being typed into and no modifier is held.
 * @param e - A keyboard-event-like object.
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

/** A stable accent per workspace slug for its avatar initial. */
export function projectAccent(slug: string): string {
  let h = 0;
  for (const ch of slug) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return ACCENTS[h % ACCENTS.length]!;
}
