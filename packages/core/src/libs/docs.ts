import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
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
  /** Display title — frontmatter `title`, falling back to first H1 or the filename. */
  title: string;
  /** Sidebar label — frontmatter `nav_label` if set, else title. */
  navLabel: string;
  /** Sidebar sort key within group — frontmatter `nav_order`, default 100. */
  navOrder: number;
  /** SEO description — frontmatter `description`, falling back to first paragraph. */
  description: string;
  /** Group key for sidebar — `"root"` | `"docs"` | `"requirements"` | `"requirements/metacto"` | `"context"` */
  group: string;
};

/**
 * Parsed frontmatter shape. All fields optional — a missing
 * frontmatter block degrades to "title from H1, description from
 * first paragraph, default nav_order".
 */
type Frontmatter = {
  title?: string;
  description?: string;
  nav_label?: string;
  nav_order?: number;
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
    entries.push(buildEntry('README.md', join(ROOT, 'README.md'), 'root', 'Vocion'));
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
      entries.push(buildEntry(rel, file, groupFor(rel), rel));
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
    // Frontmatter nav_order first, then path-alphabetical as a stable tiebreaker.
    if (a.navOrder !== b.navOrder) {
      return a.navOrder - b.navOrder;
    }
    return a.path.localeCompare(b.path);
  });
}

function buildEntry(rel: string, abs: string, group: string, fallbackTitle: string): DocEntry {
  const { fm, body } = readFrontmatter(abs);
  const titleFromH1 = firstH1(body);
  const title = fm.title?.trim() || titleFromH1 || fallbackTitle;
  const description = fm.description?.trim() || firstParagraph(body) || '';
  return {
    path: rel,
    slug: rel === 'README.md' ? '' : rel.slice(0, -3),
    title,
    navLabel: fm.nav_label?.trim() || title,
    navOrder: typeof fm.nav_order === 'number' ? fm.nav_order : 100,
    description,
    group,
  };
}

function readFrontmatter(abs: string): { fm: Frontmatter; body: string } {
  try {
    const raw = readFileSync(abs, 'utf-8');
    const parsed = matter(raw);
    return { fm: (parsed.data ?? {}) as Frontmatter, body: parsed.content ?? '' };
  } catch {
    return { fm: {}, body: '' };
  }
}

function firstH1(body: string): string | null {
  const match = /^# ([^\n]+)$/m.exec(body);
  return match?.[1]?.trim() ?? null;
}

function firstParagraph(body: string): string | null {
  // Skip the H1 + blank line; capture the first paragraph that isn't
  // a heading or a fenced-code block. Used as the SEO description
  // fallback — keep it short.
  const withoutHeadings = body
    .split('\n')
    .filter(line => !line.startsWith('#') && !line.startsWith('```'))
    .join('\n');
  const para = withoutHeadings.split(/\n\s*\n/).find(p => p.trim().length > 0);
  if (!para) {
    return null;
  }
  const oneLine = para.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}…` : oneLine;
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
export function readDoc(slug: string): { path: string; content: string; frontmatter: Frontmatter } | null {
  const path = slug === '' || slug === 'README' ? 'README.md' : `${slug}.md`;
  const abs = join(ROOT, path);
  if (!abs.startsWith(ROOT)) {
    return null; // path traversal guard
  }
  try {
    const raw = readFileSync(abs, 'utf8');
    const parsed = matter(raw);
    return {
      path,
      content: parsed.content ?? '',
      frontmatter: (parsed.data ?? {}) as Frontmatter,
    };
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

function groupFor(rel: string): string {
  if (GET_STARTED_PATHS.has(rel)) {
    return 'get-started';
  }
  // Roadmap group: the roadmap itself plus the changelog of what's shipped.
  if (rel === 'docs/internal/roadmap.md' || rel === 'docs/internal/changelog.md') {
    return 'roadmap';
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
  // Roadmap viewer order: roadmap (default) + changelog, then use cases,
  // then platform spec. Public-docs groups (concepts/guides/api/reference)
  // are after the roadmap-only block — they're never present in the same
  // listing, so order between the two blocks is informational only.
  'roadmap',
  'docs/internal/use-cases',
  'requirements',
  'docs/concepts',
  'docs/guides',
  'docs/api',
  'docs/reference',
  'root',
  'docs',
  'docs/internal',
];
function orderOf(group: string): number {
  const idx = GROUP_ORDER.indexOf(group);
  return idx === -1 ? 99 : idx;
}
