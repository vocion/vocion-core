/** Shared work pages carry app context in their URL, independently of cookies. */
import { routing } from './I18nRouting';
import { parseWorkspacePath, stripWorkspacePrefix } from './links';

/**
 * Keep explicit destinations and workspace boundaries intact.
 * @param href
 * @param app
 * @param workspace
 */
export function withAppContext(href: string, app: string | null, workspace: string | null): string {
  if (!app || !href.startsWith('/') || href.startsWith('//')) {
    return href;
  }
  const url = new URL(href, 'https://vocion.invalid');
  const targetWorkspace = parseWorkspacePath(url.pathname);
  if (targetWorkspace && targetWorkspace.slug !== workspace) {
    return href;
  }
  const path = appPathname(url.pathname);
  if (!/^\/dashboard\/(?:objects|artifacts|projects|inbox|chat|connectors)(?:\/|$)/.test(path) || url.searchParams.has('app')) {
    return href;
  }
  url.searchParams.set('app', app);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Read app context from this workspace's browser tab, never a foreign referer.
 * @param referer
 * @param workspace
 */
export function appFromReferer(referer: string | null | undefined, workspace: string): string | null {
  if (!referer) {
    return null;
  }
  try {
    const url = new URL(referer);
    return parseWorkspacePath(url.pathname)?.slug === workspace ? url.searchParams.get('app') : null;
  } catch {
    return null;
  }
}

/**
 * Normalize both canonical workspace URLs and locale-prefixed rewritten routes.
 * @param pathname
 */
export function appPathname(pathname: string): string {
  const stripped = stripWorkspacePrefix(pathname);
  const locale = stripped.split('/')[1];
  return locale && (routing.locales as readonly string[]).includes(locale) ? stripped.slice(locale.length + 1) || '/' : stripped;
}
