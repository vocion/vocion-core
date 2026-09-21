import { z } from 'zod';

/**
 * Workspace pages, the part that runs anywhere — the page manifest schema,
 * the field accessors, the figures and the table layout.
 *
 * Split out of `pages.ts` so a React component can import it: `pages.ts`
 * reads the filesystem (it loads the YAML), and a browser cannot. `pages.ts`
 * re-exports everything here, so nothing that already imported from it had
 * to change.
 *
 * Tenant-defined dashboard pages are declared entirely inside
 * the workspace directory (`WORKSPACE_PATH/pages/<slug>.yaml`, with optional
 * sibling `<slug>.md` prose and optional custom React widgets in
 * `pages/components/registry.tsx`).
 *
 * A page never introduces a new data model. Each page is a *derivative of a
 * core page archetype* — today `list` (the objects/type/[slug] shape),
 * `queue` (the review shape, read-only, linking into /dashboard/inbox for
 * decisions), `markdown` (the docs shape), `report` (one record's whole story)
 * or `overview` (an ordered list of typed panels - the control plane) -
 * configured over data core already owns: business objects, skill runs, or
 * knowledge documents.
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
  format: z.enum(['text', 'badge', 'score', 'date', 'mono', 'image', 'money', 'link', 'relative', 'progress', 'steps']).default('text'),
  /**
   * For `format: link` — the object type the value is an id (or a slug) of.
   * The cell then resolves to `/dashboard/objects/<id>` under the target's
   * own title, so "Asked by 41" reads as the request someone actually
   * filed. Without it a `link` value is treated as a URL, as before.
   */
  to: SlugSchema.optional(),
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
  /**
   * How much of the table's width this column has a claim on. 1 is a
   * column the page is about and never drops; a narrow viewport drops the
   * 3s first, then the 2s, and the row still reads. Nothing is deleted —
   * a dropped column is one horizontal scroll away on the widened table,
   * and the primary column stays pinned while it scrolls.
   */
  priority: z.number().int().min(1).max(3).default(1),
  /**
   * Collapse this column when every visible row carries the same value.
   * A floor filtered to one repository spends two columns repeating
   * "squatch-core" on every row; with this the fact moves to one line
   * above the table and the table gets the width back. A column whose
   * values differ, or which is empty on some row, stays a column.
   */
  hideWhenConstant: z.boolean().default(false),
  /**
   * Which edge the value sits against. Figures read down a column when
   * they share a right edge, so `money` and `score` default to `right`
   * and everything else to `left`; this overrides that.
   */
  align: z.enum(['left', 'right']).optional(),
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

/**
 * A trailing link on every row of a `list` page — a second place a row can
 * take you without taking the row's own click. `href` interpolates the row
 * the way `rowLink` does, plus any accessor in braces:
 * `/dashboard/p/feature/{meta.requestId}` reads the request off a task row,
 * so the Factory floor and the Backlog reach the same report from rows of
 * different nouns. An action whose href has a token the row cannot fill is
 * not drawn for that row — a dead link is worse than no link.
 */
const RowActionSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

/**
 * The `report` archetype — one RECORD's whole story on one page, in order,
 * with the money and the decisions on it.
 *
 * It is the fourth archetype rather than a hand-coded page because the
 * plugin that owns the nouns should own the surface: the software factory
 * declares `subject: request` and gets `/dashboard/p/feature/<requestId>`,
 * and a deployment that replaces the page by slug replaces the report too.
 *
 * `subject` is an enum of one on purpose. A report is not a generic record
 * dump — it is an assembly that knows what a request's story IS (the ask,
 * triage, the contract, approvals, the runs, the change, QA evidence, the
 * release, the money) and which records tell each part
 * (`services/factory/featureReport.ts`). A second subject means a second
 * assembly, and it should be declared here when it exists rather than
 * pretended at now.
 */
const ReportSchema = z.object({
  subject: z.enum(['request']),
});

/**
 * The `overview` archetype - the 60-second control plane.
 *
 * Every other archetype answers one question about one kind of row. This one
 * answers the six a person running a business asks before they have decided
 * what to look at: what is true, what changed since I last looked, what is
 * happening now, what is planned next and why, what needs me, and is it worth
 * what it costs. So the page is an ordered list of typed PANELS, each
 * computed server-side from records core already owns
 * (`services/factory/overview.ts` assembles, `overviewData.ts` reads).
 *
 * Panels are declarative rather than hand-coded for the same reason the
 * report archetype is an archetype: the plugin that owns the nouns should own
 * the surface, and a deployment that replaces the page by slug replaces its
 * panels too.
 *
 * The one rule every panel holds to: a figure that the records cannot support
 * is NOT drawn. The panel says which figure is missing and why, in the place
 * the figure would have been. A fabricated metric on a page a person steers
 * by is worse than a gap, because a gap can be fixed and a lie cannot be
 * noticed.
 */
const PanelFactSchema = z.discriminatedUnion('kind', [
  /** A value read straight off the record - stage, health, a date. */
  z.object({
    kind: z.literal('field'),
    label: z.string().min(1),
    from: z.string().min(1),
  }),
  /**
   * A count of OTHER records that point back at this one. `relatedField` is
   * the accessor on the related record holding this record's key;
   * `subjectFields` are the accessors tried, in order, for that key on this
   * record. Both sides are compared lower-cased and trimmed, because a
   * product titled "Send" is written `send` on the rows that belong to it.
   */
  z.object({
    kind: z.literal('related'),
    label: z.string().min(1),
    objectType: SlugSchema,
    relatedField: z.string().min(1),
    subjectFields: z.array(z.string().min(1)).min(1).default(['title']),
    /** Keep only these statuses (omitted = every status). */
    status: z.array(z.string()).optional(),
    /** Drop these statuses. Applied after `status`. */
    excludeStatus: z.array(z.string()).optional(),
  }),
]);

const PanelBaseFields = {
  title: z.string().min(1),
  /** One line under the panel title, in the page's own words. */
  note: z.string().optional(),
};

/**
 * `since` for the digest: a per-viewer last-looked stamp when there is one,
 * this many hours otherwise. The panel heading SAYS which of the two it used;
 * a page that silently substitutes a window for a memory is telling a person
 * their attention was tracked when it was not.
 */
const DigestFallbackHoursSchema = z.number().int().min(1).max(720).default(24);

const OverviewPanelSchema = z.discriminatedUnion('kind', [
  /** One row per record of a type: a headline and up to four inline facts. */
  z.object({
    kind: z.literal('status'),
    ...PanelBaseFields,
    objectType: SlugSchema,
    headline: z.string().min(1).default('title'),
    facts: z.array(PanelFactSchema).max(4).default([]),
    /** Row click-through, e.g. `/dashboard/objects/{id}`. */
    rowLink: z.string().optional(),
  }),
  /**
   * Human-meaningful change since a timestamp. Deliberately NOT a feed:
   * `arrivals` and `transitions` name the handful of changes a person cares
   * about by name, and everything high-volume (deploys, worker runs) is only
   * ever a `rollup` - a count and a sum, never a list.
   */
  z.object({
    kind: z.literal('digest'),
    ...PanelBaseFields,
    fallbackHours: DigestFallbackHoursSchema,
    /**
     * Records that ARRIVED in the window. `dateFields` are tried in order:
     * name the record's own stamp for when a person asked (`meta.askedAt`)
     * first and leave `createdAt` last, because `createdAt` is when the ROW
     * was written, which a backfill can move years after the ask.
     */
    arrivals: z.array(z.object({
      objectType: SlugSchema,
      label: z.string().min(1),
      dateFields: z.array(z.string().min(1)).min(1).default(['createdAt']),
    })).default([]),
    /**
     * Records whose status is now one of `to`, and whose stamp for that
     * change falls in the window. `dateFields` are tried in order: name the
     * record's own stamp for the change first (`meta.acceptedAt`) and leave
     * `updatedAt` last. The panel reports which one it used, because
     * "updated since you looked" is weaker evidence than "accepted at 14:02"
     * and a reader is entitled to know which they are being shown.
     */
    transitions: z.array(z.object({
      objectType: SlugSchema,
      to: z.array(z.string()).min(1),
      label: z.string().min(1),
      dateFields: z.array(z.string().min(1)).min(1).default(['updatedAt']),
      /** How many to name individually before the rest become a count. */
      detail: z.number().int().min(0).max(10).default(3),
    })).default([]),
    /** A count and, when a money field is given, a sum. Never a list. */
    rollups: z.array(z.object({
      objectType: SlugSchema,
      label: z.string().min(1),
      dateFields: z.array(z.string().min(1)).min(1).default(['createdAt']),
      moneyField: z.string().optional(),
    })).default([]),
    /** Decisions that arrived in the window, by risk. */
    decisions: z.object({
      label: z.string().min(1).default('decisions arrived'),
      risk: z.array(z.string()).default([]),
    }).optional(),
  }),
  /**
   * Outcomes in flight - requests and initiatives, never worker runs. The
   * unit is the thing a person asked for; the runs underneath it are
   * evidence and live on the Activity surface.
   */
  z.object({
    kind: z.literal('active'),
    ...PanelBaseFields,
    objectType: SlugSchema,
    /** Statuses (or `stateField` values) that mean "in flight". */
    statusIn: z.array(z.string()).min(1),
    /** A second accessor that also has to be in flight, e.g. `meta.state`. */
    stateField: z.string().optional(),
    stateIn: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(25).default(7),
    /** The work underneath an outcome, for the "4/5 tasks complete" line. */
    tasks: z.object({
      objectType: SlugSchema,
      /** Accessor on the task holding the outcome's id. */
      joinField: z.string().min(1),
      completeStatus: z.array(z.string()).min(1),
      /** Task statuses that mean the outcome is waiting on a person. */
      waitingStatus: z.array(z.string()).default([]),
    }).optional(),
    rowLink: z.string().optional(),
  }),
  /**
   * The ordered queue of what the factory intends to do next, each with its
   * reason. `orderBy` decides the ORDER and is never rendered: a priority
   * integer is a ranking, not an answer to "why this". The answer comes from
   * `meta.why` (see libs/workspace/reasonCodes.ts), and when it is absent the
   * row says so.
   */
  z.object({
    kind: z.literal('next'),
    ...PanelBaseFields,
    objectType: SlugSchema,
    statusIn: z.array(z.string()).optional(),
    stateField: z.string().optional(),
    stateIn: z.array(z.string()).optional(),
    orderBy: z.string().min(1).default('meta.priority'),
    limit: z.number().int().min(1).max(25).default(7),
    /** Metadata keys tried, in order, for the prose note beside the codes. */
    noteFields: z.array(z.string().min(1)).min(1).default(['whyNote']),
    rowLink: z.string().optional(),
  }),
  /** Open decisions: how many, how many minutes, how many hold work up. */
  z.object({
    kind: z.literal('needsYou'),
    ...PanelBaseFields,
    href: z.string().min(1).default('/dashboard/inbox'),
  }),
  /** Spend, accepted changes, cost per accepted change, waste. */
  z.object({
    kind: z.literal('economics'),
    ...PanelBaseFields,
    windowDays: z.number().int().min(1).max(365).default(30),
    objectType: SlugSchema,
    dateFields: z.array(z.string().min(1)).min(1).default(['createdAt']),
    costField: z.string().min(1).default('meta.actualCents'),
    /** Statuses that mean the change was accepted. */
    acceptedStatus: z.array(z.string()).min(1),
    /** Statuses that mean the money bought nothing - the waste line. */
    wasteStatus: z.array(z.string()).min(1),
  }),
  /**
   * Two measures that must not be blended. Work autonomy is "how much got
   * done without a person"; human-interruption quality is "how much of a
   * person's day it took and how much of that was worth taking". "94%
   * auto-completed" beside "32 need attention" creates questions, not
   * confidence, so both are reported and the second is named honestly.
   */
  z.object({
    kind: z.literal('autonomy'),
    ...PanelBaseFields,
    windowDays: z.number().int().min(1).max(90).default(7),
  }),
]);

export type PageOverviewPanel = z.infer<typeof OverviewPanelSchema>;
export type PagePanelFact = z.infer<typeof PanelFactSchema>;

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
  archetype: z.enum(['list', 'queue', 'markdown', 'link', 'report', 'overview']),
  /** Required by `link`: the route the row opens. */
  href: z.string().min(1).optional(),

  // ---- report config ----
  /** Required by `report` — see {@link ReportSchema}. */
  report: ReportSchema.optional(),

  // ---- overview config ----
  /** Required by `overview` - the ordered panels, see {@link OverviewPanelSchema}. */
  panels: z.array(OverviewPanelSchema).min(1).max(12).optional(),

  // ---- list / queue config ----
  source: ListSourceSchema.optional(),
  fields: z.array(FieldSchema).optional(),
  /**
   * The row's headline. `field` is the column that leads the row — wide,
   * never truncated, pinned while the table scrolls sideways — and
   * `subtitle` names the columns that read under it as one muted line
   * ("squatch-core · logic · attempt 2 · Sign-in loops on Safari")
   * instead of as four narrow columns of their own. Both are ordinary
   * field keys: the formatting layer is the same one the table uses, and
   * a field named here is not also rendered as a column.
   */
  primary: z.object({
    field: z.string(),
    subtitle: z.array(z.string()).default([]),
  }).optional(),
  filters: z.array(FilterSchema).optional(),
  groupBy: z.string().optional(),
  sort: z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  stats: z.array(StatSchema).optional(),
  /** Figures over time, drawn under the stats — see {@link SeriesSchema}. */
  series: z.array(SeriesSchema).optional(),
  /** Row click-through, e.g. `/dashboard/objects/{id}`. `{id}` interpolates. */
  rowLink: z.string().optional(),
  /** Trailing links on each row — see {@link RowActionSchema}. */
  rowActions: z.array(RowActionSchema).default([]),
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
  .refine(m => m.archetype !== 'report' || m.report !== undefined, { message: 'a report page needs report.subject — the record whose story it tells', path: ['report'] })
  .refine(m => m.archetype !== 'overview' || m.panels !== undefined, { message: 'an overview page needs panels - the ordered list it computes', path: ['panels'] })
  .refine(m => m.panels === undefined || m.archetype === 'overview', { message: 'panels belong to the overview archetype', path: ['panels'] })
  .refine(m => m.live === undefined || m.archetype === 'list' || m.archetype === 'queue', { message: 'live is for list and queue pages — the ones with rows to re-read', path: ['live'] })
  .refine(
    m => m.primary === undefined
      || [m.primary.field, ...m.primary.subtitle].every(k => (m.fields ?? []).some(f => f.key === k)),
    { message: 'primary names a field this page does not declare', path: ['primary'] },
  );

export type PageManifest = z.infer<typeof PageManifestSchema>;
/** A validated page plus where it came from, so its prose resolves beside it. */
export type LoadedPage = PageManifest & {
  /** Absolute directory the YAML was read from. */
  sourceDir: string;
  /** `workspace`, or the slug of the plugin that ships it. */
  origin: 'workspace' | `plugin:${string}`;
};
export type PageField = z.infer<typeof FieldSchema>;
export type PagePrimary = NonNullable<z.infer<typeof PageManifestSchema>['primary']>;
export type PageLive = z.infer<typeof LiveSchema>;
export type PageStat = z.infer<typeof StatSchema>;
export type PageSeries = z.infer<typeof SeriesSchema>;
export type PageWidget = z.infer<typeof WidgetSchema>;
export type PageRowAction = z.infer<typeof RowActionSchema>;
export type PageReport = z.infer<typeof ReportSchema>;
export type PagePanels = NonNullable<z.infer<typeof PageManifestSchema>['panels']>;

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
 * A row link or row action's href with its `{...}` tokens filled from the
 * row. `{id}` is the row id; anything else is the same accessor grammar a
 * field's `from` uses, so `{meta.requestId}` reads a task row's request.
 *
 * Null when a token has no value on this row. A half-filled href
 * (`/dashboard/p/feature/undefined`) is a link to a 404 that looks like a
 * link to a page, and a row that cannot reach the target should say nothing
 * rather than lie about it.
 * @param row - The row.
 * @param template - The href, with `{accessor}` tokens.
 */
export function interpolateHref(row: PageRow, template: string): string | null {
  let missing = false;
  const out = template.replaceAll(/\{([^{}]+)\}/g, (_, accessor: string) => {
    const v = resolveField(row, accessor.trim());
    if (v === undefined || v === null || v === '') {
      missing = true;
      return '';
    }
    return encodeURIComponent(String(v));
  });
  return missing ? null : out;
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

// ---------------------------------------------------------------------------
// Table layout — what the renderer needs to know before it draws a row
// ---------------------------------------------------------------------------

/**
 * Whether a resolved value is "nothing" — undefined, null, the empty string,
 * or an empty list. A cell shows the muted dash for these and a record page
 * leaves the field out entirely; `false` and `0` are values, not nothing.
 * @param raw - The resolved field value.
 */
export function isEmptyValue(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
}

/**
 * Which edge a column's values sit against — declared, or figures right and
 * everything else left.
 * @param field - The field declaration.
 */
export function fieldAlign(field: PageField): 'left' | 'right' {
  return field.align ?? (field.format === 'money' || field.format === 'score' ? 'right' : 'left');
}

/**
 * The columns that say the same thing on every row. A page filtered to one
 * repository carries that repository in every cell of two columns; this is
 * how the renderer learns to say it once, above the table, and give the
 * width back. A column is constant only when it opted in
 * (`hideWhenConstant`), there is more than one row to compare, and every
 * one of them carries the same non-empty value.
 * @param rows - The rows about to be drawn.
 * @param fields - The page's fields.
 */
export function constantColumns(rows: PageRow[], fields: PageField[]): Array<{ field: PageField; value: unknown }> {
  if (rows.length < 2) {
    return [];
  }
  const out: Array<{ field: PageField; value: unknown }> = [];
  for (const f of fields) {
    if (!f.hideWhenConstant) {
      continue;
    }
    const first = resolveField(rows[0]!, f.from ?? f.key);
    if (isEmptyValue(first)) {
      continue;
    }
    const same = rows.every(r => String(resolveField(r, f.from ?? f.key)) === String(first));
    if (same) {
      out.push({ field: f, value: first });
    }
  }
  return out;
}

export type TableLayout = {
  /** The column that leads each row, or null on a page with no `primary`. */
  primary: PageField | null;
  /** The fields that read as the primary's muted second line, in order. */
  subtitle: PageField[];
  /** The remaining columns, in declaration order. */
  columns: PageField[];
  /** Columns collapsed into the line above the table. */
  constants: Array<{ field: PageField; value: unknown }>;
};

/**
 * How one table's rows are laid out: which field leads, which read under it,
 * which stay columns, and which collapsed because they said one thing.
 * Computed per table, so a grouped page can collapse a column inside one
 * group and keep it in another.
 * @param rows - The rows under this table.
 * @param fields - The page's fields.
 * @param primary - The page's `primary` block, if it declared one.
 */
export function tableLayout(rows: PageRow[], fields: PageField[], primary?: PagePrimary): TableLayout {
  const byKey = (k: string) => fields.find(f => f.key === k) ?? null;
  const lead = primary ? byKey(primary.field) : null;
  const sub = (primary?.subtitle ?? []).map(byKey).filter((f): f is PageField => f !== null);
  const spoken = new Set([lead?.key, ...sub.map(f => f.key)].filter(Boolean) as string[]);
  const rest = fields.filter(f => !spoken.has(f.key));
  // A constant fact is hoisted wherever it was going to be repeated — out
  // of a column, and out of the subtitle, which would otherwise say
  // "squatch-core" once per row just as loudly.
  const constants = constantColumns(rows, [...sub, ...rest]);
  const constantKeys = new Set(constants.map(c => c.field.key));
  return {
    primary: lead,
    subtitle: sub.filter(f => !constantKeys.has(f.key)),
    columns: rest.filter(f => !constantKeys.has(f.key)),
    constants,
  };
}

/**
 * The classes that drop a column on a narrow container. Priority 1 is
 * always drawn; below a wide desktop the 3s go, and below a tablet the 2s
 * go with them. Container queries rather than viewport ones, so a table
 * rendered inside a narrow panel reads the way it would on a phone.
 * @param priority - The column's declared priority.
 */
export function priorityClass(priority: number): string {
  if (priority >= 3) {
    return 'hidden @5xl:table-cell';
  }
  if (priority === 2) {
    return 'hidden @2xl:table-cell';
  }
  return '';
}

/**
 * A URL as a label short enough to be a column. The Factory floor's PR
 * column carried the whole
 * `https://github.com/squatch/squatch-core/pull/318`, which is wider than
 * the task title it was competing with; a pull request reads as `#318`,
 * anything else as its host and last segment. The full address is the
 * anchor's `href` and its tooltip, so nothing is lost.
 * @param url - The raw value.
 */
export function shortUrlLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const numbered = /\/(?:pull|issues|merge_requests)\/(\d+)/.exec(parsed.pathname);
  if (numbered) {
    return `#${numbered[1]}`;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const last = parsed.pathname.split('/').filter(Boolean).at(-1);
  return last ? `${host}/${last}` : host;
}
