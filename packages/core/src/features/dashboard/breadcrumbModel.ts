import { dashboardRoute, humanizeSegment } from '@/features/navigation/dashboardNav';
import { parseRecordKeyParam, recordKeyLabel } from '@/services/inbox/recordKey';

/**
 * Pure crumb builder for the shell-bar breadcrumb, kept away from React so
 * the parent-tab rule is unit-testable. Registered routes get their registry
 * title; a route that is one TAB of a combined page gets that page inserted
 * before it ("Teams & agents › Agents") unless the path already went through
 * it ("Marketplace › Agents for hire"); deeper segments (slugs, ids) take
 * the page's own `<title>` when it has one, else a humanised slug.
 *
 * The decision sheets are the exception the generic rule cannot get right on
 * its own: `/dashboard/inbox/r/<key>` carries an escaped record key, and a
 * crumb reading `email~3Asomeone~40exampl…` is an internal identifier shown
 * to a person (§ *A user-facing error never shows an internal identifier*).
 * The `r` / `g` shim is not a place either, so it is dropped and the key is
 * read back into the record's name.
 */

/** The routing shims under `inbox` that are not places a person can stand. */
const SHEET_SEGMENTS = new Set(['r', 'g']);

/**
 * Route folders that are not places either: `/dashboard/p/<slug>` mounts a
 * workspace page, and `/dashboard/p` alone is a 404 — a crumb reading "P"
 * that leads nowhere (agents.metacto.com, 2026-09-24).
 */
const FOLDER_SEGMENTS = new Set(['p']);

export type Crumb = { url: string; label: string };

export function buildCrumbs(input: { pathname: string; docTitle: string; workspaceName?: string | null }): Crumb[] | null {
  const parts = input.pathname.split('/').filter(Boolean);
  const start = parts.indexOf('dashboard');
  if (start === -1) {
    return null;
  }
  const segments = parts.slice(start + 1);
  const onChat = segments.length === 1 && segments[0] === 'chat';
  if ((segments.length === 0 || onChat) && !input.workspaceName) {
    return null;
  }

  const sectionTitle = humanizeSegment(segments[0] ?? '');
  const pageCrumbs: Crumb[] = [];
  segments.forEach((seg, i) => {
    const url = `/dashboard/${segments.slice(0, i + 1).join('/')}`;
    if (i === 0 && FOLDER_SEGMENTS.has(seg) && segments.length > 1) {
      return;
    }
    if (segments[0] === 'inbox' && i === 1 && SHEET_SEGMENTS.has(seg)) {
      return;
    }
    if (segments[0] === 'inbox' && i === 2 && SHEET_SEGMENTS.has(segments[1] ?? '')) {
      pageCrumbs.push({ url, label: recordKeyLabel(parseRecordKeyParam(seg)) });
      return;
    }
    const registered = dashboardRoute(url);
    if (registered) {
      const owner = registered.tabOf ? dashboardRoute(registered.tabOf) : undefined;
      // A tab whose URL is nested UNDER its owner's (Marketplace › Agents for
      // hire) already walked past the owner on the previous segment, so
      // inserting it again duplicates the crumb AND its React key. Only insert
      // an owner the path did not already pass through.
      if (owner && pageCrumbs[pageCrumbs.length - 1]?.url !== owner.url) {
        pageCrumbs.push({ url: owner.url, label: owner.title });
      }
      pageCrumbs.push({ url, label: registered.title });
      return;
    }
    const last = i === segments.length - 1;
    const useDocTitle = last && input.docTitle !== '' && input.docTitle !== sectionTitle;
    pageCrumbs.push({ url, label: useDocTitle ? input.docTitle : humanizeSegment(seg) });
  });
  // The workspace leads (ElevenLabs/Vercel): "Revenue Team › Review queue › …".
  // The full-page chat is its own surface, so only the workspace crumb shows there.
  const tail = onChat ? [] : pageCrumbs;
  return input.workspaceName ? [{ url: '/dashboard', label: input.workspaceName }, ...tail] : tail;
}
