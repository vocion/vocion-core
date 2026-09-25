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
 * (the `overview` archetype — typed panels over the same rows — was removed on
 * 2026-09-24 with the Factory page, the only page that ever used it) -
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
   * `duration` reads an integer number of seconds as "18m 25s", because a
   * run's length is the thing being compared and `1105` is not.
   */
  format: z.enum(['text', 'badge', 'score', 'date', 'mono', 'image', 'icon', 'money', 'link', 'relative', 'progress', 'steps', 'duration', 'compare', 'workload']).default('text'),
  /**
   * For `format: compare`, the figure ours is read against and who it
   * belongs to. Our price beside the incumbent's is one fact, not four
   * columns: the comparison reads as "$15/mo per seat vs DocSend $30/user/mo"
   * with the date it was checked on hover. Either side may be missing; the
   * field is empty only when both are.
   */
  beside: z.object({
    /** The figure to compare against, e.g. `meta.incumbent.listPrice`. */
    from: z.string().min(1),
    /** Whose figure it is, e.g. `meta.incumbent.name`. */
    labelFrom: z.string().optional(),
    /** When it was last verified. Secondary, so it renders on hover. */
    checkedFrom: z.string().optional(),
  }).optional(),
  /**
   * Where this field's value COMES from, and what to say when nothing is
   * feeding it. A value and the absence of a feed are different facts and
   * must never render the same: a product whose monitor says `degraded` is
   * in trouble, and a product nothing monitors is one WE have not wired up.
   * "Unknown" says the first about the second, which blames the product for
   * our own gap.
   *
   * `from` names the accessor (or accessors, tried in order) that says a
   * source exists. When none of them resolve, the cell renders
   * `absentLabel` in the page's own words instead of the value, even if a
   * value happens to be sitting there, and a stat or filter over the field
   * is unaffected, because this is a rendering rule, not a data one.
   */
  source: z.object({
    from: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    /** What the cell says when nothing feeds this field, e.g. "monitoring not connected". */
    absentLabel: z.string().min(1),
  }).optional(),
  /**
   * For `format: workload`, how to read a queue as a shape rather than a
   * number. "10 open" can be a disaster, a healthy backlog, ten small ideas
   * or nine answered things nobody closed; the reader cannot tell which, so
   * the figure is not yet information. What makes it one is how much of it
   * is moving and whether any of it is urgent, which is the whole of the
   * judgement a portfolio row is asked for. The backlog itself lives on
   * Work; this says only whether to go there now.
   */
  workload: z.object({
    /** What one item is called, singular, e.g. "open request". */
    noun: z.string().min(1),
    /** How many of them are being worked on right now. */
    inFlightFrom: z.string().optional(),
    /** How many need someone today. Rendered in the `bad` tone when above zero. */
    urgentFrom: z.string().optional(),
    /** What urgent is called here, e.g. "urgent" or "P1". */
    urgentLabel: z.string().default('urgent'),
  }).optional(),
  /**
   * A second, muted line under the value: a fact and the thing that
   * qualifies it, drawn as ONE fact rather than two fields the reader has
   * to pair up. "The document page has one Share button" is what shipped;
   * "yesterday" is whether that still counts as news, and a row that spends
   * two labelled slots on them has said one thing twice as slowly.
   */
  caption: z.object({
    /** Where the qualifying value is read from. */
    from: z.string().min(1),
    /** How to draw it. `relative` reads a timestamp as its distance from now. */
    format: z.enum(['text', 'date', 'relative']).default('text'),
  }).optional(),
  /**
   * Draw this field ONLY where its date has gone stale. Freshness is not
   * news until it stops being fresh. A "counters as of" stamp on every row
   * of a healthy board is the machinery reporting that it ran, which is
   * Vocion's business and not the reader's; the same stamp on a row whose
   * figures are a week old is the most important thing on that row.
   *
   * A row inside the window renders nothing for the field, which makes the
   * field empty there, so on a board where everything is current
   * `hideWhenEmpty` takes the whole column away and the page is shorter
   * exactly while things are fine. This is the same property as
   * "the interface gets quieter as the system gets healthier", expressed
   * once in the page layer rather than per page.
   */
  staleAfterHours: z.number().positive().optional(),
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
   * Drop this field entirely when NO row has a value for it. The sibling of
   * `hideWhenConstant`, and the general form of a platform rule: a missing
   * optional capability should make the interface SMALLER, not fill it with
   * blank cells. A revenue column of dashes does not report that revenue is
   * zero. It advertises that we never built revenue, once per row, in the
   * width a fact could have used.
   *
   * On by default, because a column no row can fill is never the reading a
   * page was opened for. A field that must hold its place while it waits
   * for a value, such as a checklist of things each row is expected to
   * carry, sets it false and keeps its dashes.
   *
   * Distinct from `hideWhenConstant`, which hides a field every row ANSWERS
   * the same way, and says the answer once above the table. A field hidden
   * here is saying nothing, so nothing is hoisted.
   */
  hideWhenEmpty: z.boolean().default(true),
  /**
   * Which edge the value sits against. Figures read down a column when
   * they share a right edge, so `money` and `score` default to `right`
   * and everything else to `left`; this overrides that.
   */
  align: z.enum(['left', 'right']).optional(),
  /**
   * Progressive disclosure: this field is evidence, not a column. It is not
   * drawn in the table at all, and reads inside the row's own disclosure
   * instead, under its label.
   *
   * `priority` already drops a column on a narrow screen, which is a
   * different problem: a `priority: 3` column is one the page would still
   * like to show and the viewport will not allow. A `detail` field is one
   * the page does NOT want in the row. A heartbeat and a lease matter while
   * a run is alive and are noise on a run that finished yesterday; tokens
   * explain a cost when someone is investigating one and are a wall of
   * digits when nobody is.
   */
  detail: z.boolean().default(false),
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
  op: z.enum(['eq', 'neq', 'gte', 'lte', 'in', 'exists', 'missing', 'since']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
}).refine(f => f.op !== 'since' || SinceValueSchema.safeParse(f.value).success, { message: 'since takes month, week, today or <n>d', path: ['value'] });

/** One filter, or every one of several that a row must pass. */
const WhereSchema = z.union([FilterSchema, z.array(FilterSchema).min(1)]);

/**
 * `where: {…}` and `where: [{…}, {…}]` both read as a list of filters.
 * @param where - One filter, several, or none.
 */
export function filtersOf(where: z.infer<typeof WhereSchema> | undefined): z.infer<typeof FilterSchema>[] {
  return where === undefined ? [] : Array.isArray(where) ? where : [where];
}

const StatSchema = z.object({
  label: z.string(),
  kind: z.enum(['count', 'avg', 'min', 'max', 'sum', 'pctGte', 'countWhere', 'ratio', 'medianHours']),
  /** Field the stat computes over (same accessor grammar as FieldSchema.from). */
  field: z.string().optional(),
  threshold: z.number().optional(),
  where: WhereSchema.optional(),
  /**
   * `ratio` only: the DENOMINATOR's rows. Left out, the denominator counts
   * the same rows the numerator does, which is what makes "cost per shipped
   * outcome" reconcile against "shipped outcomes" beside it: one pool, one
   * count, and a reader who divides the two headline figures gets the third.
   */
  of: WhereSchema.optional(),
  /**
   * `ratio` only: the field summed over the denominator's rows. Left out,
   * the denominator is a count of them. `field` over `overField` is how a
   * share of spend is stated (rework cents over all cents).
   */
  overField: z.string().optional(),
  /** `medianHours` only: the accessor holding the START date; `field` holds the end. */
  from: z.string().optional(),
  /** Optional suffix, e.g. "%" or "applicants". */
  suffix: z.string().optional(),
  /**
   * Show this figure against the period immediately before it.
   *
   * A number on its own is nearly unreadable: `$1.28 per release` says almost
   * nothing, while `$1.28 ↓ 38%` says the thing a reader came for. So a stat
   * that opts in is computed twice — over the chosen window, and over the
   * window of the same length ending where it began — and carries the change
   * between them.
   *
   * Needs the page to declare a `window`: without one there is no period, and
   * therefore no prior period to compare against.
   */
  compare: z.enum(['prior']).optional(),
  /**
   * Which direction is GOOD, for a stat that compares. Cost falling is good
   * and quality falling is not, and no amount of arithmetic can tell them
   * apart — the page has to say. Left out, the change is shown without a
   * judgement attached.
   */
  goodWhen: z.enum(['up', 'down']).optional(),
  /**
   * `money` reads the figure as cents and shows dollars, the way a `money`
   * field does; `percent` reads a `ratio` as a share and shows it as one.
   */
  format: z.enum(['number', 'money', 'percent']).default('number'),
  /**
   * Leave the figure out entirely when it is zero. "0 lost" is a tile spent
   * telling a person that a thing which did not happen did not happen, and
   * it sits beside the figures that did. A count of an exception belongs on
   * the page when the exception happened and nowhere else.
   */
  hideWhenZero: z.boolean().default(false),
  /**
   * The section this figure belongs under. Stats with no group are the
   * headline row, in the order they are written; every other group follows
   * under its own heading, groups in first-seen order. A page that promises
   * four numbers can then show four, and put quality beside them rather than
   * in the same undifferentiated grid.
   */
  group: z.string().optional(),
  /**
   * What the figure measures, exactly: the sentence that would otherwise be
   * a methodology paragraph on the page. Rendered behind an information
   * affordance next to the number, never beside it.
   */
  note: z.string().optional(),
  /** Ignore the page's time window: this figure is cumulative on purpose. */
  lifetime: z.boolean().optional(),
});

/**
 * One time window the whole page obeys.
 *
 * Without it a page mixes "this month", "cumulative" and figures that never
 * said, and no two of them can be compared. `field` is the date every row is
 * judged by, `options` are the choices in days, and `all` is offered last so
 * a lifetime view stays one click away. The chosen window filters the rows
 * AND every stat that has not marked itself `lifetime`.
 */
const PageWindowSchema = z.object({
  /** The row's date the window is measured against. */
  field: z.string().min(1),
  /** The choices, in days, smallest first. */
  options: z.array(z.number().int().positive().max(3650)).min(1).default([7, 30, 90]),
  /** Which choice a first visit gets: a number of days, or `all`. */
  default: z.union([z.number().int().positive().max(3650), z.literal('all')]).default(30),
  /** What the date means, in a person's words, such as "cost last moved". */
  label: z.string().optional(),
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
  /** Which rows the series is over: shipped outcomes per week, not rows per week. */
  where: WhereSchema.optional(),
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
 *
 * `href` can also be an ordered list of candidate templates for a row that
 * can name one of several targets depending what it has: the run that named
 * its request lands on the feature report, the run that only named its task
 * lands on the task record, and the run that named neither draws no link at
 * all. Each candidate is tried in order and the first one every token of
 * which resolves wins; this is a fallback chain, never a choice of which is
 * "better", since the row itself has already decided that by what it can fill.
 */
const RowActionSchema = z.object({
  label: z.string().min(1),
  href: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
});

/**
 * A named way of looking at the same page, chosen with `?view=<key>`.
 *
 * A page called Activity that only ever shows worker runs is misnamed: the
 * name promises everything that happened. Views let one page carry the
 * chronological operational timeline AND the run-oriented table a person
 * debugs with, without either of them becoming a second page that drifts.
 *
 * Two kinds, and the difference is honest rather than cosmetic:
 *
 * - A view with `filters` narrows THIS page's rows. The first view declared
 *   is the default, and it is the one a bare visit lands on.
 * - A view with `href` is a different surface that belongs in the same row of
 *   tabs, and says so by navigating there. Releases and decisions are not
 *   worker runs and pretending they are the same rows would be a lie about
 *   the data. What they share is the question "what happened", so they share
 *   the switcher.
 *
 * A view never changes the source. A tab that quietly queried something else
 * would make the summary above it mean a different thing per tab, which is
 * the defect this page was built to stop repeating.
 */
const ViewSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]*$/, { message: 'a view key is lowercase alphanumeric with dashes' }),
  label: z.string().min(1),
  /** One line under the switcher saying what this view is showing. */
  note: z.string().optional(),
  filters: z.array(FilterSchema).optional(),
  href: z.string().min(1).optional(),
}).refine(v => (v.filters === undefined) || (v.href === undefined), {
  message: 'a view either narrows these rows or opens another surface, not both',
  path: ['href'],
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
    /**
     * Sits under "More" rather than in the sidebar proper, however few pages
     * a workspace has.
     *
     * Overflow alone could not express this. It hides the SEVENTH page and
     * onwards, which is a statement about how much fits — not about what a
     * person needs daily. A factory log, a cost ledger and a decisions
     * archive are forensic: real, occasionally essential, and not where
     * anybody starts. Hiding them behind a count meant a workspace with six
     * pages showed all six with equal weight, and the hierarchy only appeared
     * once somebody added a seventh.
     */
    secondary: z.boolean().default(false),
  }).default({ section: 'Workspace', order: 0, hidden: false, secondary: false }),
  /**
   * `link` is a nav row, not a page: it pins an existing core route into the
   * manifest's section under its own label, and `/dashboard/p/<slug>`
   * redirects to `href`. It exists so a plugin can seat a core surface (the
   * team report) beside its own pages without duplicating it.
   */
  archetype: z.enum(['list', 'queue', 'markdown', 'link', 'report', 'wiki']),
  /** Required by `link`: the route the row opens. */
  href: z.string().min(1).optional(),

  // ---- report config ----
  /** Required by `report` — see {@link ReportSchema}. */
  report: ReportSchema.optional(),

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
    /**
     * The field holding this row's PICTURE, drawn leading the block rather
     * than as one more labelled fact.
     *
     * A fact list puts an uppercase label above its value, which is the right
     * shape for a figure and the wrong one for an image: "PREVIEW" above a
     * thumbnail is a caption saying what a person can already see. Named
     * here rather than inferred from `format: image` because a page may draw
     * an image that is a column — an avatar in a table — and only `primary`
     * knows which one leads.
     */
    thumb: z.string().optional(),
    /**
     * The field drawn in the picture's place when the row has no picture — a
     * named icon (`format: icon`), so every card has a mark at its left edge
     * and none has an empty frame (Chris, 2026-09-24: "there is still no
     * icon for almost every work item").
     */
    thumbFallback: z.string().optional(),
  }).optional(),
  /**
   * How a `list` page draws a row. `table` is the grid of columns. `block`
   * draws each row as one readable unit instead: the headline, its muted
   * second line, then the remaining fields as labelled facts that wrap.
   *
   * A table is the right shape when rows are compared DOWN a column:
   * fourteen tasks by cost. It is the wrong shape when a page holds a
   * handful of rows a person reads ACROSS: a portfolio of two products in
   * fourteen columns is a horizontal scrollbar, and every field a row does
   * not carry is a dash taking up the width. In `block` a field is drawn
   * only where it has a value, so a sparse row is short rather than gappy,
   * and a label travels with its value instead of living in a header the
   * reader has to look back up at.
   */
  layout: z.enum(['table', 'block']).default('table'),
  /**
   * A named derivation run over the rows BEFORE filters, sort, grouping and
   * stats, so the page can be declared in the words a person reads rather
   * than in the fields a record happens to store.
   *
   * `workQueue` is the software factory's Work page: seven request states
   * read as four lanes, the reason as a sentence, the money as the one
   * figure the lane makes sense of, probes and the archive dropped, and the
   * whole queue's counts stamped on every kept row so the top line counts
   * what exists rather than what fitted (libs/workspace/workQueue.ts).
   *
   * A closed set of one, like the report archetype's `subject`: a derivation
   * knows what these records MEAN and is not a general expression language
   * on a page. A second one gets declared here when it exists.
   */
  derive: z.enum(['workQueue', 'releaseOutcome', 'productBoard']).optional(),
  filters: z.array(FilterSchema).optional(),
  /**
   * Named ways of looking at the same rows, chosen with `?view=<key>` and
   * drawn as a switcher above the summary. First one declared is the
   * default. See {@link ViewSchema}.
   */
  views: z.array(ViewSchema).min(2).max(8).optional(),
  /**
   * Whether the rows themselves are drawn under the figures.
   *
   * An analytics page is its figures; the records behind them are somebody
   * else's page. Performance listing every request turned it into a second
   * backlog — the same rows Backlog already owns, in a worse order, under
   * headings that were not about them. A page that says `false` keeps its
   * source (the figures are computed from it) and links out instead.
   */
  showRows: z.boolean().default(true),
  groupBy: z.string().optional(),
  /**
   * How {@link groupBy}'s groups are drawn: stacked `sections` down one page,
   * or `tabs`.
   *
   * Sections are right when a reader wants them all at once — a report read
   * top to bottom. Tabs are right when each group is a PLACE: the Work queue's
   * three lanes are three different questions ("what is running", "what do we
   * owe", "what landed"), and a person opens the page holding one of them, so
   * stacking all three costs them the height of the other two before they
   * reach it.
   */
  groupsAs: z.enum(['sections', 'tabs']).default('sections'),
  sort: z.object({ field: z.string(), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  stats: z.array(StatSchema).optional(),
  /**
   * How many rows a summary has to be summarising before it is drawn. A
   * summary earns its place by saving the reader from reading the rows, and
   * over two rows it saves nobody anything: seven cards above two products
   * restate what the two lines underneath already say, in more space and one
   * recomputation further from the truth. The same seven cards over twenty
   * products are the reason to open the page.
   *
   * So the summary appears when the page grows into needing one, and a page
   * that never says otherwise keeps today's behaviour.
   */
  statsMinRows: z.number().int().min(0).default(0),
  /** One time window every stat and row obeys; see {@link PageWindowSchema}. */
  window: PageWindowSchema.optional(),
  /**
   * Prose that explains HOW the figures are computed, rendered collapsed
   * behind "How these numbers are computed" rather than above them. Defaults
   * to `<slug>.methodology.md` next to the yaml, and is simply absent when
   * no such file ships. An index communicates results; the method is one
   * click away, not a paragraph a reader must step over.
   */
  methodologyFile: z.string().optional(),
  /** Figures over time, drawn under the stats — see {@link SeriesSchema}. */
  series: z.array(SeriesSchema).optional(),
  /** Row click-through, e.g. `/dashboard/objects/{id}`. `{id}` interpolates. */
  rowLink: z.string().optional(),
  /** Trailing links on each row — see {@link RowActionSchema}. */
  rowActions: z.array(RowActionSchema).default([]),
  /**
   * How a block draws its row actions: `links` under the facts, or `menu` —
   * one quiet ⋯ control at the card's corner holding the places the row can
   * ALSO go, so the card itself stays one tap to one place.
   */
  rowActionsAs: z.enum(['links', 'menu']).default('links'),
  /**
   * Filters a URL may switch on: `?product=send` narrows the page to rows
   * whose `field` equals the value, and the page says so with a way back.
   * This is how one card on Products opens Work AS that product's work
   * rather than a second page — see {@link applyQueryFilters}.
   */
  /**
   * The page's own asks: buttons that open a NEW chat with the prompt already
   * sent (to `agent` when named). The words are the workspace's to manage.
   */
  prompts: z.array(z.object({ label: z.string().min(1).max(40), prompt: z.string().min(1), agent: z.string().optional() })).optional(),
  queryFilters: z.array(z.object({ param: z.string().min(1), field: z.string().min(1), label: z.string().optional(), default: z.string().min(1).optional() })).optional(),
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
  // A wiki is a folder of markdown pages read as pages: the source names the folder, nothing else is declared.
  .refine(m => m.archetype !== 'wiki' || (m.source !== undefined && m.source.kind === 'artifacts' && typeof m.source.folder === 'string'), { message: 'a wiki page needs source: {kind: artifacts, folder: <name>} — the folder its pages live in', path: ['source'] })
  .refine(m => m.live === undefined || m.archetype === 'list' || m.archetype === 'queue', { message: 'live is for list and queue pages — the ones with rows to re-read', path: ['live'] })
  .refine(m => m.layout === 'table' || m.archetype === 'list', { message: 'layout: block is for list pages, the ones with rows to draw', path: ['layout'] })
  .refine(m => m.groupsAs !== 'tabs' || !!m.groupBy, { message: 'groupsAs: tabs needs groupBy — tabs are the groups', path: ['groupsAs'] })
  .refine(m => m.layout === 'table' || m.fields === undefined || m.fields.every(f => !f.total), { message: 'a block layout has no column to total under', path: ['layout'] })
  .refine(m => m.derive === undefined || m.archetype === 'list', { message: 'derive is for list pages, the ones with rows to derive from', path: ['derive'] })
  .refine(
    m => m.primary === undefined
      || [m.primary.field, ...m.primary.subtitle].every(k => (m.fields ?? []).some(f => f.key === k)),
    { message: 'primary names a field this page does not declare', path: ['primary'] },
  )
  .refine(m => m.views === undefined || m.archetype === 'list' || m.archetype === 'queue', { message: 'views are for list and queue pages, the ones with rows to narrow', path: ['views'] })
  .refine(m => m.views === undefined || new Set(m.views.map(v => v.key)).size === m.views.length, { message: 'two views share a key', path: ['views'] })
  .refine(m => m.views === undefined || m.views[0]?.href === undefined, { message: 'the first view is the default, so it has to be a view of this page rather than a link away from it', path: ['views'] });

export type PageManifest = z.infer<typeof PageManifestSchema>;
/** A validated page plus where it came from, so its prose resolves beside it. */
export type LoadedPage = PageManifest & {
  /** Absolute directory the YAML was read from. */
  sourceDir: string;
  /** `workspace`, or the slug of the plugin that ships it. */
  origin: 'workspace' | `plugin:${string}`;
  /** A workspace page that replaces a plugin's page of the same slug keeps that plugin's place in the nav. */
  overrides?: `plugin:${string}`;
};
export type PageField = z.infer<typeof FieldSchema>;
export type PageView = z.infer<typeof ViewSchema>;
export type PagePrimary = NonNullable<z.infer<typeof PageManifestSchema>['primary']>;
export type PageLive = z.infer<typeof LiveSchema>;
export type PageStat = z.infer<typeof StatSchema>;
export type PageWindow = z.infer<typeof PageWindowSchema>;
export type PageSeries = z.infer<typeof SeriesSchema>;
export type PageWidget = z.infer<typeof WidgetSchema>;
export type PageRowAction = z.infer<typeof RowActionSchema>;
export type PageReport = z.infer<typeof ReportSchema>;

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
 * A row action's href, which is either one template or an ordered list of
 * fallback templates. Each is tried in turn through {@link interpolateHref};
 * the first one every token of which the row can fill wins. Null when none
 * of them can: the row draws no link rather than a link to a 404.
 * @param row - The row.
 * @param hrefOrHrefs - The action's `href`, a template or a fallback list.
 */
export function resolveRowActionHref(row: PageRow, hrefOrHrefs: string | string[]): string | null {
  const templates = Array.isArray(hrefOrHrefs) ? hrefOrHrefs : [hrefOrHrefs];
  for (const template of templates) {
    const href = interpolateHref(row, template);
    if (href !== null) {
      return href;
    }
  }
  return null;
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

/** One filter a URL switched on, with the words the page uses to say so. */
export type ActiveQueryFilter = { param: string; field: string; label: string; value: string };

/**
 * The query filters a URL actually names, read off its search params. A
 * param that is absent or empty switches nothing on; a repeated param takes
 * its first value.
 * @param declared - The page's `queryFilters`.
 * @param searchParams - The request's search params.
 */
export function activeQueryFilters(declared: Array<{ param: string; field: string; label?: string; default?: string }> | undefined, searchParams: Record<string, string | string[] | undefined>): ActiveQueryFilter[] {
  return (declared ?? []).flatMap((q) => {
    const raw = searchParams[q.param];
    // A DEFAULT is the filter a page opens with when the URL names none — a
    // factory that builds one product opens on that product. `all` is the
    // way out, and the only value that means "no filter" rather than a match.
    const given = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    const value = given === undefined ? (q.default ?? '') : given;
    return value === '' || value.toLowerCase() === 'all' ? [] : [{ param: q.param, field: q.field, label: q.label ?? q.param, value }];
  });
}

/**
 * Rows narrowed to the filters a URL switched on. Equality, case-insensitive
 * on strings, because a slug in a URL is typed by people and pasted by links.
 * @param rows - The page's rows.
 * @param active - From {@link activeQueryFilters}.
 */
export function applyQueryFilters(rows: PageRow[], active: ActiveQueryFilter[]): PageRow[] {
  if (active.length === 0) {
    return rows;
  }
  return rows.filter(r => active.every((f) => {
    const v = resolveField(r, f.field);
    return v !== undefined && v !== null && String(v).toLowerCase() === f.value.toLowerCase();
  }));
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
      // The inverse, because "reached an outcome with nobody deciding it" is
      // a count of rows a field is ABSENT from, and a page could only ask
      // for the rows it was present on.
      case 'missing': return v === undefined || v === null || v === '';
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
    // An average, a smallest and a largest of NOTHING are not zero. `count`
    // and `sum` still are: nothing counted is none, nothing spent is £0.
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : Number.NaN;
    case 'min':
      return nums.length ? Math.min(...nums) : Number.NaN;
    case 'max':
      return nums.length ? Math.max(...nums) : Number.NaN;
    default:
      return 0;
  }
}

function numbersOf(rows: PageRow[], field: string | undefined): number[] {
  return field
    ? rows.map(r => resolveField(r, field)).filter((v): v is number => typeof v === 'number')
    : [];
}

function renderFigure(value: number, format: 'number' | 'money' | 'percent', suffix = ''): string {
  // NOTHING TO DIVIDE BY IS NOT ZERO.
  //
  // Performance led with `0 h`, `0 %` and `0 min` on a factory that had
  // shipped one release, because a median of no samples and a ratio over a
  // zero denominator both fell through to 0. Read plainly that page said the
  // factory takes no time, accepts nothing and needs no one — three false
  // claims, stated with the confidence of a measurement. A figure nobody can
  // compute has to say so; "not enough yet" is checkable and a wrong zero is
  // not (principle 10, and value 3: show your work).
  if (!Number.isFinite(value)) {
    return 'not enough yet';
  }
  if (format === 'money') {
    return `${formatMoney(value)}${suffix}`;
  }
  if (format === 'percent') {
    return `${Math.round(value * 1000) / 10}%${suffix}`;
  }
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return `${rounded}${suffix}`;
}

/**
 * The median of these numbers, the even case averaged. Empty is NaN — there is
 * no middle of nothing, and {@link renderFigure} turns NaN into a sentence.
 * @param nums - The numbers, in any order.
 */
function median(nums: number[]): number {
  if (nums.length === 0) {
    return Number.NaN;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Hours from `from` to `field` on every row that carries both dates in that
 * order. A row missing either end is left out rather than counted as zero:
 * an outcome with no ship date has no cycle time, and inventing one would be
 * the kind of number this page exists to stop.
 * @param rows - The pool.
 * @param stat - The stat, whose `from` is the start and `field` the end.
 */
function elapsedHours(rows: PageRow[], stat: PageStat): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const start = toDate(resolveField(r, stat.from ?? ''));
    const end = toDate(resolveField(r, stat.field ?? ''));
    if (start === null || end === null || end.getTime() < start.getTime()) {
      continue;
    }
    out.push((end.getTime() - start.getTime()) / 3_600_000);
  }
  return out;
}

/**
 * A stat's figure, rendered.
 *
 * `ratio` is the one worth reading twice. Its numerator is `field` summed
 * over the rows `where` keeps, or a count of them when no field is named;
 * its denominator is `overField` summed over the rows `of` keeps, or a count
 * of THOSE, and `of` defaults to the same rows as `where`. So a cost per
 * outcome divides the spend on a pool by the SIZE of that pool, not by how
 * many of its rows happened to carry a figure, which is what let a page show
 * an average nobody could reproduce by dividing the two numbers beside it.
 * @param rows - The page's rows, already narrowed to the page's time window.
 * @param stat - The declaration.
 * @param now - The clock, for `since` filters.
 */
export function computeStat(rows: PageRow[], stat: PageStat, now: Date = new Date()): string {
  return renderFigure(statValue(rows, stat, now), stat.format, stat.suffix);
}

/**
 * The stat as a NUMBER, before it is formatted.
 *
 * Split out of {@link computeStat} so a period comparison can divide one
 * period's figure by another's. Formatting is the last thing that happens to
 * a figure, and a delta has to be computed before it.
 * @param rows - The rows in scope.
 * @param stat - The stat declaration.
 * @param now - The clock.
 */
export function statValue(rows: PageRow[], stat: PageStat, now: Date = new Date()): number {
  const pool = applyFilter(rows, filtersOf(stat.where), now);
  const nums = numbersOf(pool, stat.field);
  let value: number;
  switch (stat.kind) {
    case 'countWhere':
      value = pool.length;
      break;
    case 'pctGte': {
      const t = stat.threshold ?? 0;
      value = nums.length ? (nums.filter(n => n >= t).length / nums.length) * 100 : Number.NaN;
      break;
    }
    case 'medianHours':
      value = median(elapsedHours(pool, stat));
      break;
    case 'ratio': {
      const over = stat.of === undefined ? pool : applyFilter(rows, filtersOf(stat.of), now);
      const numerator = stat.field === undefined ? pool.length : nums.reduce((a, b) => a + b, 0);
      const denominator = stat.overField === undefined
        ? over.length
        : numbersOf(over, stat.overField).reduce((a, b) => a + b, 0);
      value = denominator === 0 ? Number.NaN : numerator / denominator;
      break;
    }
    default:
      value = aggregate(stat.kind, pool, nums);
  }
  return value;
}

/** A figure beside the one before it. */
export type StatChange = {
  /** The figure for the chosen window, formatted. */
  value: string;
  /** The same figure for the window before it, formatted. */
  prior: string;
  /** Percent change, or null when the prior period was zero or unmeasurable. */
  percent: number | null;
  /** Which way it moved. */
  direction: 'up' | 'down' | 'flat';
  /** Whether the move is the good one, where the stat said which way is good. */
  good: boolean | null;
};

/**
 * The rows of the period immediately BEFORE the chosen window: the same span,
 * ending where the window begins.
 *
 * Not "everything older" — a thirty-day figure has to be compared with thirty
 * days, or a factory that has been running for a year will always look like
 * it is improving.
 * @param rows - Every row the page loaded.
 * @param window - The page's window declaration.
 * @param days - The chosen span in days.
 * @param now - The clock.
 */
export function priorWindowRows(rows: PageRow[], window: PageWindow, days: number, now: Date = new Date()): PageRow[] {
  const end = now.getTime() - days * 86_400_000;
  const start = end - days * 86_400_000;
  return rows.filter((r) => {
    const d = toDate(resolveField(r, window.field));
    return d !== null && d.getTime() >= start && d.getTime() < end;
  });
}

/**
 * A stat and the same stat one period earlier.
 *
 * `$1.28 per release` is nearly unreadable on its own; `$1.28 ↓ 38%` is the
 * thing a reader came for. Returns null when the page declares no window, or
 * the reader chose `all`, because then there is no period and so no prior one.
 * @param all - Every row the page loaded, BEFORE the window was applied.
 * @param stat - The stat declaration.
 * @param window - The page's window declaration.
 * @param days - The chosen span, or `all`.
 * @param now - The clock.
 */
export function computeStatChange(
  all: PageRow[],
  stat: PageStat,
  window: PageWindow | undefined,
  days: number | 'all',
  now: Date = new Date(),
): StatChange | null {
  if (stat.compare !== 'prior' || !window || days === 'all') {
    return null;
  }
  const nowValue = statValue(applyWindow(all, window, days, now), stat, now);
  const priorValue = statValue(priorWindowRows(all, window, days, now), stat, now);
  // A prior period of zero cannot produce a percentage — "up from nothing" is
  // infinite, not 100%. The figures are still shown; only the change is not.
  const percent = priorValue === 0 ? null : ((nowValue - priorValue) / Math.abs(priorValue)) * 100;
  const direction = nowValue === priorValue ? 'flat' : nowValue > priorValue ? 'up' : 'down';
  return {
    value: renderFigure(nowValue, stat.format, stat.suffix),
    prior: renderFigure(priorValue, stat.format, stat.suffix),
    percent,
    direction,
    good: stat.goodWhen === undefined || direction === 'flat' ? null : direction === stat.goodWhen,
  };
}

/**
 * Whether a rendered figure is nothing: `0`, `0%`, `$0.00`. A stat that
 * declared `hideWhenZero` is left off the page when this is true, so the
 * summary strip carries the exceptions that happened and not the ones that
 * did not.
 * @param rendered - The figure as {@link computeStat} rendered it.
 */
export function isZeroFigure(rendered: string): boolean {
  return /^-?\$?0(?:\.0+)?\D*$/.test(rendered.trim());
}

/**
 * The rows a chosen time window keeps: those whose `window.field` is on or
 * after the cutoff. `all` keeps everything. A row with no readable date is
 * dropped from every finite window and appears only under `all`: it did not
 * happen in the last thirty days, and keeping it there would put work of
 * unknown age inside a figure that claims a period.
 * @param rows - Every row the page loaded.
 * @param window - The page's window declaration, or undefined for no window.
 * @param days - The chosen span in days, or `all`.
 * @param now - The clock.
 */
export function applyWindow(rows: PageRow[], window: PageWindow | undefined, days: number | 'all', now: Date = new Date()): PageRow[] {
  if (!window || days === 'all') {
    return rows;
  }
  const cutoff = now.getTime() - days * 86_400_000;
  return rows.filter((r) => {
    const d = toDate(resolveField(r, window.field));
    return d !== null && d.getTime() >= cutoff;
  });
}

/**
 * The window a request asked for, kept inside the page's own choices so a
 * hand-typed `?days=9999` cannot quietly widen a figure past what the page
 * says it is showing.
 * @param window - The page's window declaration.
 * @param raw - The `days` search parameter, if any.
 */
export function chosenWindow(window: PageWindow | undefined, raw: string | undefined): number | 'all' {
  if (!window) {
    return 'all';
  }
  if (raw === 'all') {
    return 'all';
  }
  const n = Number.parseInt(raw ?? '', 10);
  return window.options.includes(n) ? n : window.default;
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
  for (const r of applyFilter(rows, filtersOf(series.where), now)) {
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
  return field.align ?? (field.format === 'money' || field.format === 'score' || field.format === 'duration' ? 'right' : 'left');
}

/**
 * Seconds as the length a person compares runs by: `18m 25s`, `2h 4m`, `43s`.
 * A run that took 1105 seconds and one that took 969 are hard to tell apart
 * as integers and obvious as minutes.
 * @param seconds - An integer number of seconds.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
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

/**
 * Every accessor a field draws from: its own, plus the figure a `compare`
 * field reads itself against, the counts a `workload` field shapes itself
 * with, and a `caption`. A comparison with one side recorded is still worth
 * drawing ("priced against Loom, price not recorded"), so every side counts
 * towards whether the field has anything to say.
 * @param field - The field declaration.
 */
export function fieldAccessors(field: PageField): string[] {
  const own = field.from ?? field.key;
  const also = [field.beside?.from, field.beside?.labelFrom, field.workload?.inFlightFrom, field.workload?.urgentFrom, field.caption?.from];
  return [own, ...also.filter((a): a is string => a !== undefined)];
}

/**
 * Whether a `staleAfterHours` field is being held back on this row because
 * its date is still inside the window. See {@link FieldSchema}. A field that
 * never asked for the rule is never held back, and a field that asked for it
 * and has no date at all is: an unstamped row is not a fresh one, but it is
 * also not news until something is there to be stale.
 * @param row - The row.
 * @param field - The field declaration.
 * @param now - The instant staleness is measured against.
 */
export function fieldIsFresh(row: PageRow, field: PageField, now?: number): boolean {
  if (field.staleAfterHours === undefined || now === undefined) {
    return false;
  }
  const at = toDate(resolveField(row, field.from ?? field.key));
  return at !== null && now - at.getTime() < field.staleAfterHours * 3_600_000;
}

/**
 * Whether this row has anything for this field. A field held back for being
 * fresh has nothing to say on this row, which is what lets a board where
 * every counter is current drop the freshness field altogether.
 * @param row - The row.
 * @param field - The field declaration.
 * @param now - The instant `staleAfterHours` is measured against.
 */
export function fieldIsEmptyOn(row: PageRow, field: PageField, now?: number): boolean {
  if (fieldIsFresh(row, field, now)) {
    return true;
  }
  // A field that declared a source and has none is not empty: the absence IS
  // the news, and it is the news a person can act on. Dropping it here would
  // leave an unmonitored product looking exactly like a monitored healthy
  // one, which is the confusion the source rule exists to end.
  if (field.source && !fieldHasSource(row, field)) {
    return false;
  }
  return fieldAccessors(field).every(a => isEmptyValue(resolveField(row, a)));
}

/**
 * Whether a field has a source feeding it on this row. See
 * {@link FieldSchema}'s `source`. A field that never declared one is always
 * sourced: most values are simply recorded, and only a field that stands in
 * for a connection (health, a telemetry figure) can be unconnected.
 * @param row - The row.
 * @param field - The field declaration.
 */
export function fieldHasSource(row: PageRow, field: PageField): boolean {
  if (!field.source) {
    return true;
  }
  const from = field.source.from;
  const accessors = Array.isArray(from) ? from : [from];
  return accessors.some(a => !isEmptyValue(resolveField(row, a)));
}

/**
 * The fields no row can fill: the disappearing-field rule. A field opted in
 * (`hideWhenEmpty`, on by default) and not one row carries a value for it,
 * so the page is smaller by exactly the width the blank cells were using.
 *
 * Judged over the rows actually being drawn, so a page filtered to the work
 * that has shipped stops advertising the fields only unshipped work carries,
 * and a page with no rows at all hides nothing: an empty table is not
 * evidence about any field.
 * @param rows - The rows about to be drawn.
 * @param fields - The page's fields.
 * @param now - The instant `staleAfterHours` is measured against.
 */
export function emptyFields(rows: PageRow[], fields: PageField[], now?: number): PageField[] {
  if (rows.length === 0) {
    return [];
  }
  return fields.filter(f => f.hideWhenEmpty && rows.every(r => fieldIsEmptyOn(r, f, now)));
}

export type TableLayout = {
  /** The column that leads each row, or null on a page with no `primary`. */
  primary: PageField | null;
  /** The fields that read as the primary's muted second line, in order. */
  subtitle: PageField[];
  /** The picture that leads the block, when the page declared one. */
  thumb: PageField | null;
  /** Drawn where the thumb would be when the row has no picture. */
  thumbFallback: PageField | null;
  /** The remaining columns, in declaration order. */
  columns: PageField[];
  /** Columns collapsed into the line above the table. */
  constants: Array<{ field: PageField; value: unknown }>;
  /** Fields that read inside the row's disclosure rather than as a column. */
  details: PageField[];
  /** Fields dropped because no row could fill them. */
  dropped: PageField[];
};

/**
 * How one table's rows are laid out: which field leads, which read under it,
 * which stay columns, and which collapsed because they said one thing.
 * Computed per table, so a grouped page can collapse a column inside one
 * group and keep it in another.
 * @param rows - The rows under this table.
 * @param fields - The page's fields.
 * @param primary - The page's `primary` block, if it declared one.
 * @param now - The instant `staleAfterHours` is measured against.
 */
export function tableLayout(rows: PageRow[], fields: PageField[], primary?: PagePrimary, now?: number): TableLayout {
  const byKey = (k: string) => fields.find(f => f.key === k) ?? null;
  const lead = primary ? byKey(primary.field) : null;
  const sub = (primary?.subtitle ?? []).map(byKey).filter((f): f is PageField => f !== null && !f.detail);
  const thumb = primary?.thumb ? byKey(primary.thumb) : null;
  const thumbFallback = primary?.thumbFallback ? byKey(primary.thumbFallback) : null;
  const spoken = new Set([lead?.key, thumb?.key, thumbFallback?.key, ...sub.map(f => f.key)].filter(Boolean) as string[]);
  // A `detail` field is evidence the page deliberately kept out of the row,
  // so it never competes for width with the columns; it reads inside the
  // row's own disclosure instead.
  const details = fields.filter(f => f.detail && !spoken.has(f.key));
  const rest = fields.filter(f => !spoken.has(f.key) && !f.detail);
  // A field nothing can fill goes first: it is not a constant to hoist, it
  // is a fact the workspace does not have, and the page is smaller without
  // it. The headline is never dropped, because a row has to be called something.
  const dropped = emptyFields(rows, [...sub, ...rest], now);
  const droppedKeys = new Set(dropped.map(f => f.key));
  // A constant fact is hoisted wherever it was going to be repeated — out
  // of a column, and out of the subtitle, which would otherwise say
  // "squatch-core" once per row just as loudly.
  const constants = constantColumns(rows, [...sub, ...rest].filter(f => !droppedKeys.has(f.key)));
  const gone = new Set([...droppedKeys, ...constants.map(c => c.field.key)]);
  return {
    primary: lead,
    // The picture is NOT dropped when some rows lack it. A row with no
    // drawing yet leaves a gap the size of one, and a grid whose tiles start
    // at different left edges is harder to read than one with a hole in it —
    // the opposite of the usual rule, and only because this is a grid.
    thumb,
    thumbFallback,
    subtitle: sub.filter(f => !gone.has(f.key)),
    columns: rest.filter(f => !gone.has(f.key)),
    constants,
    details,
    dropped,
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
