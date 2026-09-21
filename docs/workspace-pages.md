# Workspace pages

Tenant-defined dashboard pages, declared entirely inside the workspace
directory — no fork of core, no new tables, no code in core per tenant.

```
workspace/<org>/pages/
├── command-center.yaml      # page manifest (required)
├── command-center.md        # optional prose (markdown body or list intro)
└── components/
    └── registry.tsx         # optional custom React widgets
```

Pages render at `/dashboard/p/<slug>` and appear in the sidebar grouped by
`nav.section`. They are **file-only**: `workspace:check|apply` doesn't know
about them, and deleting the YAML deletes the page. An invalid manifest is
skipped (and reported by `readWorkspacePages().issues`) — a broken page never
takes the dashboard down.

## Archetypes

Every page derives from a core page shape rather than inventing one:

| archetype | derived from | data |
|---|---|---|
| `list` | the objects/type list page | `objects` \| `skillRuns` \| `documents` |
| `queue` | the proposal list (read-only; decisions stay on Needs you, `/dashboard/inbox`) | `skillRuns` |
| `markdown` | the docs page | a sibling `.md` file |
| `report` | one record's whole story, at `/dashboard/p/<slug>/<id>` | the records that tell it |

A deployment can host several projects on one mounted `WORKSPACE_PATH`. That
folder's own `pages/` (and its plugins' pages) list only for the project the
folder belongs to — the one it was last applied to, or the one its
`workspace.yaml` `orgId` names. Every other project under the same mount sees
the pages of the plugins it has on (`project.enabled_plugins`) and nothing of
the folder's.

A `list`/`queue` page composes: a stats row (`stats:`), a series strip
(`series:`), grouping (`groupBy:`), filtering (`filters:`), sorting, per-field
formats (`text|badge|score|date|mono|image|money|link|relative|progress`,
with badge tone maps), column totals (`total: true`), a `rowLink`
click-through, and custom widgets.

Stats are `count`, `countWhere`, `sum`, `avg`, `min`, `max` or `pctGte` over
a field, optionally narrowed by a `where` filter, and render as a number or —
with `format: money` — as dollars read from cents. Filters compare with `eq`,
`neq`, `gte`, `lte`, `in`, `exists`, or `since`: `{field: meta.paidAt, op:
since, value: month}` keeps the rows whose date is in this calendar month
(`week`, `today` and `<n>d` are the other windows; UTC throughout).

A field with `total: true` is summed under the table — under each group's
table on a grouped page — as money for a `money` column and as a number
otherwise. `groupBy` over a field that holds a list (a record's tags) puts the
row in every group it names, so a page grouped by tag reads as "everything
under this tag" with the cumulative figure beneath it; a row with no value,
or an empty list, sits under "—".

`series:` draws figures over time under the stats: one strip per entry, one
column per bucket (`day`, `week` or `month`; `buckets` of them, oldest first,
ending now), one row per measure (`sum`, `count` or `avg` of a field), each
row bucketed by its `dateField`. A table rather than a chart — the figures
are the point.

```yaml
series:
  - label: Per week, last 8
    dateField: meta.costUpdatedAt
    bucket: week
    buckets: 8
    format: money
    measures:
      - {label: Estimated, field: meta.estimateCents}
      - {label: Actual, field: meta.actualCents}
```

`relative` renders a timestamp as its distance from now ("12s ago", "in 4m")
with the exact moment on hover; `progress` renders a worker's `{phase, note}`
heartbeat object as "phase · note". A badge over a boolean `false` with no
`'false'` tone renders as nothing, so an off flag is not a column of pills.

A `list`/`queue` page can also stay **live**: `live: {every: 15}` re-reads the
rows and stats every 15 seconds while the tab is visible (bounded 5–120) and
shows "live · 12s ago" in the title row. A hidden tab does not poll; coming
back re-reads at once. It is polling from a small client component, not a
socket — one request per interval per open tab is the whole cost — and it
reads whatever the source already records (a worker's heartbeat, a task's
status), so nothing new has to be emitted for a page to be live.

## Manifest example

```yaml
slug: command-center
title: Hiring Command Center
nav: {section: Hiring, order: 1}
archetype: list
source: {kind: objects, objectType: applicant}
sort: {field: meta.score, dir: desc}
stats:
  - {label: Applicants, kind: count}
  - {label: Qualified (70+), kind: pctGte, field: meta.score, threshold: 70, suffix: '%'}
widgets:
  - {component: ScoreDistribution, position: above, data: [rows]}
fields:
  - {key: name, label: Applicant, from: meta.name}
  - {key: score, from: meta.score, format: score}
  - key: band
    from: meta.band
    format: badge
    tones: {strong: ok, qualified: info, near-miss: warn, held: muted}
rowLink: /dashboard/objects/{id}
```

Field accessors: `title`, `status`, `createdAt`, `id`, or `meta.<dot.path>`
into the row's JSON (object `metadata`, parsed skill-run `output`, document
`metadata`).

`rowLink` and each entry in `rowActions` interpolate `{...}` tokens from the
row with the same accessors, so a row of one noun can reach a page about
another: the Backlog's rows are requests and link with `{id}`, the Factory
floor's rows are tasks and link with `{meta.requestId}`. A row that cannot
fill a token draws no link for it — a dead link is worse than no link. Values
are URL-escaped.

## The `report` archetype

A report is **one record's whole story on one page**, in order, and it takes
the record's id in the path: `/dashboard/p/<slug>/<id>`. The bare
`/dashboard/p/<slug>` says so and points at the list the report is reached
from.

```yaml
slug: feature
title: Feature report
nav: {section: Software factory, order: 2, hidden: true}
archetype: report
report:
  subject: request
```

`subject` is an enum of one (`request`) on purpose. A report is not a generic
record dump — it is an assembly that knows what a request's story IS and
which records tell each part, and that assembly is code
(`services/factory/featureReport.ts`). A second subject means a second
assembly; it gets declared here when it exists rather than pretended at now.

The request report renders nine sections in reading order — **the ask,
triage, the contract, approvals, the runs, the change, QA evidence, the
release, estimate against actual** — over a summary strip (asked, shipped,
elapsed, total cost, human decisions, attempts) and a vertical timeline,
oldest first so the newest entry is last, every entry stamped with its time
and, where money was spent, its cost.

Three rules the assembly holds to, and they are the point of the archetype:

1. **A stage that did not happen says so.** Every section renders; one with
   nothing in it carries a sentence naming what is absent — "No release
   carries this task", "No QA evidence was captured for this task", "No
   person approved this; it ran under earned autonomy". The absence is the
   finding, and hiding the section would hide it.
2. **No stage is inferred from another.** A merged pull request does not make
   a run successful. A shipped release does not make a task accepted. A
   passing check is not QA evidence.
3. **A contradiction is shown, not resolved.** A run recorded `failed` whose
   pull request merged shows both facts and is flagged, because that is a
   real defect — a worker's completion call can time out after its pull
   request is already open — and picking a winner would hide it.

### QA evidence, and the shape a worker must post

Evidence is an ordinary **artifact** (principle 7 — map onto the nouns we
have), attached to the `engineering_task` it proves:

```
recordType: 'object'                  # business objects are `object` records
recordId:   '<engineering_task id>'
recordRole: 'qa-screenshot' | 'qa-video' | 'qa-report'
kind:       'file' | 'link' | 'markdown'
title:      'Checkout, empty cart'    # the caption heading in the gallery
spec:       { url, filename, contentType, bytes }   # kind: file
            { href, title, description }            # kind: link
            { md }                                  # kind: markdown
```

`recordRole` carries the marker rather than `kind` because `artifact.kind` is
a closed core enum (`libs/cards/specs.ts`) and a worker cannot add
`qa-screenshot` to it. A worker that writes the marker into `spec.kind`
instead is still read, so the convention can tighten later without dropping
evidence already posted. A screenshot with a `url` draws itself; a video or a
report is a link that says what it is; `spec.caption` (or `description`, or
`summary`) is the line under it.

Nothing posts this yet. That is why the empty state names the gap instead of
collapsing.

## Custom widgets

`pages/components/registry.tsx` exports `components: Record<string,
ComponentType>`. Widgets must be server-component-safe (pure render, no
hooks). A widget referenced but not exported renders an inline notice, never
a crash.

Because Turbopack only compiles files under the project root — and refuses
both absolute alias paths and symlinks that escape the root — the registry is
**snapshotted** into the gitignored `src/wsx-ext/` when the dev server (or
build) starts, and `@wsx/registry` aliases to the snapshot, falling back to
the empty stub at `src/libs/workspace/ext-stub/registry.tsx`. Restart dev
after editing a workspace registry.

## Reference implementation

The hiring-screen demo — a retail chain screening seasonal applicants — is the
worked example, and it lives in the demos repo under
`demos/<demo>/workspace/…/pages/`. It ships one page per archetype, which is
the fastest way to see how far a workspace can go without touching core:

| page | archetype | what it shows |
|---|---|---|
| Command center | `list` | a stats row over `objects`, plus a **custom widget** from `components/registry.tsx` that draws the applicant score distribution — the one thing the core list page cannot express |
| Store-manager inbox | `list` | the same objects **grouped** by store, so a regional manager sees their own queue without a per-tenant route |
| Screening activity | `queue` | `skillRuns` read-only; decisions still happen on Needs you (`/dashboard/inbox`), so the page never grows a second decision surface |
| Agent registry | `markdown` | a sibling `.md` file, versioned with the workspace |

Read them in that order. The first two prove the data path, the third proves
the read-only rule, the fourth proves a page can be nothing but prose.
