import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { getRepoRoot } from './repo-root';

/**
 * Static markdown discovery for the in-product docs viewer.
 *
 * The viewer pulls from three roots:
 *   - `/README.md` (root)
 *   - `/docs/**.md`
 *   - `/requirements/**.md`
 *
 * All paths are repo-relative. The viewer turns these into URL slugs by
 * stripping `.md` — e.g. `docs/mcp.md` → `/dashboard/docs/docs/mcp`.
 * The root README is served at `/dashboard/docs` (no slug).
 */

const ROOT = getRepoRoot();
const ROOTS = ['docs', 'requirements', 'context'];

export type DocEntry = {
  /** Repo-relative path, no leading slash. e.g. `docs/mcp.md`, `README.md` */
  path: string;
  /** URL slug (path minus `.md`). e.g. `docs/mcp`, `README`. Empty string for root README. */
  slug: string;
  /** Display title (first H1 or the filename) */
  title: string;
  /** Group key for sidebar — `"root"` | `"docs"` | `"requirements"` | `"requirements/metacto"` | `"context"` */
  group: string;
};

/**
 * `kind` controls which slice of docs the viewer shows:
 *
 *   - `public`   — dev-consumable docs only: `docs/*` (excluding `internal/`)
 *                  + `context/*`. Used by the public `/docs` site and the
 *                  in-app Docs link in the dashboard footer.
 *
 *   - `roadmap`  — internal/strategy view: `docs/internal/*` (roadmap,
 *                  progress, case studies, MetaCTO ops) + `requirements/*`
 *                  (architecture, object model, RBAC, etc — platform spec).
 *                  Used by the in-app Roadmap link.
 *
 *   - `all`      — everything. Default for backwards compat; not currently
 *                  routed to.
 */
type DocsKind = 'public' | 'roadmap' | 'all';

/**
 * Three entry-point docs are consolidated into a single "Get started"
 * block at the top of the sidebar: the repo README (what is Vocion),
 * the docs index (how these docs are organized), and the quickstart
 * (zero → first skill run in 10 min). Order is preserved via
 * GET_STARTED_PRIORITY.
 */
const GET_STARTED_PATHS = new Set([
  'README.md',
  'docs/README.md',
  'docs/guides/quickstart.md',
]);

const GET_STARTED_PRIORITY: Record<string, number> = {
  'README.md': 0,
  'docs/README.md': 1,
  'docs/guides/quickstart.md': 2,
};

export function listDocs(opts: { kind?: DocsKind; publicOnly?: boolean } = {}): DocEntry[] {
  const kind: DocsKind = opts.kind ?? (opts.publicOnly ? 'public' : 'all');

  const entries: DocEntry[] = [];
  if (kind === 'public' || kind === 'all') {
    entries.push({
      path: 'README.md',
      slug: '',
      title: readTitle(join(ROOT, 'README.md'), 'CoreContext'),
      group: 'root',
    });
  }

  for (const root of ROOTS) {
    const abs = join(ROOT, root);
    for (const file of walk(abs)) {
      if (!file.endsWith('.md') || file.includes('node_modules')) {
        continue;
      }
      const rel = relative(ROOT, file);
      if (!includeInKind(rel, kind)) {
        continue;
      }
      entries.push({
        path: rel,
        slug: rel.slice(0, -3), // strip .md
        title: readTitle(file, rel),
        group: groupFor(rel),
      });
    }
  }

  return entries.sort((a, b) => {
    if (a.group !== b.group) {
      return orderOf(a.group) - orderOf(b.group);
    }
    // 'get-started' entries have a hand-picked ordering so they read
    // "Vocion → Docs overview → Quickstart" regardless of path sort.
    if (a.group === 'get-started') {
      return (GET_STARTED_PRIORITY[a.path] ?? 99) - (GET_STARTED_PRIORITY[b.path] ?? 99);
    }
    return a.path.localeCompare(b.path);
  });
}

function includeInKind(rel: string, kind: DocsKind): boolean {
  if (kind === 'all') {
    return true;
  }
  if (kind === 'public') {
    // Public docs viewer only surfaces docs/ content (excluding internal/).
    // requirements/ is platform spec; context/ is tenant-owned prompt content.
    return !isInternalPath(rel) && !rel.startsWith('requirements/') && !rel.startsWith('context/');
  }
  return isInternalPath(rel) || rel.startsWith('requirements/');
}

/**
 * Is a doc path considered internal (MetaCTO-only) and therefore hidden from
 * the public `/docs` site? Rule: anything under `docs/internal/`.
 * @param relPath
 */
export function isInternalPath(relPath: string): boolean {
  return relPath.startsWith('docs/internal/');
}

/**
 * Roadmap = internal docs + requirements/ specs.
 * @param relPath
 */
export function isRoadmapPath(relPath: string): boolean {
  return isInternalPath(relPath) || relPath.startsWith('requirements/');
}

/**
 * Read the body of a doc by slug. Returns null if not found or outside ROOT.
 * @param slug
 */
export function readDoc(slug: string): { path: string; content: string } | null {
  const path = slug === '' || slug === 'README' ? 'README.md' : `${slug}.md`;
  const abs = join(ROOT, path);
  if (!abs.startsWith(ROOT)) {
    return null; // path traversal guard
  }
  try {
    const content = readFileSync(abs, 'utf8');
    return { path, content };
  } catch {
    return null;
  }
}

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.startsWith('.') || e === 'node_modules' || e === 'onyx-repo') {
      continue;
    }
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function readTitle(abs: string, fallback: string): string {
  try {
    const content = readFileSync(abs, 'utf8');
    const match = /^# ([^\n]+)$/m.exec(content);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch { /* fall through */ }
  return fallback;
}

function groupFor(rel: string): string {
  if (GET_STARTED_PATHS.has(rel)) {
    return 'get-started';
  }
  // Per-agent case-study subgroups
  if (rel.startsWith('docs/internal/use-cases/case-studies/ziggy/')) {
    return 'docs/internal/use-cases/case-studies/ziggy';
  }
  if (rel.startsWith('docs/internal/use-cases/case-studies/algren/')) {
    return 'docs/internal/use-cases/case-studies/algren';
  }
  if (rel.startsWith('docs/internal/use-cases/case-studies/')) {
    return 'docs/internal/use-cases/case-studies';
  }
  if (rel.startsWith('docs/internal/use-cases/')) {
    return 'docs/internal/use-cases';
  }
  if (rel.startsWith('docs/internal/')) {
    return 'docs/internal';
  }
  // Finer grouping within docs/ so Concepts / Guides / API / Reference
  // each get their own sidebar section instead of one flat blob.
  if (rel.startsWith('docs/concepts/')) {
    return 'docs/concepts';
  }
  if (rel.startsWith('docs/guides/')) {
    return 'docs/guides';
  }
  if (rel.startsWith('docs/api/')) {
    return 'docs/api';
  }
  if (rel.startsWith('docs/reference/')) {
    return 'docs/reference';
  }
  const first = rel.split('/')[0]!;
  return first;
}

const GROUP_ORDER = [
  'get-started',
  'docs/concepts',
  'docs/guides',
  'docs/api',
  'docs/reference',
  'root',
  'docs',
  'requirements',
  'docs/internal',
  'docs/internal/use-cases',
  'docs/internal/use-cases/case-studies',
  'docs/internal/use-cases/case-studies/ziggy',
  'docs/internal/use-cases/case-studies/algren',
];
function orderOf(group: string): number {
  const idx = GROUP_ORDER.indexOf(group);
  return idx === -1 ? 99 : idx;
}
