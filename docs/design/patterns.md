# Dashboard patterns — List, Detail, Ledger

`packages/core/src/components/patterns/` is the UI pattern library every
dashboard page composes from. Three archetypes cover every page the dashboard
has or is likely to get; a change to a pattern changes every page that uses
it, which is the point. **New dashboard pages use `components/patterns`;
nobody hand-rolls a list, a detail or a ledger layout.**

The bar these patterns are held to is `docs/MANIFESTO.md`:

- **#4 Simple beats flexible** — one obvious action over five; a useful default
  over a setting. Each pattern has one primary verb and few props.
- **#11 Make the important things obvious** — what needs me, what changed, what
  happens next. The decision never scrolls away; the state chip is always
  visible; numbers line up.
- **#12 Hide complexity, never hide truth** — the simplest reading first
  (a title, a verdict, a score) with the evidence underneath (the rationale in a
  tooltip, the provenance in a mono footer, the transcript hash in a title).
- **#16 Beautiful is functional** — hairlines, not boxes. Space, not chrome.
  A powerful platform should feel calm.

Storybook: `Patterns/List`, `Patterns/Detail`, `Patterns/Ledger`, and the
three reference pages `Personalization/Queue`, `Personalization/LeadPage`,
`Discovery/Ledger`.

## Which archetype

| You are showing… | Use | Reference page |
|---|---|---|
| Many records of one kind, each a door to its own page, filtered by lane or category | **List** | `/gtm/personalization` |
| One record — its facts, its evidence, and (often) a decision to take on it | **Detail** | `/gtm/lead/[hubspotId]` |
| What the system did over time: every assessment with its scores, verdict, provenance and the human follow-up — read, rarely acted on | **Ledger** | `/gtm/discovery` |

A Ledger is a List whose rows are richer and read-mostly. If a row has a
score, a verdict and a provenance footer, it is a Ledger. If a row is a door
to a Detail page, it is a List.

## Tokens

Patterns use the airy-shell tokens from `styles/global.css` only: `--rule`
(hairlines), `--surface-hover` (the hover fill), `--surface-soft` (fields,
soft chips), `--action` / `--action-foreground` (the one ink primary),
`--ink-muted`; and the brand semantic set `--brand-pass` (green),
`--brand-borderline` (amber), `--brand-fail` (red) for pass/amber/fail
meanings. No hard-coded Tailwind colours.

## List

```
ListPage ───────────────────────────────────────────────────────────────
  Title                                                        [actions]
  One-line description.

  ListToolbar ─────────────────────────────────────────────────────────
  Review 12   Hand off 3   Held 1   Sent 40   All 56   [🔍 Find…] Sort ▾ ↓
  ───────────────────────────────────────────────────────────────────── (hairline)
  [All · n] [chip · n] [chip · n] [+3 more ▾]  (chips: ONE line, always)

  ListRows (divide-y hairlines)
  ┌ ListRow (44px) ────────────────────────────────────────────────────┐
  │ Title                                   col   col   ● Chip  [acts] │
  │ segment · segment · segment                                        │
  └────────────────────────────────────────────────────────────────────┘
  │ …                                                                  │

  ListEmpty (inline): "Nothing in this lane."
```

- `ListPage` — `TitleBar` + children. `actions` is for the one or two things
  the page is reached to do, right-aligned on the title row.
- `ListToolbar` — tabs (lanes, mutually exclusive, with counts), search,
  sort select, direction toggle, chips (categories, multi-select). All
  controlled; pair with `useListUrlState` so lane / search / sort / chips
  live in the URL (`?tab=…&q=…&sort=…&dir=…&f=a,b`). Defaults are never
  written, so a clean URL is the clean state.
- `ListRow` — title, `Subline` (segments joined by `›` for a hierarchy or
  `·` for facts), `columns` (right-aligned `Column`s), `chip`, `actions`
  (hover/focus-revealed; always visible on touch). A `href` makes it a link
  with a chevron; `onClick` makes it a button.
- `Column` + `COLUMN` — the width convention. `score` (w-32, "speculative
  0.42"), `number` (w-16), `amount` (w-20), `date` (w-24), `status` (w-28),
  `chip` (w-24). Pick by meaning so a score here sits where a score there
  does; numbers are `tabular-nums` and right-aligned.
- `ChipRow` — the category chips, on ONE line. It measures the real widths
  and folds the overflow into a "+N more" menu; pinned ("All") and active
  chips are laid out first, so a chip you turned on never hides. `fitChips`
  is the pure rule and is unit-tested. `ListToolbar.chips` renders through
  it; nothing hand-rolls a chip.
- `ListEmpty` — `page` (icon, title, one action) when the list is empty;
  `inline` (one muted line) when the filter is.

## One list

> Chris, 2026-09-15: "it feels like we're getting a lot of different
> row/table/record treatments. One of the underlying principles of our
> manifesto is unified UI/UX and simplicity through shared components. THIS
> SHOULD FEEL LIKE ONE APPLICATION NOT FIVE."

**Every list in the dashboard renders its records through one `ListRow`.**
There is no second row component: `components/ui/list-row` is gone, and its
consumers (Artifacts, Learnings) render through `patterns/ListRow` like
everything else. Two lists should read as the same component with different
data, not as two treatments.

This is Manifesto **§4 (simple beats flexible)** — one row with a few props
beats five bespoke row layouts — and **§19 (extend the core; keep specifics
at the edge)**: a page that needs something the row does not do *extends the
row*, in `components/patterns`, where every other page gets it too. It does
not fork one locally.

### Row anatomy

```
┌ ListRow — at least 44px, hairline above and below, no border of its own ─┐
│ [icon] Title                    [risk]     col    col    col   ● Chip  ⟨acts⟩ │
│        segment · segment · segment                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **icon** — optional, 32px soft tile. The kind of thing, not decoration.
- **title** — one line, truncated, `text-sm font-medium`.
- **subline** — a `<Subline>`: segments joined by `›` (a hierarchy) or `·`
  (a list of facts). Empty segments are dropped, so a missing fact leaves no
  dangling separator. One line, truncated.
- **columns** — right-aligned `<Column>`s at the `COLUMN` widths, in a fixed
  order per page, `tabular-nums`, hidden below `sm` unless `always`.
- **chip** — the row's state, always visible.
- **actions** — hover- and focus-revealed verbs. Always visible on touch.
  When a row both navigates and has actions, the link covers the record and
  the verbs sit beside it — never a button inside an anchor.

### Header and filter anatomy

Every list page is a `ListPage` + a `ListToolbar`:

```
Title                                                          [actions]
One context line — what this list is and where it comes from.
─────────────────────────────────────────────────────────────────────────
Lane 12   Lane 3   Lane 40      [🔍 Find…]  Sort ▾  ↓      trailing
[All · 56] [chip · 12] [chip · 9] [+4 more ▾]
```

- ONE title line and ONE context line. No second description paragraph.
- ONE row of chips, never two. The overflow is a measured "+N more" menu
  (`ChipRow`), not a wrap.
- Search is the toolbar's search box. Client-filtered lists pair it with
  `useListUrlState`; a server-filtered list (Search) makes the same box
  navigate instead — same control, same place.

### The rule

**A new page renders its rows through `ListRow`, or its PR says why not.**
"Why not" is a real answer for a matrix of numbers a person scans across
(the adoption and autonomy tables), or for a canvas. It is not an answer for
"this list needed one more column".

## Detail

```
DetailPage ─────────────────────────────────────────────────────────────
  Workspace › Personalization › Pete Laverick                 [actions]
  Pete Laverick                                    (H1, 22px)
  CEO · Incline Gaming Marketing Inc
  PERSONALIZATION · ● Ready for review · proposed by revenue-lead ·
  ▮▮▮▯▯ uncertain 0.60 · Paid social · MQL Sep 1 · Open in HubSpot ↗   (DetailMeta)
  ───────────────────────────────────────────────────────────────────── (hairline)

  DetailColumns ──────────────────────────────┬─ RightColumn ──────────
  RECOMMENDED ACTION            [View research]│ CONFIDENCE
  Enroll in: Ebook Inbound Sequence · 2 sends  │ 0.60 · uncertain
  One paragraph of why.                        │
  ───────────────────────────────────────────  │ TIMELINE
  PROSPECT FACTS                               │ Arrived      Aug 29
  Role         CEO                             │ Became MQL   Sep 1
  Company      Incline Gaming Marketing        │
  ───────────────────────────────────────────  │ CRM CONTEXT
  RESEARCH THAT MATTERS                        │ …
  Claim.                                       │
  [FACT] incline.bet/about · 2026-08-30        │
  ───────────────────────────────────────────  │
  OUTREACH · 2 SENDS                 [Edit all]│
  › Day 0 · The ebook you pulled               │
  › Day 4 · One level deeper                   │
  ─────────────────────────────────────────────┴────────────────────────
  StickyActionBar (sticky bottom)
  [⌃ Add feedback]                    Decline   Snooze   ▐ Enroll ▌
```

- `DetailPage` — crumbs, H1, `subtitle`, `meta`, `actions`, `aside`,
  children, `bar`. Sets `document.title` to "Record · Section". The columns
  collapse to one below `@3xl` (the right column drops under the content);
  the bar spans the page and sticks to the bottom of the content column, so
  a conversation rail beside the page is never covered.
- `DetailMeta` — one row of facts separated by middots. Parts: `MetaChip`
  (the system eyebrow, or a link out), `StatusDot` (dot + word),
  `ConfidenceMeter` (48px meter + reading; `rationale` opens in a tooltip;
  `alignment` adds a second reading), plain strings, a queue position.
- `Section` — eyebrow label, optional right-aligned ghost `action`, content;
  sections are hairline-divided and have no border of their own. `tone="quiet"`
  for the right column.
- `FactList` — label/value pairs as hairline `rows` (content column) or a
  stacked `column` (right column).
- `EvidenceList` — one claim per row with a `SourceChip` (`Fact` green,
  `Inference` amber, anything else as written) and the citation shortened to
  host/path (`evidence.ts`).
- `Accordion` — rows for sub-items (sends): `Day 0 · Subject`, opening to
  the body. Controlled `open` so "Edit all" opens every row.
- `StickyActionBar` — one ink primary, ghost secondaries (`tone: 'danger'`
  reddens on hover), a collapsed `field` (the ONE feedback note; its
  `action` is Regenerate), an `aside` slot for a snooze picker. Imported from
  PR #337.

The decision logic for a review run lives in
`features/review/useReviewDecision` — the card's wiring as a hook — so a
Detail page decides the same run through the same calls the review queue
does.

## Ledger

```
LedgerGroup ────────────────────────────────────────────────────────────
  MON, SEP 14  3
  ───────────────────────────────────────────────────────────────────── (hairline)
  LedgerEntry
  Acme <> Metacto intro  Sep 14, 10:00 AM               routed  [generate]
  Matched hubspot-deal · deals:1201
  discovery 0.95 ▮▮▮▮▯   proposal-ready 0.88 ▮▮▮▮▯   thresholds 0.8 / 0.75
  Two lines of the model's reasoning, clamped, with a "more" toggle…
  claude-haiku-4-5#discovery-v1 · revops-lead · run #4412 · transcript 9f3c… · ws a81f…
                                                            review: pending →
  ─────────────────────────────────────────────────────────────────────
  …
```

- `LedgerGroup` — a day header with a count.
- `LedgerEntry` — `title` · `when`, `detail` (the match reason), `state`
  (routing state) + `verdict` at the right, `scores`, `summary` (clamped to
  two lines; "more" past ~180 chars), `provenance` footer, `human` slot
  (what a person did — linked to where they did it).
- `ScoreChip` — `label 0.95` with a 32px meter; with a `threshold` it colours
  pass (green) / fail (red) and draws a tick at the threshold. Logic in
  `scoreChip.ts` (`scoreVerdict` uses `>=`, the router's inequality).
- `VerdictBadge` — `drop` ink, `generate` green, `confirm` / `hold` amber,
  `skipped` / `pending` ink; unknown verdicts render neutral, as written.
- `ProvenanceLine` — mono, muted: model#prompt · agent · run · transcript ·
  workspace, each titled.

The Ledger reuses `ListToolbar` (chips for verdicts with counts, search, sort)
and `useListUrlState`.

## Do / don't

- **Do** draw hairlines (`border-rule`, `divide-rule`) between things. **Don't**
  put a box in a box: no bordered card inside a page, no rounded panel
  holding a list.
- **Do** give a page one primary action, in ink, in the sticky bar. **Don't**
  put a primary in the header and another in the body.
- **Do** right-align numbers in a fixed `Column`, `tabular-nums`. **Don't**
  let a score float after variable-width text.
- **Do** state the recommendation once, in its section. **Don't** repeat the
  card's title in the header and again above the sends.
- **Do** keep the truth in reach: the rationale in the meter's tooltip, the
  hash in the provenance, the error where the brief would be. **Don't** hide
  a failure behind a neutral state.
- **Do** let a phone see the title and the chip. **Don't** ship a column that
  only fits a desktop without `hidden sm:inline-block`.

## Migrating a page — checklist

1. Name the archetype from the table above. If a page seems to need two, it is
   two pages (or a Detail with a List section).
2. Move the read into the server component; hand a client component
   serialisable rows (ISO dates) — see `gtm/discovery/page.tsx`.
3. Replace the frame: `TitleBar` + custom → `ListPage`; back-link + `h1` →
   `DetailPage` with `crumbs`.
4. Replace the toolbar with `ListToolbar` + `useListUrlState`; keep the
   existing lane keys and sort keys so old links still resolve.
5. Replace each row with `ListRow` / `LedgerEntry`; put numbers in `Column`s
   by kind; the state in `chip` / `verdict`.
6. Replace each panel with `Section`; each label/value block with `FactList`;
   claims with `EvidenceList`; sub-items with `Accordion`.
7. Move the verbs into `StickyActionBar`. One primary. The feedback field
   collapsed.
8. Delete every `rounded-* border border-border bg-card` wrapper that is left.
   Count the boxes before and after; the after count is the number of
   pages, not panels.
9. Add a story under the page's feature folder; keep the existing tests
   passing (they assert text, not chrome).

### Where every list stands

Audited 2026-09-16. "On `ListRow`" means the page renders its records through
`patterns/ListRow`; anything else is a treatment we still owe the rule above.

| Surface | Renders today | Status |
|---|---|---|
| Search (`/dashboard/search`) | `ListPage` + `ListToolbar` + `ListRow` | **On `ListRow`** |
| Search document (`/dashboard/search/[documentId]`) | `DetailPage` | **On Detail** |
| Needs you (`/dashboard/inbox`) | `ListRows` + `ListRow` | **On `ListRow`** |
| Artifacts (`/dashboard/artifacts`) | `ListRows` + `ListRow` | **On `ListRow`** |
| Learnings (`/dashboard/learnings`) | `ListRows` + `ListRow` | **On `ListRow`** (the "Recent decisions" block below it is still cards) |
| Personalization (`/gtm/personalization`) | `ListPage` + `ListToolbar` + `ListRow` | **On `ListRow`** |
| Discovery (`/gtm/discovery`) | Ledger (`LedgerEntry`) | **On Ledger** — a richer read-mostly row by design |
| Conversations | day-bucketed hairline rows inside a bordered card | Owed — List; day buckets stay, the card goes |
| Activity | hairline rows inside one bordered box, three chip rows | Owed — Ledger; the chip rows become one `ChipRow` |
| Briefings | bordered cards for previous briefs | Owed — List for the archive; the brief itself is prose |
| Skills / Tools / Models | hairline rows in a bordered box (Skills); card grids (Tools); raw tables (Models) | Owed — List |
| Teams / Agents / Missions / Workflows / Objects / Evals / Automation | card grids | Owed — List; a card grid hides the columns that let you compare |
| Connectors | 2-col card grid (`SourcesPanel`) | Owed — List; the largest single migration (one 2,800-line component) |
| Members | shadcn `Table` | Owed — List; the only shadcn `Table` left |
| Team report roster (`MemberTable`) | raw `<table>`, 8 columns | **Left as a table.** A per-member cost/usage matrix is scanned across columns, not down rows; §4 says one obvious reading, and for this the reading is the grid |
| Adoption, Autonomy, Automation runs | raw `<table>`s | **Left as tables**, same reason: they are matrices with sortable columns, not queues of records |

The owed migrations are one follow-up PR each, in that order; nothing in the
list needs a pattern the library does not already have.
