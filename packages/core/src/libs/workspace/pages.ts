import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { enabledPluginsFromWorkspaceDir } from '@/libs/workspace/plugins';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

/**
 * Workspace pages — tenant-defined dashboard pages, declared entirely inside
 * the workspace directory (`WORKSPACE_PATH/pages/<slug>.yaml`, with optional
 * sibling `<slug>.md` prose and optional custom React widgets in
 * `pages/components/registry.tsx`).
 *
 * A page never introduces a new data model. Each page is a *derivative of a
 * core page archetype* — today `list` (the objects/type/[slug] shape),
 * `queue` (the review shape, read-only, linking into /dashboard/inbox for
 * decisions) or `markdown` (the docs shape) — configured over data core
 * already owns: business objects, skill runs, or knowledge documents.
 *
 * Pages are file-only: nothing is written to the database, `workspace:apply`
 * does not need to know about them, and deleting the YAML deletes the page.
 * They render at `/dashboard/p/<slug>` and are listed in the sidebar under
 * their `nav.section` (default "Workspace").
 *
 * An enabled plugin (`workspace.yaml` `plugins:`) contributes its own
 * `pages/` the same way; a workspace page with the same slug replaces it.
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
  /** `image` renders the value (a URL) as a thumbnail. */
  format: z.enum(['text', 'badge', 'score', 'date', 'mono', 'image']).default('text'),
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
  // What agents DID — tool_call rows (the operations layer is gone in
  // core@2.0; the kind keeps its name so existing workspaces load).
  // `skills` scopes to tool names; `status` is completed | failed.
  z.object({
    kind: z.literal('skillRuns'),
    skills: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
  z.object({ kind: z.literal('documents'), source: SlugSchema, limit: z.number().int().positive().max(500).default(100) }),
  z.object({ kind: z.literal('agents'), active: z.boolean().optional() }),
  // What agents and people MADE — the artifact log, scoped by folder and/or
  // kind. A wiki is a folder of markdown artifacts; a proposal log is the
  // document kind under one playbook. `meta` carries kind, folder, version,
  // playbook and the record the artifact belongs to.
  z.object({
    kind: z.literal('artifacts'),
    folder: z.string().optional(),
    artifactKind: z.string().optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
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
   * Embed the core review queue on this page: agent-proposed actions
   * (action_run rows, optionally scoped by `skills` = action ids) and,
   * optionally, paused workflow runs. Same items, same approve/decline
   * services as /dashboard/inbox — one queue. The `queue` archetype gets
   * this implicitly from its source when omitted.
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
/** A validated page plus where it came from, so its prose resolves beside it. */
export type LoadedPage = PageManifest & {
  /** Absolute directory the YAML was read from. */
  sourceDir: string;
  /** `workspace`, or the slug of the plugin that ships it. */
  origin: 'workspace' | `plugin:${string}`;
};
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
export function readWorkspacePages(): { pages: LoadedPage[]; issues: PageLoadIssue[] } {
  const ws = workspaceDir();
  const pages: LoadedPage[] = [];
  const issues: PageLoadIssue[] = [];
  const seen = new Set<string>();

  const readDir = (dir: string, origin: LoadedPage['origin'], tenant: boolean) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && f !== 'tour.yaml' && f !== 'tour.yml').sort()) {
      try {
        // Only tenant files carry {{env.NAME}} tokens; a plugin ships the same bytes to everyone.
        const raw = parseYaml(tenant ? readWorkspaceTextFile(join(dir, f)) : readFileSync(join(dir, f), 'utf8'));
        const result = PageManifestSchema.safeParse(raw);
        if (!result.success) {
          issues.push({ file: f, message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
          continue;
        }
        // The workspace reads first, so a same-slug plugin page is the one that yields.
        if (seen.has(result.data.slug)) {
          continue;
        }
        seen.add(result.data.slug);
        pages.push({ ...result.data, sourceDir: dir, origin });
      } catch (e) {
        issues.push({ file: f, message: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  if (ws) {
    readDir(join(ws, 'pages'), 'workspace', true);
    for (const plugin of enabledPluginsFromWorkspaceDir(ws)) {
      readDir(join(plugin.sourcePath, 'pages'), `plugin:${plugin.manifest.slug}`, false);
    }
  }
  pages.sort((a, b) => a.nav.order - b.nav.order || a.title.localeCompare(b.title));
  return { pages, issues };
}

export function readWorkspacePage(slug: string): LoadedPage | null {
  return readWorkspacePages().pages.find(p => p.slug === slug) ?? null;
}

/**
 * The plugin that ships this page, or null for a page the workspace authored
 * itself. `origin` already carries it as `plugin:<slug>`; this is the one
 * place that string is taken apart, so a surface asking "is this a plugin
 * page" never parses it by hand.
 * @param page - A loaded page.
 */
export function pagePlugin(page: Pick<LoadedPage, 'origin'>): string | null {
  return page.origin.startsWith('plugin:') ? page.origin.slice('plugin:'.length) : null;
}

/**
 * Markdown content for a `markdown` archetype page (or a list page's intro),
 * read beside the YAML that declared it — a plugin page's prose ships with the
 * plugin, a workspace page's with the workspace.
 * @param manifest
 */
export function readWorkspacePageContent(manifest: LoadedPage): string | null {
  const file = join(manifest.sourceDir, manifest.contentFile ?? `${manifest.slug}.md`);
  if (!existsSync(file)) {
    return null;
  }
  return manifest.origin === 'workspace' ? readWorkspaceTextFile(file) : readFileSync(file, 'utf8');
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
