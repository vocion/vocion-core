import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Workspace pages — tenant-defined dashboard pages, declared entirely inside
 * the workspace directory (`WORKSPACE_PATH/pages/<slug>.yaml`, with optional
 * sibling `<slug>.md` prose and optional custom React widgets in
 * `pages/components/registry.tsx`).
 *
 * A page never introduces a new data model. Each page is a *derivative of a
 * core page archetype* — today `list` (the objects/type/[slug] shape),
 * `queue` (the review shape, read-only, linking into /dashboard/review for
 * decisions) or `markdown` (the docs shape) — configured over data core
 * already owns: business objects, skill runs, or knowledge documents.
 *
 * Pages are file-only: nothing is written to the database, `workspace:apply`
 * does not need to know about them, and deleting the YAML deletes the page.
 * They render at `/dashboard/p/<slug>` and are listed in the sidebar under
 * their `nav.section` (default "Workspace").
 */

const SlugSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, {
  message: 'slug must be lowercase alphanumeric with dashes/underscores',
});

/**
 * Where a field's value comes from. Dot-paths resolve into `metadata` for
 * objects, parsed `output` for skill runs, and parsed `body` for documents.
 */
const FieldSchema = z.object({
  /** Column key; also the default accessor when `from` is omitted. */
  key: z.string(),
  label: z.string().optional(),
  /** Accessor: `title` | `status` | `createdAt` | `meta.<dot.path>` */
  from: z.string().optional(),
  format: z.enum(['text', 'badge', 'score', 'date', 'mono']).default('text'),
  /** For `format: badge` — map raw value → status-pill tone. */
  tones: z.record(z.string(), z.enum(['ok', 'warn', 'bad', 'info', 'muted'])).optional(),
});

const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gte', 'lte', 'in', 'exists']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

const StatSchema = z.object({
  label: z.string(),
  kind: z.enum(['count', 'avg', 'min', 'max', 'pctGte', 'countWhere']),
  /** Field the stat computes over (same accessor grammar as FieldSchema.from). */
  field: z.string().optional(),
  threshold: z.number().optional(),
  where: FilterSchema.optional(),
  /** Optional suffix, e.g. "%" or "applicants". */
  suffix: z.string().optional(),
});

const WidgetSchema = z.object({
  /** Name exported from the workspace's pages/components/registry.tsx. */
  component: z.string(),
  title: z.string().optional(),
  position: z.enum(['above', 'below']).default('below'),
  /** Static props passed through to the component. */
  props: z.record(z.string(), z.unknown()).optional(),
  /** Also pass the page's queried rows / computed stats as props. */
  data: z.array(z.enum(['rows', 'stats'])).default([]),
});

const ListSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('objects'), objectType: SlugSchema }),
  z.object({
    kind: z.literal('skillRuns'),
    skills: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
  z.object({ kind: z.literal('documents'), source: SlugSchema, limit: z.number().int().positive().max(500).default(100) }),
  z.object({ kind: z.literal('agents'), active: z.boolean().optional() }),
]);

export const PageManifestSchema = z.object({
  slug: SlugSchema,
  title: z.string(),
  description: z.string().optional(),
  /** Lucide icon name (best-effort — unknown names fall back). */
  icon: z.string().optional(),
  nav: z.object({
    section: z.string().default('Workspace'),
    order: z.number().default(0),
    hidden: z.boolean().default(false),
  }).default({ section: 'Workspace', order: 0, hidden: false }),
  archetype: z.enum(['list', 'queue', 'markdown']),

  // ---- list / queue config ----
  source: ListSourceSchema.optional(),
  fields: z.array(FieldSchema).optional(),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.string().optional(),
  sort: z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  stats: z.array(StatSchema).optional(),
  /** Row click-through, e.g. `/dashboard/objects/{id}`. `{id}` interpolates. */
  rowLink: z.string().optional(),

  // ---- review embed (any archetype) ----
  /**
   * Embed the core review queue on this page, scoped to these skills (and
   * optionally paused workflow runs). Same skill_run/workflow_run items,
   * same approve/decline services as /dashboard/review — one queue. The
   * `queue` archetype gets this implicitly from its source when omitted.
   */
  review: z.object({
    skills: z.array(z.string()).optional(),
    workflows: z.boolean().default(false),
    heading: z.string().default('Waiting on a person'),
  }).optional(),

  // ---- markdown config ----
  /** Relative md file; defaults to `<slug>.md` next to the yaml. */
  contentFile: z.string().optional(),

  widgets: z.array(WidgetSchema).default([]),
});

export type PageManifest = z.infer<typeof PageManifestSchema>;
export type PageField = z.infer<typeof FieldSchema>;
export type PageStat = z.infer<typeof StatSchema>;
export type PageWidget = z.infer<typeof WidgetSchema>;

function workspaceDir(): string | null {
  const p = process.env.WORKSPACE_PATH ?? process.env.CONTEXT_PATH ?? null;
  return p && existsSync(p) ? p : null;
}

export function workspacePagesDir(): string | null {
  const ws = workspaceDir();
  if (!ws) {
    return null;
  }
  const dir = join(ws, 'pages');
  return existsSync(dir) ? dir : null;
}

export type PageLoadIssue = { file: string; message: string };

/**
 * Read + validate every page manifest in the workspace. Invalid files are
 * skipped and reported — a broken page never takes the dashboard down.
 */
export function readWorkspacePages(): { pages: PageManifest[]; issues: PageLoadIssue[] } {
  const dir = workspacePagesDir();
  if (!dir) {
    return { pages: [], issues: [] };
  }
  const pages: PageManifest[] = [];
  const issues: PageLoadIssue[] = [];
  for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort()) {
    try {
      const raw = parseYaml(readFileSync(join(dir, f), 'utf8'));
      const result = PageManifestSchema.safeParse(raw);
      if (!result.success) {
        issues.push({ file: f, message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
        continue;
      }
      pages.push(result.data);
    } catch (e) {
      issues.push({ file: f, message: e instanceof Error ? e.message : String(e) });
    }
  }
  pages.sort((a, b) => a.nav.order - b.nav.order || a.title.localeCompare(b.title));
  return { pages, issues };
}

export function readWorkspacePage(slug: string): PageManifest | null {
  return readWorkspacePages().pages.find(p => p.slug === slug) ?? null;
}

/**
 * Markdown content for a `markdown` archetype page (or a list page's intro).
 * @param manifest
 */
export function readWorkspacePageContent(manifest: PageManifest): string | null {
  const dir = workspacePagesDir();
  if (!dir) {
    return null;
  }
  const file = join(dir, manifest.contentFile ?? `${manifest.slug}.md`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

// ---------------------------------------------------------------------------
// Accessors + computation shared by the renderer
// ---------------------------------------------------------------------------

export type PageRow = {
  id: string | number;
  title: string;
  status: string | null;
  createdAt: Date | null;
  meta: Record<string, unknown>;
};

export function resolveField(row: PageRow, from: string): unknown {
  if (from === 'title') {
    return row.title;
  }
  if (from === 'status') {
    return row.status;
  }
  if (from === 'createdAt') {
    return row.createdAt;
  }
  if (from === 'id') {
    return row.id;
  }
  const path = from.startsWith('meta.') ? from.slice(5) : from;
  let cur: unknown = row.meta;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function applyFilter(rows: PageRow[], filters: z.infer<typeof FilterSchema>[] | undefined): PageRow[] {
  if (!filters?.length) {
    return rows;
  }
  return rows.filter(r => filters.every((f) => {
    const v = resolveField(r, f.field);
    switch (f.op) {
      case 'eq': return v === f.value;
      case 'neq': return v !== f.value;
      case 'gte': return typeof v === 'number' && typeof f.value === 'number' && v >= f.value;
      case 'lte': return typeof v === 'number' && typeof f.value === 'number' && v <= f.value;
      case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v as never);
      case 'exists': return v !== undefined && v !== null && v !== '';
      default: return true;
    }
  }));
}

export function computeStat(rows: PageRow[], stat: PageStat): string {
  const pool = stat.where ? applyFilter(rows, [stat.where]) : rows;
  const nums = stat.field
    ? pool.map(r => resolveField(r, stat.field!)).filter((v): v is number => typeof v === 'number')
    : [];
  let value: number;
  switch (stat.kind) {
    case 'count':
    case 'countWhere':
      value = pool.length;
      break;
    case 'avg':
      value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      break;
    case 'min':
      value = nums.length ? Math.min(...nums) : 0;
      break;
    case 'max':
      value = nums.length ? Math.max(...nums) : 0;
      break;
    case 'pctGte': {
      const t = stat.threshold ?? 0;
      value = nums.length ? (nums.filter(n => n >= t).length / nums.length) * 100 : 0;
      break;
    }
    default:
      value = 0;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded}${stat.suffix ?? ''}`;
}
