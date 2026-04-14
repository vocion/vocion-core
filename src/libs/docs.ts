import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

const ROOT = resolve(process.cwd());
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
    return a.path.localeCompare(b.path);
  });
}

function includeInKind(rel: string, kind: DocsKind): boolean {
  if (kind === 'all') {
    return true;
  }
  if (kind === 'public') {
    return !isInternalPath(rel) && !rel.startsWith('requirements/');
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
  const abs = resolve(ROOT, path);
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
  if (rel.startsWith('docs/internal/case-studies/')) {
    return 'docs/internal/case-studies';
  }
  if (rel.startsWith('docs/internal/')) {
    return 'docs/internal';
  }
  const first = rel.split('/')[0]!;
  return first;
}

const GROUP_ORDER = ['root', 'docs', 'requirements', 'context', 'docs/internal', 'docs/internal/case-studies'];
function orderOf(group: string): number {
  const idx = GROUP_ORDER.indexOf(group);
  return idx === -1 ? 99 : idx;
}
