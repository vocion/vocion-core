import type { LoadedPlugin } from '@/libs/workspace/plugins';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { enabledPluginsFromWorkspaceDir, loadPlugin } from '@/libs/workspace/plugins';
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
 *
 * A deployment hosts several projects on ONE mounted folder, so the mounted
 * `workspace.yaml` is only the primary project's word on which plugins are
 * on. The project the request is for has its own list on
 * `project.enabled_plugins`; a caller with an org passes it in
 * (`enabledPlugins`) and those plugins' pages join the same list, same
 * dedupe. This module stays filesystem-only — the DB half is
 * `services/PluginService.ts` (`readPageForOrg`).
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
  /**
   * `image` renders the value (a URL) as a thumbnail; `money` reads an
   * integer of cents and shows dollars; `link` renders a URL as an anchor
   * that opens in a new tab, so a row can carry the pull request beside the
   * run without the row itself navigating there.
   */
  format: z.enum(['text', 'badge', 'score', 'date', 'mono', 'image', 'money', 'link']).default('text'),
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
  // What external workers DID — `worker_run` rows (docs/entities/worker-run.md),
  // newest first. `agentSlugs`, `status` and `kinds` each narrow when given;
  // `meta` carries the row's columns plus `result`, `input` and `counts`, so a
  // field can reach `meta.result.pr_url` the way an artifact field reaches
  // `meta.playbook`.
  z.object({
    kind: z.literal('workerRuns'),
    agentSlugs: z.array(SlugSchema).optional(),
    status: z.array(z.string()).optional(),
    kinds: z.array(z.string()).optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
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
  /**
   * `link` is a nav row, not a page: it pins an existing core route into the
   * manifest's section under its own label, and `/dashboard/p/<slug>`
   * redirects to `href`. It exists so a plugin can seat a core surface (the
   * team report) beside its own pages without duplicating it.
   */
  archetype: z.enum(['list', 'queue', 'markdown', 'link']),
  /** Required by `link`: the route the row opens. */
  href: z.string().min(1).optional(),

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
}).refine(m => m.archetype !== 'link' || m.href !== undefined, { message: 'a link page needs href — the route it opens', path: ['href'] });

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

export type ReadPagesOptions = {
  /**
   * Plugins the project has on (`project.enabled_plugins` — dependency-closed,
   * in load order), read from core's own `templates/plugins/<slug>/pages`.
   * Their pages join the mounted workspace's and its plugins'; a slug both
   * lists name loads once. Omitted = the mounted folder alone, as before.
   */
  enabledPlugins?: readonly string[];
  /**
   * Whether the folder on `WORKSPACE_PATH` is the asking project's own
   * (`services/WorkspaceMountService.ts` decides from what the applier
   * recorded). Default true — the single-project install, and every CLI
   * caller. False keeps the folder's pages AND its plugins' pages out: they
   * are another project's; only `enabledPlugins` contribute.
   */
  mounted?: boolean;
};

/**
 * Read + validate every page manifest in the workspace. Invalid files are
 * skipped and reported — a broken page never takes the dashboard down.
 * @param opts - See {@link ReadPagesOptions}.
 */
export function readWorkspacePages(opts: ReadPagesOptions = {}): { pages: LoadedPage[]; issues: PageLoadIssue[] } {
  const ws = workspaceDir();
  const pages: LoadedPage[] = [];
  const issues: PageLoadIssue[] = [];
  const seen = new Set<string>();
  const seenPlugins = new Set<string>();

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

  const readPlugin = (plugin: LoadedPlugin) => {
    if (seenPlugins.has(plugin.manifest.slug)) {
      return;
    }
    seenPlugins.add(plugin.manifest.slug);
    readDir(join(plugin.sourcePath, 'pages'), `plugin:${plugin.manifest.slug}`, false);
  };

  // The mounted folder speaks only for the project it belongs to.
  if (ws && (opts.mounted ?? true)) {
    readDir(join(ws, 'pages'), 'workspace', true);
    for (const plugin of enabledPluginsFromWorkspaceDir(ws)) {
      readPlugin(plugin);
    }
  }
  // The project's own plugins, after the mounted folder's so the same
  // "workspace first, plugin yields" rule holds for them. The list is stored
  // dependency-closed, so each slug loads on its own; one this core no longer
  // ships is reported the way a bad YAML is, never thrown.
  for (const slug of opts.enabledPlugins ?? []) {
    if (seenPlugins.has(slug)) {
      continue;
    }
    try {
      readPlugin(loadPlugin(slug));
    } catch (e) {
      issues.push({ file: `plugin:${slug}`, message: e instanceof Error ? e.message : String(e) });
    }
  }
  pages.sort((a, b) => a.nav.order - b.nav.order || a.title.localeCompare(b.title));
  return { pages, issues };
}

/**
 * One page by slug, from the same list {@link readWorkspacePages} builds.
 * @param slug - The page slug.
 * @param opts - See {@link ReadPagesOptions}.
 */
export function readWorkspacePage(slug: string, opts: ReadPagesOptions = {}): LoadedPage | null {
  return readWorkspacePages(opts).pages.find(p => p.slug === slug) ?? null;
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
