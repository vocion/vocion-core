import { dashboardRoute, humanizeSegment } from '@/features/navigation/dashboardNav';

/**
 * Pure crumb builder for the shell-bar breadcrumb, kept away from React so
 * the parent-tab rule is unit-testable. Registered routes get their registry
 * title; a route that is one TAB of a combined page gets that page inserted
 * before it ("Teams & agents › Agents"); deeper segments (slugs, ids) take
 * the page's own `<title>` when it has one, else a humanised slug.
 */

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
    const registered = dashboardRoute(url);
    if (registered) {
      const owner = registered.tabOf ? dashboardRoute(registered.tabOf) : undefined;
      if (owner) {
        pageCrumbs.push({ url: owner.url, label: owner.title });
      }
      pageCrumbs.push({ url, label: registered.title });
      return;
    }
    const last = i === segments.length - 1;
    const useDocTitle = last && input.docTitle !== '' && input.docTitle !== sectionTitle;
    pageCrumbs.push({ url, label: useDocTitle ? input.docTitle : humanizeSegment(seg) });
  });
  // The workspace leads (ElevenLabs/Vercel): "Revenue Team › Needs you › …".
  // The full-page chat is its own surface, so only the workspace crumb shows there.
  const tail = onChat ? [] : pageCrumbs;
  return input.workspaceName ? [{ url: '/dashboard', label: input.workspaceName }, ...tail] : tail;
}
