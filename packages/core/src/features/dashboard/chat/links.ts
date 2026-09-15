/**
 * In-app links in an agent's answer become chips the person can follow
 * without leaving the page (agent-chat-surface.md §9). The classification
 * here is what the markdown renderer and — later — a `link` card share, so a
 * chip for `/dashboard/agents/revenue-lead` looks the same wherever it shows.
 */

export type DashboardLinkKind
  = 'agent' | 'team' | 'mission' | 'mission-run' | 'ask' | 'briefing' | 'object' | 'review' | 'learning'
    | 'eval' | 'connector' | 'workflow' | 'team-report' | 'chat' | 'page';

export type DashboardLink = {
  /** The path to navigate to (locale prefix stripped, same origin). */
  href: string;
  kind: DashboardLinkKind;
  /** A stable id when the route names one record (the slug or numeric id). */
  id?: string;
};

const RULES: Array<[RegExp, DashboardLinkKind]> = [
  [/^\/dashboard\/agents\/([^/?#]+)/, 'agent'],
  [/^\/dashboard\/teams\/([^/?#]+)/, 'team'],
  [/^\/dashboard\/missions\/runs\/([^/?#]+)/, 'mission-run'],
  [/^\/dashboard\/missions\/(?!new$)([^/?#]+)/, 'mission'],
  [/^\/dashboard\/inbox\/(?:g\/)?([^/?#]+)/, 'ask'],
  [/^\/dashboard\/briefings(?:\/([^/?#]+))?/, 'briefing'],
  [/^\/dashboard\/objects\/(?!type(?:\/|$))([^/?#]+)/, 'object'],
  [/^\/dashboard\/review/, 'review'],
  [/^\/dashboard\/learnings\/([^/?#]+)/, 'learning'],
  [/^\/dashboard\/evals\/([^/?#]+)/, 'eval'],
  [/^\/dashboard\/connectors\/([^/?#]+)/, 'connector'],
  [/^\/dashboard\/workflows\/([^/?#]+)/, 'workflow'],
  [/^\/dashboard\/team-report(?:\/([^/?#]+))?/, 'team-report'],
  [/^\/dashboard\/chat/, 'chat'],
  [/^\/dashboard(?:\/|$)/, 'page'],
];

/**
 * Classify an href the model wrote. Returns null for anything that is not a
 * same-origin dashboard route — those stay ordinary external links.
 * @param href - The raw href from the markdown.
 * @param origin - `window.location.origin` (or a test value) to recognise absolute same-origin URLs.
 */
export function classifyDashboardLink(href: string | undefined, origin?: string): DashboardLink | null {
  if (!href) {
    return null;
  }
  let path = href;
  if (/^https?:\/\//i.test(href)) {
    if (!origin || !href.startsWith(`${origin}/`)) {
      return null;
    }
    path = href.slice(origin.length);
  }
  if (!path.startsWith('/')) {
    return null;
  }
  // Locale prefix (`/en/dashboard/...`) reads the same as the bare route.
  const bare = path.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/)/, '');
  for (const [re, kind] of RULES) {
    const m = bare.match(re);
    if (m) {
      return { href: bare, kind, ...(m[1] ? { id: decodeURIComponent(m[1]) } : {}) };
    }
  }
  return null;
}
