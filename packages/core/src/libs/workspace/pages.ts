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
   * run without the row itself navigating there. `relative` renders a
   * timestamp as its distance from now ("12s ago", "in 4m") with the full
   * time one hover away — on a live page it re-reads on every refresh, so a
   * heartbeat column stays honest. `progress` renders a worker's
   * `{phase, note}` object as "phase · note" (any other object as its
   * primitive entries), so coarse progress reads as a sentence, not JSON.
   */
  format: z.enum(['text', 'badge', 'score', 'date', 'mono', 'image', 'money', 'link', 'relative', 'progress']).default('text'),
  /**
   * For `format: badge` — map raw value → status-pill tone. A boolean
   * `false` with no `'false'` tone renders as nothing: a flag that is off
   * (`stopRequested`) is not a state to badge unless the page says so
   * (the floor's `verified` does, with `'false': bad`).
   */
  tones: z.record(z.string(), z.enum(['ok', 'warn', 'bad', 'info', 'muted'])).optional(),
  /**
   * Sum this column under the table — under each group's table on a grouped
   * page, so grouping by a tag gives the cumulative figure per tag. A
   * `money` column totals as money; anything else as a number.
   */
  total: z.boolean().default(false),
});

/**
 * A page that stays current while someone is looking at it. The rendered
 * page re-reads its rows and stats every `every` seconds while the tab is
 * visible, and says so ("live · 12s ago"). Bounded: under 5s a page would
 * hammer the database for no reading a person could follow; over 120s it
 * is not live, it is a page you reload. One request per interval per open
 * tab is the whole cost.
 */
const LiveSchema = z.object({
  every: z.number().int().min(5).max(120),
});

/**
 * `since` keeps the rows whose date field is on or after the start of a
 * window that ends now: `month` (this calendar month), `week` (this week,
 * Monday first), `today`, or `<n>d` (the last n days). UTC throughout, so a
 * stat reads the same from every desk.
 */
const SinceValueSchema = z.string().regex(/^(month|week|today|\d+d)$/, { message: 'since takes month, week, today or <n>d' });

const FilterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gte', 'lte', 'in', 'exists', 'since']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
}).refine(f => f.op !== 'since' || SinceValueSchema.safeParse(f.value).success, { message: 'since takes month, week, today or <n>d', path: ['value'] });

const StatSchema = z.object({
  label: z.string(),
  kind: z.enum(['count', 'avg', 'min', 'max', 'sum', 'pctGte', 'countWhere']),
  /** Field the stat computes over (same accessor grammar as FieldSchema.from). */
  field: z.string().optional(),
  threshold: z.number().optional(),
  where: FilterSchema.optional(),
  /** Optional suffix, e.g. "%" or "applicants". */
  suffix: z.string().optional(),
  /** `money` reads the figure as cents and shows dollars, the way a `money` field does. */
  format: z.enum(['number', 'money']).default('number'),
});

/**
 * A strip of figures over time — the same measures a stat computes, bucketed
 * by a date field into the last `buckets` days, weeks or months, oldest
 * first. "Spent per week, estimated beside actual" is one series with two
 * measures. Rows with no date, or a date outside the window, are left out.
 */
const SeriesSchema = z.object({
  label: z.string(),
  /** The date each row is bucketed by (same accessor grammar as FieldSchema.from). */
  dateField: z.string(),
  bucket: z.enum(['day', 'week', 'month']).default('week'),
  buckets: z.number().int().min(2).max(52).default(8),
  measures: z.array(z.object({
    label: z.string(),
    field: z.string(),
    kind: z.enum(['sum', 'count', 'avg']).default('sum'),
  })).min(1),
  format: z.enum(['number', 'money']).default('number'),
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
  /** Figures over time, drawn under the stats — see {@link SeriesSchema}. */
  series: z.array(SeriesSchema).optional(),
  /** Row click-through, e.g. `/dashboard/objects/{id}`. `{id}` interpolates. */
  rowLink: z.string().optional(),
  /** Re-read the page on an interval while it is open — see {@link LiveSchema}. */
  live: LiveSchema.optional(),

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
})
  .refine(m => m.archetype !== 'link' || m.href !== undefined, { message: 'a link page needs href — the route it opens', path: ['href'] })
  .refine(m => m.live === undefined || m.archetype === 'list' || m.archetype === 'queue', { message: 'live is for list and queue pages — the ones with rows to re-read', path: ['live'] });

export type PageManifest = z.infer<typeof PageManifestSchema>;
/** A validated page plus where it came from, so its prose resolves beside it. */
export type LoadedPage = PageManifest & {
  /** Absolute directory the YAML was read from. */
  sourceDir: string;
  /** `workspace`, or the slug of the plugin that ships it. */
  origin: 'workspace' | `plugin:${string}`;
};
export type PageField = z.infer<typeof FieldSchema>;
export type PageLive = z.infer<typeof LiveSchema>;
export type PageStat = z.infer<typeof StatSchema>;
export type PageSeries = z.infer<typeof SeriesSchema>;
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

/**
 * A `format: progress` value as one line. A worker's heartbeat carries
 * `progress` as its own JSON — the factory's workers send `{phase, note}` —
 * so the phase and the note read as "phase · note"; any other object reads
 * as its primitive entries ("files: 12 · step: lint"); a string is itself.
 * Null when there is nothing to say, so the cell shows the dash.
 * @param raw - The resolved field value.
 */
export function formatProgress(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw !== 'object') {
    return String(raw);
  }
  const obj = raw as Record<string, unknown>;
  const named = ['phase', 'note'].map(k => obj[k]).filter((v): v is string | number => typeof v === 'string' ? v !== '' : typeof v === 'number');
  if (named.length > 0) {
    return named.map(String).join(' · ');
  }
  const rest = Object.entries(obj)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => `${k}: ${String(v)}`);
  return rest.length > 0 ? rest.join(' · ') : null;
}

/**
 * A field value as a Date, or null when it is not one. Rows carry `Date`
 * objects from the database and ISO strings from parsed JSON; a `relative`
 * or `date` column should read both.
 * @param raw - The resolved field value.
 */
export function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Where a `since` window starts, in UTC. `week` starts on Monday.
 * @param value - `month` | `week` | `today` | `<n>d`.
 * @param now - The clock.
 */
export function sinceStart(value: string, now: Date): Date {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (value === 'month') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  if (value === 'week') {
    const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(day - dow * 86_400_000);
  }
  if (value === 'today') {
    return new Date(day);
  }
  const days = Number.parseInt(value, 10);
  return new Date(now.getTime() - (Number.isFinite(days) ? days : 0) * 86_400_000);
}

export function applyFilter(rows: PageRow[], filters: z.infer<typeof FilterSchema>[] | undefined, now: Date = new Date()): PageRow[] {
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
      case 'since': {
        const d = toDate(v);
        return d !== null && typeof f.value === 'string' && d.getTime() >= sinceStart(f.value, now).getTime();
      }
      default: return true;
    }
  }));
}

/**
 * Cents as dollars — `1234` → `$12.34`, `-50` → `-$0.50`. Storage is always
 * cents; this is the one place they become money on a page.
 * @param cents - An integer number of cents (a fraction is rounded).
 */
export function formatMoney(cents: number): string {
  const whole = Math.round(cents);
  const sign = whole < 0 ? '-' : '';
  return `${sign}$${(Math.abs(whole) / 100).toFixed(2)}`;
}

function aggregate(kind: 'count' | 'sum' | 'avg' | 'min' | 'max', pool: PageRow[], nums: number[]): number {
  switch (kind) {
    case 'count':
      return pool.length;
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'min':
      return nums.length ? Math.min(...nums) : 0;
    case 'max':
      return nums.length ? Math.max(...nums) : 0;
    default:
      return 0;
  }
}

function numbersOf(rows: PageRow[], field: string | undefined): number[] {
  return field
    ? rows.map(r => resolveField(r, field)).filter((v): v is number => typeof v === 'number')
    : [];
}

function renderFigure(value: number, format: 'number' | 'money', suffix = ''): string {
  if (format === 'money') {
    return `${formatMoney(value)}${suffix}`;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

export function computeStat(rows: PageRow[], stat: PageStat, now: Date = new Date()): string {
  const pool = stat.where ? applyFilter(rows, [stat.where], now) : rows;
  const nums = numbersOf(pool, stat.field);
  let value: number;
  switch (stat.kind) {
    case 'countWhere':
      value = pool.length;
      break;
    case 'pctGte': {
      const t = stat.threshold ?? 0;
      value = nums.length ? (nums.filter(n => n >= t).length / nums.length) * 100 : 0;
      break;
    }
    default:
      value = aggregate(stat.kind, pool, nums);
  }
  return renderFigure(value, stat.format, stat.suffix);
}

/**
 * The columns marked `total`, summed over these rows and rendered the way
 * the column renders — money for a `money` column, a plain number otherwise.
 * Empty when no column asks for it.
 * @param rows - The rows under one table.
 * @param fields - The page's fields.
 */
export function computeTotals(rows: PageRow[], fields: PageField[]): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const f of fields) {
    if (!f.total) {
      continue;
    }
    const sum = numbersOf(rows, f.from ?? f.key).reduce((a, b) => a + b, 0);
    totals[f.key] = renderFigure(sum, f.format === 'money' ? 'money' : 'number');
  }
  return totals;
}

/**
 * Rows by the value of `groupBy`, in first-seen order. A row whose value is a
 * list — a request's tags — sits in every group it names, so a page grouped
 * by tag reads as "everything under this tag" and a total under each group
 * is the cumulative figure for that tag. No value, or an empty list, is "—".
 * @param rows - The page's rows, already filtered and sorted.
 * @param groupBy - The accessor to group on.
 */
export function groupRows(rows: PageRow[], groupBy: string): Array<{ label: string; rows: PageRow[] }> {
  const groups = new Map<string, PageRow[]>();
  for (const r of rows) {
    const v = resolveField(r, groupBy);
    const keys = Array.isArray(v) ? v.map(String).filter(k => k !== '') : [];
    for (const k of keys.length > 0 ? keys : [v === undefined || v === null || v === '' || Array.isArray(v) ? '—' : String(v)]) {
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
  }
  return [...groups].map(([label, rs]) => ({ label, rows: rs }));
}

export type ComputedSeries = {
  label: string;
  buckets: string[];
  measures: Array<{ label: string; values: string[] }>;
};

/**
 * The UTC start of the bucket a moment falls in.
 * @param t - The moment.
 * @param bucket - Day, week (Monday first) or month.
 */
function bucketStart(t: Date, bucket: PageSeries['bucket']): number {
  if (bucket === 'month') {
    return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1);
  }
  const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  return bucket === 'week' ? day - ((t.getUTCDay() + 6) % 7) * 86_400_000 : day;
}

/**
 * The start of the bucket `n` buckets before the one starting at `start`.
 * @param start - A bucket start, from {@link bucketStart}.
 * @param n - How many buckets back.
 * @param bucket - Day, week or month.
 */
function bucketBack(start: number, n: number, bucket: PageSeries['bucket']): number {
  const d = new Date(start);
  if (bucket === 'month') {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1);
  }
  return start - n * (bucket === 'week' ? 7 : 1) * 86_400_000;
}

function bucketLabel(start: number, bucket: PageSeries['bucket']): string {
  const d = new Date(start);
  return bucket === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * A series over the page's rows: the last `buckets` buckets ending at now,
 * oldest first, each measure aggregated over the rows whose `dateField`
 * falls in the bucket.
 * @param rows - The page's rows, already filtered.
 * @param series - The series declaration.
 * @param now - The clock.
 */
export function computeSeries(rows: PageRow[], series: PageSeries, now: Date = new Date()): ComputedSeries {
  const last = bucketStart(now, series.bucket);
  const starts = Array.from({ length: series.buckets }, (_, i) => bucketBack(last, series.buckets - 1 - i, series.bucket));
  const pools: PageRow[][] = starts.map(() => []);
  for (const r of rows) {
    const d = toDate(resolveField(r, series.dateField));
    if (!d) {
      continue;
    }
    const b = bucketStart(d, series.bucket);
    const i = starts.indexOf(b);
    if (i >= 0) {
      pools[i]!.push(r);
    }
  }
  return {
    label: series.label,
    buckets: starts.map(s => bucketLabel(s, series.bucket)),
    measures: series.measures.map(m => ({
      label: m.label,
      values: pools.map(pool => renderFigure(aggregate(m.kind, pool, numbersOf(pool, m.field)), series.format)),
    })),
  };
}
