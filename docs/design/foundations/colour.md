# Colour

Tokens live in `packages/core/src/styles/global.css` (`:root` for light,
`.dark` for dark) and are exposed to Tailwind in its `@theme` block. Pages use
tokens only: never a raw palette hue (`emerald-700`, `red-500/30`), never a hex.

## The canvas

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#FEFCF9` warm paper | `#121015` | The page and, in light, the sidebar |
| `--sidebar` | = `--background` | `#0D0B10`, a step darker | One surface in light; a step down in dark |
| `--ink` / `--foreground` | `#15131A` (17.7:1) | `#F4F1EC` (17:1) | Text |
| `--ink-secondary` / `--muted-foreground` | `#625D66` (6.2:1) | `#A8A2AB` (7.8:1) | Secondary text |
| `--rule` / `border-border` | warm 9% | white 10% | Hairlines; never a box inside a box |
| `--surface-hover` | warm 4% | white 4% | Every hover and menu highlight |
| `--surface-soft` | `#F3EFE8` | `#1C1A20` | Fields, soft chips, skeletons |
| `--sidebar-accent` | warm 7% | white 10% | Selection on the rail and in the nav |
| `--action` | ink | ink | The one primary button per screen |

**One surface.** The page and the sidebar are the same warm paper, split by
`--sidebar-border`. Menus and popovers are one surface: `rounded-xl`, one
hairline, `--shadow-pop`, rows highlighted with `--surface-hover`.

## Status, by meaning

| Meaning | Text | Soft fill | Notes |
|---|---|---|---|
| pass | `text-pass` | `bg-pass-soft` | Done, verified, approved |
| warn | `text-warn` | `bg-warn-soft` | A risk, a limit, needs attention |
| fail | `text-fail` | `bg-fail-soft` | Broke, rejected; `--destructive` for destructive buttons |
| waiting | `text-waiting` | `bg-waiting-soft` | Something waits on a person |
| info / running | `text-muted-foreground` | `bg-surface-soft` | Neutral; never blue |

Every one has a dark value. `StatusPill` and `StatusBadge` draw them as
borderless soft fills; `Notice` and `CountBadge` use the same names.

## Amber's four meanings

The Metacto amber (`--brand-amber`, the default `--org-accent`) means exactly:
the **Org's brand** (logo, the sign-in button), **links** (`text-primary`),
the **focus ring** (`ring-ring/50`), and **something waits on a person**
(`waiting`). Never "AI", never decoration, never a selected row or a card hover.

## The spark

Vocion's one AI colour. See [spark.md](./spark.md).

## Agent accents

An agent's authored `accent:` (`libs/agentAccents.ts`) is drawn only by
`AgentDot`, as a lit orb. Three accents moved a step off the spark's exact
hues (2026-10-23) so a resting agent never reads as one at work.

## Tints

Front doors only (`--tint-violet|sky|mint|peach|butter|rose`, `bg-tint-*`, names
in `libs/tints.ts`), with dark variants; secondary ink on every tint is
≥ 5.3:1. Never on a row, a section or a record.

## Charts

`--chart-1..5` today; the first-party chart card's `--viz-*` palette (with dark
pairs) is the one to keep, and moves into `global.css` when charts are next
touched.
