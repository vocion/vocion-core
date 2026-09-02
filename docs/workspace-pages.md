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
| `queue` | the review page (read-only; decisions stay in `/dashboard/review`) | `skillRuns` |
| `markdown` | the docs page | a sibling `.md` file |

A `list`/`queue` page composes: a stats row (`stats:`), grouping
(`groupBy:`), filtering (`filters:`), sorting, per-field formats
(`text|badge|score|date|mono`, with badge tone maps), a `rowLink`
click-through, and custom widgets.

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

The Down to Earth demo (`vocion-demos/demos/down-to-earth/workspace/…/pages/`)
ships four pages: a stat-tiled command center with a custom score-distribution
widget, a grouped store-manager inbox, a read-only screening-activity queue,
and a markdown agent registry.
