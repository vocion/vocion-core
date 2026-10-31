/**
 * In-app links in an agent's answer become chips the person can follow
 * without leaving the page (agent-chat-surface.md §9). The classification
 * here is what the markdown renderer and — later — a `link` card share, so a
 * chip for `/dashboard/agents/revenue-lead` looks the same wherever it shows.
 */

export type DashboardLinkKind
  = 'agent' | 'team' | 'mission' | 'mission-run' | 'ask' | 'briefing' | 'object' | 'room' | 'goal' | 'review' | 'learning'
    | 'eval' | 'connector' | 'workflow' | 'team-report' | 'chat' | 'browser' | 'routine' | 'routine-batch' | 'artifact' | 'page';

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
  [/^\/dashboard\/inbox\/proposal-(\d+)/, 'review'],
  [/^\/dashboard\/inbox\?kind=proposal/, 'review'],
  [/^\/dashboard\/inbox\/(?:g\/)?([^/?#]+)/, 'ask'],
  [/^\/dashboard\/briefings(?:\/([^/?#]+))?/, 'briefing'],
  [/^\/dashboard\/objects\/(?!type(?:\/|$))([^/?#]+)/, 'object'],
  // A record at the page its type opens it at (`/dashboard/p/feature/214`).
  [/^\/dashboard\/p\/[\w-]+\/(\d+)(?:[/?#]|$)/, 'object'],
  [/^\/dashboard\/(?:projects|rooms)\/(\d+)/, 'room'],
  [/^\/dashboard\/goals\/(\d+)/, 'goal'],
  [/^\/dashboard\/review/, 'review'],
  [/^\/dashboard\/learnings\/([^/?#]+)/, 'learning'],
  [/^\/dashboard\/evals\/([^/?#]+)/, 'eval'],
  [/^\/dashboard\/connectors\/([^/?#]+)/, 'connector'],
  [/^\/dashboard\/workflows\/([^/?#]+)/, 'workflow'],
  [/^\/dashboard\/team-report(?:\/([^/?#]+))?/, 'team-report'],
  [/^\/dashboard\/chat/, 'chat'],
  [/^\/dashboard\/browser\/(\d+)/, 'browser'],
  [/^\/dashboard\/(?:routines|automations)\/batches\/(\d+)/, 'routine-batch'],
  [/^\/dashboard\/(?:routines|automations)\/(\d+)/, 'routine'],
  // An artifact, at its own page or its full-screen view.
  [/^\/dashboard\/artifacts\/(\d+)(?:\/open)?(?:[/?#]|$)/, 'artifact'],
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
  const local = path.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/)/, '');
  // So does the workspace prefix (`/w/<slug>/dashboard/...`), which is how
  // every record link is written (`workspaceUrl`). It is matched without it
  // and navigates with it, so the link still names its workspace. Before
  // 2026-10-23 a workspace link matched nothing and opened in a new tab.
  const bare = local.replace(/^\/w\/[^/?#]+(?=\/dashboard(?:[/?#]|$))/, '');
  for (const [re, kind] of RULES) {
    const m = bare.match(re);
    if (m) {
      return { href: local, kind, ...(m[1] ? { id: decodeURIComponent(m[1]) } : {}) };
    }
  }
  return null;
}

/**
 * The record a chip can PEEK instead of navigating to — a project opens in
 * the preview pane on a plain click (⌘-click still navigates), because the
 * conversation is where the person is reading. Only kinds with a preview
 * resolver; everything else navigates as before.
 * @param link - A classified dashboard link.
 */
export function previewRefFor(link: DashboardLink): { type: 'object' | 'record_history' | 'goal' | 'browser_run' | 'routine' | 'routine_batch' | 'artifact'; id: string } | null {
  // A version in a record's history (`libs/versions/versionRef.ts`): the
  // "Changed …" line peeks the history at that version beside the chat.
  const history = /[?&]preview=record_history(?::|%3A)([\d@%]+)(?:&|#|$)/i.exec(link.href);
  if (history) {
    return { type: 'record_history', id: decodeURIComponent(history[1]!) };
  }
  // A goal peeks too: on a phone its page took the whole screen (2026-10-10).
  if (link.kind === 'goal' && link.id) {
    return { type: 'goal', id: link.id };
  }
  // A browser run peeks: the pane is where it is watched, approved and read.
  if (link.kind === 'browser' && link.id) {
    return { type: 'browser_run', id: link.id };
  }
  // A routine and its batch peek too: the pane is where it is reviewed, run and watched.
  if (link.kind === 'routine' && link.id) {
    return { type: 'routine', id: link.id };
  }
  if (link.kind === 'routine-batch' && link.id) {
    return { type: 'routine_batch', id: link.id };
  }
  // An artifact opens in the pane as itself (2026-10-23: one pane for everything).
  if (link.kind === 'artifact' && link.id) {
    return { type: 'artifact', id: link.id };
  }
  // Any record peeks, whatever its type: an inline reference in an answer
  // opens beside the conversation, where its verbs are (Chris, 2026-10-23).
  return (link.kind === 'room' || link.kind === 'object') && link.id ? { type: 'object', id: link.id } : null;
}

/**
 * Whether a click is the plain one a peek takes over: the primary button with
 * no modifier. ⌘ / Ctrl / Shift / Alt and the middle button are the browser's
 * own (a new tab, a new window, a download), and stay so.
 * @param e - The click.
 * @param e.button - Which button.
 * @param e.metaKey - ⌘ held.
 * @param e.ctrlKey - Ctrl held.
 * @param e.shiftKey - Shift held.
 * @param e.altKey - Alt held.
 */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** The smallest shape of a markdown tree node {@link remarkLinkAppPaths} needs. */
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

/**
 * An in-app path written as text: `/dashboard/…`, or a workspace's
 * `/w/<slug>/dashboard/…`, starting a word. A link's own text and code
 * fences are never read (the plugin skips them).
 */
const APP_PATH = /(^|[\s([{"'“‘])((?:\/w\/[\w-]+)?\/dashboard(?:[/?#][^\s)\]}<>"'`“”‘’]*)?)/g;

/** What a sentence may end a path with that is not part of it. */
const TRAILING = /[.,;:!?]+$/;

/**
 * A readable name for an in-app path: "/dashboard/p/seo-pages?batch=506" →
 * "Seo pages · batch 506". The route's words, never a lookup.
 * @param path - The path as written.
 */
export function appPathLabel(path: string): string {
  const [route = '', query = ''] = path.replace(/^\/w\/[^/?#]+/, '').replace(/#.*$/, '').split('?');
  const words = route.replace(/^\/dashboard/, '').split('/').filter(seg => seg && seg !== 'p').map((seg) => {
    try {
      return decodeURIComponent(seg).replace(/[-_]+/g, ' ');
    } catch {
      return seg;
    }
  });
  const base = words.join(' › ') || 'Dashboard';
  const params = [...new URLSearchParams(query).entries()].filter(([k]) => k !== 'preview').map(([k, v]) => `${k.replace(/[-_]+/g, ' ')} ${v}`.trim());
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}${params.length > 0 ? ` · ${params.join(', ')}` : ''}`;
}

/**
 * Split a text node at the in-app paths in it, each one a link.
 * @param value - The text.
 */
function splitAtPaths(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(APP_PATH)) {
    const raw = m[2]!;
    const path = raw.replace(TRAILING, '');
    const start = m.index! + m[1]!.length;
    if (start > last) {
      out.push({ type: 'text', value: value.slice(last, start) });
    }
    out.push({ type: 'link', url: path, children: [{ type: 'text', value: appPathLabel(path) }] });
    last = start + path.length;
  }
  if (out.length === 0) {
    return [{ type: 'text', value }];
  }
  if (last < value.length) {
    out.push({ type: 'text', value: value.slice(last) });
  }
  return out;
}

/**
 * Turn every in-app path an agent wrote as text into a link, at any depth.
 * Inline code holding nothing but a path is a link too; a fenced block and a
 * link's own text are left alone.
 * @param node - The tree, or a branch of it.
 */
export function linkAppPaths(node: MdNode): void {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') {
    return;
  }
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') {
      return splitAtPaths(child.value);
    }
    if (child.type === 'inlineCode' && typeof child.value === 'string') {
      const path = child.value.trim();
      APP_PATH.lastIndex = 0;
      const m = APP_PATH.exec(path);
      APP_PATH.lastIndex = 0;
      if (m && m.index === 0 && m[1] === '' && m[2] === path) {
        return [{ type: 'link', url: path, children: [{ type: 'text', value: appPathLabel(path) }] }];
      }
      return [child];
    }
    linkAppPaths(child);
    return [child];
  });
}

/**
 * The remark plugin: an in-app path in an answer ("/dashboard/p/seo-pages?batch=506")
 * renders as the link it names, which the renderer draws as an in-app chip.
 * 2026-10-29: agents wrote raw paths as text, and nobody could follow them.
 */
export function remarkLinkAppPaths() {
  return (tree: MdNode) => {
    linkAppPaths(tree);
  };
}
