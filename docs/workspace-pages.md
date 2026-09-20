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

A `list`/`queue` page composes: a stats row (`stats:`), grouping
(`groupBy:`), filtering (`filters:`), sorting, per-field formats
(`text|badge|score|date|mono|image|money|link|relative|progress`, with badge
tone maps), a `rowLink` click-through, and custom widgets.

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
