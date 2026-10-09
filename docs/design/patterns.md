# Dashboard patterns — the archetypes, and the rules that hold across them

Two things live here, and they are the same thing seen from two sides.

**The archetypes** — `packages/core/src/components/patterns/` is the UI
pattern library every dashboard page composes from. Three archetypes cover
every page where work happens — List, Detail, Ledger — and a fourth, **Front
doors**, covers the few places a person chooses or starts something instead
of working on it. A change to a pattern
changes every page that uses it, which is the point. **New dashboard pages use
`components/patterns`; nobody hand-rolls a list, a detail or a ledger layout.**

**The rules** — a handful of things that are true on every surface, whichever
archetype it is: what may never be drawn ([Never](#never)), and how a person
gets what they need without leaving the page they are on
([Do not make me leave](#do-not-make-me-leave)). Each is enforced by a
component, not restated per screen — a rule a reviewer has to remember is a
rule the next page breaks.

A rule arrives here the second time the same note comes back on a different
page. A note that comes back twice is not feedback about a page; it is a
missing rule.

The bar these patterns are held to is `docs/DESIGN-PRINCIPLES.md`:

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

Storybook: `Patterns/List`, `Patterns/Detail`, `Patterns/Ledger`,
`Patterns/Front doors`, `UI/Front-door primitives`, and the three reference
pages `Personalization/Queue`, `Personalization/LeadPage`,
`Discovery/Ledger`.

## Which archetype

| You are showing… | Use | Reference page |
|---|---|---|
| Many records of one kind, each a door to its own page, filtered by lane or category | **List** | `/gtm/personalization` |
| One record — its facts, its evidence, and (often) a decision to take on it | **Detail** | `/gtm/lead/[hubspotId]` |
| What the system did over time: every assessment with its scores, verdict, provenance and the human follow-up — read, rarely acted on | **Ledger** | `/gtm/discovery` |
| A handful of things to choose from or start — apps, agents to hire, connectors to add, the first step on an empty page | **Front doors** | `/dashboard/apps` |

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

The neutrals are warm (from the marketing site, 2026-10): ink `#15131A`,
secondary `#625D66` on a `#FCFAF6` background — 17.7:1 and 6.2:1 — with warm
dark equivalents (`#F4F1EC` / `#A8A2AB` on `#141217`, 16.5:1 and 7.5:1).
Front doors add six tints, `--tint-violet|sky|mint|peach|butter|rose`
(`bg-tint-*`, names in `libs/tints.ts`), with dark variants; secondary ink on
every tint is ≥ 5.3:1 in light and ≥ 5.4:1 in dark. Tints belong to front
doors only — never to a row, a section or a record.

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
- `Column` + `COLUMN` — the width convention. `score` (w-32, a
  `<ConfidenceBars>`), `number` (w-16), `amount` (w-20), `date` (w-24),
  `status` (w-28), `chip` (w-24). Pick by meaning so a score here sits where a
  score there does; numbers are `tabular-nums` and right-aligned.
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
  order per page, `tabular-nums`, hidden below `sm` unless `always`. Facts:
  they sit inside the row link, so the whole row is one click target.
- **one quiet primary + `RowMenu`** — a row offers the ONE action it needs
  next (Sync now, Connect, Reconnect), as a hairline pill. Everything else —
  Edit, Delete — sits in the row's `RowMenu` (`components/patterns/RowMenu`).
  No red on a row: Delete opens its confirm dialog, and the dialog's button
  is the only red.
- **labelled counts** — several counts on one row are one `contents` column,
  labelled and joined ("2 agents · 3 skills · 1 page"), never bare numbers
  side by side.
- **columnsAside** — the same columns, for a row where one of them clicks
  through to somewhere of its own (a chip that opens the document). They
  render beside the link instead of inside it. Pass a row's WHOLE set here
  when any one column is interactive, so the order down the list never
  changes; the chip follows them out, so it is always columns-then-chip.
- **chip** — the row's state, always visible.
- **actions** — hover- and focus-revealed verbs. Always visible on touch.
  When a row both navigates and has actions, the link covers the record and
  the verbs sit beside it — never a button inside an anchor.
  `actionsAlways` pins them visible for a row whose verb IS the point of the
  row — a Proposals row with nothing drafted, where Draft is the only thing to
  do. A list decides that by state, never per row, and the state is visible
  beside it.

The rule behind the last two: **the link covers the record; anything that
clicks through to somewhere else sits beside it.** An anchor or a button
inside an anchor is invalid HTML — the browser closes the outer link at that
point and React's hydration fails on the mismatch.

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

### The header and the row on a phone

> Chris, 2026-10-09, on the Review queue at 390px: "Header too tall. I can't
> read enough text on these rows to understand what they are. Global fix."

The header had taken 60% of the screen (title, summary, a scope toggle, a lane
toggle, sort, search, "All filters") and each title was cut to ten characters
by the ✓, ✗ and › beside it. Below `sm` the same components now draw:

```
Review queue                                   ← TitleBar: 18px, line under it in 12px
5 decisions, oldest waiting 9d.
[This workspace ▾] [Open 5 ▾] [⚙ 1] [Agent: deal-desk ×]   ← CompactFilters, ONE row
─────────────────────────────────────────────────
[▤] Create the tracking sheet for the         9d  ⋯
    Northwind renewal                              ← title: two lines, never cut at 10
    Input › asked by pipeline-analyst              ← subline: two lines
```

- **`TitleBar`** is compact on a phone (18px title, its one line clamped to two
  in 12px, half the air beneath); desktop keeps the roomier block.
- **`CompactFilters`** is the header's controls as ONE row of chips: a menu
  chip per single-value choice (scope, lane), a button that opens a bottom
  sheet with search, every filter and sort, and each filter that is on as a
  removable chip. The row scrolls sideways; it never wraps. `ListToolbar`
  renders it below `sm` from its own props, so every list on `ListToolbar`
  gets it free; a page with its own controls (the Review queue, the run log,
  Briefings' team picker) renders it directly and hides its desktop row
  below `sm`.
- **`ListRow`** wraps its title and its subline to two lines each on a phone
  (one from `sm` up). A column kept on a phone (`always`) is a small trailing
  label as wide as its text; a `grow` column stops growing there.
- **`ListRow.swipe`** takes a row's yes and no off its width on a phone: swipe
  right for `right`, left for `left`, each behind a five-second Undo (the verb
  waits, so nothing has happened when Undo is tapped), and both in a ⋯ menu
  for anyone who does not swipe. The inline buttons stay from `sm` up. The
  whole row stays the tap target for the record.

The rule is a test: `e2e/mobile-lists` opens every seeded list at 390×844 and
fails when the first row starts below 35% of the screen, when a title is held
to one line or has under ~150px a line (about 40 characters over two), or
when a short title is clipped.

### The rule

**A new page renders its rows through `ListRow`, or its PR says why not.**
"Why not" is a real answer for a matrix of numbers a person scans across
(the adoption and autonomy tables), or for a canvas. It is not an answer for
"this list needed one more column".

## Detail

```
DetailPage ─────────────────────────────────────────────────────────────
  Workspace › Personalization › Rowan Pike                    [actions]
  Rowan Pike                                       (H1, 22px)
  CEO · Tideline Gaming Marketing Inc
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
  Company      Tideline Gaming Marketing       │
  ───────────────────────────────────────────  │ CRM CONTEXT
  RESEARCH THAT MATTERS                        │ …
  Claim.                                       │
  [FACT] tideline.example/about · 2026-08-30   │
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
  for the right column. **A section is also a commentable region**: it carries
  `data-comment-field`, named by its eyebrow, which is the entire opt-in for
  [Select → talk](#select--talk). `commentField` renames it (a composed
  eyebrow, or two sections that would collide); `commentField={null}` opts
  out.
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

### A Detail page with more than one document is a Detail page with tabs

A record whose content is genuinely several documents — a research brief, an
outreach recommendation, a draft sequence, the evidence under all three — does
not get a column each. It gets ONE recommendation block and a `Tabs` row, and
the archetype is otherwise unchanged: same crumbs, same H1, same one meta line,
same sticky bar.

```
DetailPage ─────────────────────────────────────────────────────────────
  Workspace › Personalization › Rowan Pike
  Rowan Pike                                       (H1, 22px)
  CEO · Tideline Gaming Marketing Inc
  ● Ready for review · Paid social · MQL Sep 1 · ▮▮▮▯▯ Research 60% ·
    Open in HubSpot ↗                                        (DetailMeta)
  ───────────────────────────────────────────────────────────────────── (hairline)
  RECOMMENDATION                           [Discuss recommendation]
  Enroll in Ebook Inbound Sequence · 2 sends
  One sentence of why.
  CURRENT STATE      MQL Auto-Nurture · active · step 1 of 3
  VOCION RECOMMENDS  Ebook Inbound Sequence · 2 sends
  APPROVING WILL     Unenroll from MQL Auto-Nurture and enroll in …
  ↻ Regenerate
  ─────────────────────────────────────────────────────────────────────
  Brief   Sequence · 2   Evidence                                (Tabs)
  ─────────────────────────────────────────────────────────────────────
  … the tab's `Section`s …

  StickyActionBar (sticky bottom)
  [⌃ Add feedback]                    Snooze   Decline   ▐ Enroll ▌
```

- **No right column.** What used to live there — confidence, timeline, CRM
  context — belongs to one of the documents, and putting it in a column beside
  all of them made it belong to none. Confidence is in the brief; the timeline
  and the CRM record are under Evidence.
- **The last tab is always Evidence**, and it is where everything the reduction
  pass took off the first screen went. Nothing is deleted; it is one click
  away (§12).
- **One primary, and it can be HELD.** Where the page cannot say what the
  primary would actually do — here, whether approving adds a sequence or
  replaces one — the bar states the reason and disables it rather than offering
  a verb with two meanings.
- **Each document carries its own Regenerate**, beside the document. One
  Regenerate in a shared column silently means whichever document its author
  had in mind, which is how the lead page's regenerate went unfound: it had
  both forms and good copy and sat below confidence, timeline and CRM context
  in the column this rule deletes.

**Where it came from.** `docs/specs/personalization-v2.md`: *"Cap it at
navigation | primary workspace | optional copilot drawer. The metadata column
goes away."*

## Ledger

```
LedgerGroup ────────────────────────────────────────────────────────────
  MON, SEP 14  3
  ───────────────────────────────────────────────────────────────────── (hairline)
  LedgerEntry
  Project Ranger – Follow Up  Sep 14, 11:30 AM   Existing opportunity  Not discovery
  Project Ranger / Northwind Health
  ▮▮▮▮▮ Not discovery 95%    ▮▮▮▮▯ Proposal-ready 82%
  Existing opportunity; diligence and bid preparation already underway.
  Agent action: No discovery workflow · Human review: Pending →
  › Evidence & decision details
  ─────────────────────────────────────────────────────────────────────
  …
```

- `LedgerGroup` — a day header with a count.
- `LedgerEntry` — `title` · `when`, `detail` (who the meeting was with),
  `verdict` + `state` at the right, `scores`, `summary` (one sentence; clamped
  to two lines with "more" past ~180 chars), `human` (what a person did, and
  what happened as a result), and `details` — the collapsed
  **Evidence & decision details** disclosure. `provenance` renders inside
  `details` when there is one, and on its own when there is not.
- `ConfidenceBars` (`components/ui/confidence-indicator`) — the reading. Five
  bars for magnitude, colour for level, the number AND the class it belongs to
  in the text, the tooltip and the accessible name.
- `VerdictBadge` — a routing outcome, where a page still shows one: `drop` ink,
  `generate` green, `confirm` / `hold` amber, `skipped` / `pending` ink.
- `ScoreChip` — `label 0.95` with a 32px meter and a threshold tick. Retained
  for a genuine threshold comparison (an eval, a calibration view). **A
  confidence is not one of those**: use `ConfidenceBars`.
- `ProvenanceLine` — mono, muted: model#prompt · agent · run · transcript ·
  workspace, each titled.

The Ledger reuses `ListToolbar` (facets, chips, search, sort) and
`useListUrlState`.

### The row answers four questions, in order

**What meeting was this? What did the system decide? Why? What did the human
do?** That ordering is the archetype, not a preference: the decision history is
the ledger and the model internals are supporting evidence (design principle 9).
Thresholds, prompt version, run id and transcript hash are product telemetry —
they go in `details`, collapsed. A number a person scans past on every row is
paying rent it does not earn.

### Three dimensions are three controls

A ledger row usually carries several independent dimensions — what the system
decided, what it recommended doing, what a person did about it. They are not
one status, and a filter that mixes them cannot be read: `routed confirm` next
to `review: declined` does not say what was declined.

`ListToolbar.facets` is the control for this — one labelled select per
dimension, one value each, each in the URL under its own name. Chips stay what
they were: several categories of ONE kind at a time. The quick chips beside
them are shortcuts across dimensions (`Needs review`, `Human disagreed`), not a
fourth dimension.

**Where it came from.** Chris, on the Discovery Ledger, 2026-09-16: *"Filters
are All · generate · confirm · drop, but those are not the same kind of
thing."* Full review: `docs/specs/discovery-ledger-v2.md`.

### Never a score without its class

`ConfidenceBars` takes a `subject` — the class, verdict or recommendation the
number is about — and puts it in the visible text, the tooltip and the
accessible name. With no subject the level word plays that part
(`speculative 42%`), which is still a class.

This is a rule because breaking it produced a real defect, not a cosmetic one:
the ledger drew `discovery 0.95` on a record whose reasoning said "Not a
discovery call", because the model had returned confidence in its own answer
and the label assumed a probability of the positive class. A reader cannot
recover the difference from the number.

It has a second half: **a score whose meaning was never defined is not
rendered as a percentage at all.** The row shows the verdict and says the
confidence is not comparable; the raw number goes behind Evidence, labelled.
An audit ledger that asserts a probability it cannot justify is worse than one
that admits it does not know.

## Front doors

```
CatalogCards (1 → 2 → 3 columns) ─────────────────────────────────────────
┌ CatalogCard ─────────────────────┐ ┌ CatalogCard (tint) ───────────────┐
│ [mark]  KICKER          [badge]  │ │ [mark]  APP                       │
│         Title                    │ │         Software Factory          │
│         One sentence: the job.   │ │         Requests become releases. │
│         Action →                 │ │         See its 2 plugins →       │
│ [small visual — optional]        │ │                                   │
└──────────────────────────────────┘ └───────────────────────────────────┘
```

A front door is where a person **chooses or starts** — an app, an agent to
hire, a connector to add, the first thing to do on an empty page. It is not
where they work. Everything a person works on is a record, and records are
rows.

- `CatalogCard` — `tint`, `kicker` (what kind of thing), `title`, `job` (ONE
  sentence), `action` (ONE arrow link, or a button for a door that opens a
  dialog; the whole card is its target), and optionally `lead` (a
  `LetterTile` or `AgentDot`), `badge` (a `StatusBadge`) and `visual` (a
  small picture under the text). It is a `Surface`, so a card inside a
  bordered surface warns in development.
- **Every card wears a tint, by its app or category** — an app its own tint,
  an agent for hire its team's (`defaultTint(team)`), a connector how it signs
  in (Sign in · API key · No sign-in). Rounded, no border on the tint, no
  hairline-box variant: a grid of front doors reads as one family.
- `CatalogCards` — the grid. One column on a phone, two, then three, every
  row the height of the tallest card, with each card's action on its bottom
  line.
- `LetterTile` — the one square mark for a thing with no logo: a monogram, or
  an app's icon on its tint; `muted` (dashed) for something not here yet.
- `AgentDot` / `AgentDots` — the one shape an agent takes anywhere it is
  named: a dot in the agent's authored `accent` with its initial, white on a
  fill chosen to clear AA (`libs/agentAccents.ts`, checked in its test).
  Nothing hand-rolls an agent avatar.
- `StatusBadge` — `available` / `beta` / `coming`: whether a catalog item can
  be had yet. Drawn in `StatusPill`'s token sets, so the two never drift.
- `EmptyState` — an empty page is a front door: a mark, a title, one
  sentence, one arrow. A quiet docs link may sit beside the action; a second
  button may not. The arrow is something a person can do **in the product**
  — create, connect, ask in chat, install, hire — never "author a file".
- `HowItsAuthored` — where developer detail goes: the folder a thing is
  authored in, the manifest key, the command that applies it. A closed
  "How it's authored" disclosure under the empty state (`authoring` on
  `EmptyState` / `ListEmpty`), never in the sentence or the page intro.
- **App tint.** `app.yaml` takes `tint:`; an app that names none gets a stable
  tint from its id (`resolveTint`). The rail, the app's nav header, its
  workspace picker and the marketplace all draw the app on it.

### CatalogCard or List

| | CatalogCard | ListRow |
|---|---|---|
| The person is… | choosing or starting | working, comparing, deciding |
| How many | a handful to a few dozen, searchable | any number |
| What a row carries | one sentence and one door | columns, a state chip, verbs |
| State that changes | none — it is a door | the point of the row |

If a thing has a state the person acts on (connected, syncing, failed, on,
off), it is a row: the connectors page lists **connected** connectors as rows
and offers the rest as cards; Apps offers every app as a card, and an app's
own page lists its features as rows with On/Off switches (the switch is work).
If a card needs columns, it was a row.

### One sentence

The `job` is ONE sentence, in the reader's terms: what this does for them —
"Drafts the Contoso proposal from every call, email and file on the deal." —
not what it is made of, not a feature list, not two sentences. The full
description lives where the door leads. Copy from data (a catalog entry, a
manifest, a connector) goes through `firstSentence`, so the card shows the
first sentence whole. **It is never clamped with an ellipsis**: a first
sentence too long for a card is rewritten at its source — a short sentence
first, the detail after it — so the card reads complete and the profile
still has everything.

The same goes for a page intro: one plain sentence under the title. "Authored
in workspace/evals" is developer detail; it belongs behind `HowItsAuthored`.

### Never on a front door

No display-size type (a card title is 15px), no glow, no gradient, no
shadow, no marquee, no motion beyond the arrow's nudge. And never on a work
surface: no `CatalogCard`, no tint, no panel on a List, Detail or Ledger page.

**Where it came from.** The marketing site's warm, card-per-app pages
(2026-10), approved by the founder for the places in the product that do the
same job: the app drawer, the connectors catalog, the plugin marketplace and
empty states.

## Do / don't

- **Do** draw hairlines (`border-rule`, `divide-rule`) between things. **Don't**
  put a box in a box: no bordered card inside a page, no rounded panel
  holding a list. This one is enforced in code — see
  [Never: a bordered surface never contains another bordered surface](#a-bordered-surface-never-contains-another-bordered-surface).
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
| Discovery (`/gtm/discovery`) | Ledger (`LedgerEntry`) + `ListToolbar` facets | **On Ledger** — a richer read-mostly row by design |
| Conversations | day-bucketed hairline rows inside a bordered card | Owed — List; day buckets stay, the card goes |
| Activity | hairline rows inside one bordered box, three chip rows | Owed — Ledger; the chip rows become one `ChipRow` |
| Briefings | bordered cards for previous briefs | Owed — List for the archive; the brief itself is prose |
| Skills / Tools / Models | hairline rows in a bordered box (Skills); card grids (Tools); raw tables (Models) | Owed — List |
| Teams / Agents / Missions / Workflows / Objects / Evals / Automation | card grids | Owed — List; a card grid hides the columns that let you compare |
| Connectors (`/dashboard/connectors`) | `ListRows` for connected connectors; `CatalogCard`s for the rest | **On `ListRow` + Front doors** — connected is work, the catalog is choosing |
| Apps (`/dashboard/apps`) and Hire an agent (`/dashboard/hire`) | `CatalogCard`s (apps, agents for hire); hairline rows with On/Off switches for an app's features | **On Front doors** |
| Members | shadcn `Table` | Owed — List; the only shadcn `Table` left |
| Team report roster (`MemberTable`) | raw `<table>`, 8 columns | **Left as a table.** A per-member cost/usage matrix is scanned across columns, not down rows; §4 says one obvious reading, and for this the reading is the grid |
| Adoption, Autonomy, Automation runs | raw `<table>`s | **Left as tables**, same reason: they are matrices with sortable columns, not queues of records |

The owed migrations are one follow-up PR each, in that order; nothing in the
list needs a pattern the library does not already have.

---

# Never

Two things that may not be drawn, whichever archetype the page is. Both are
enforced by a component, because a rule with no component behind it is a note
in a PR that the next PR does not read.

## A bordered surface never contains another bordered surface

Nest with **hairlines, spacing and eyebrow labels** instead.

A border says *this is a thing*. A border inside a border says it twice and
means it once, and the reader pays for the second frame in noise. Grouping
inside a surface is a job for the `--rule` hairline, a gap, and a small
uppercase label — all three of which carry the structure without adding a box.
This is the enforced form of the *Don't put a box in a box* bullet above, and
of step 8 of the migration checklist.

- **Design principle 4 — Simple beats flexible.** "Prefer one obvious action over
  five possible actions." A stack of cards inside a card offers five framings
  of one thing.
- **Design principle 8 — Beautiful is functional.** "Every screen should have
  hierarchy. Every object should have space." Hierarchy comes from *space*.
  Chrome that repeats at every level conveys no hierarchy at all — it is
  "complexity disguised as sophistication", named in that section as a thing
  to avoid.

**Where it came from.** Chris, on the Review detail: *"boxes in boxes"*. Then
again, on the personalization lead page, 2026-09-16: *"tell me about the cards
in chat on the right (why cards in cards, that should be a NEVER ALLOW)."* The
second time is what made it a rule instead of a fix.

**How it is enforced.** `components/ui/surface.tsx`:

```text
<Surface name="brief" className="p-5">          the ONE box
  <SurfaceSection first eyebrow="Sequence overview" title=… >…</SurfaceSection>
  <SurfaceSection eyebrow="Send 1 of 4 · Day 0" title=… actions=… >…</SurfaceSection>
</Surface>
```

`Surface` publishes its depth through React context. In development, a
`Surface` that renders inside another one prints the rule to the console,
naming both. It is a **warning, never a throw** — a design rule must not be
able to take a page down — and it fires once per name, so a list of forty rows
prints one line, not forty.

Inside the archetypes this is already true by construction: a Detail page has
no outer card and its `Section`s are hairline-divided. `Surface` is for the
surfaces that are not a whole page — the rail, a panel, a document rendered
inside one.

**Not covered by the rule**, deliberately:

- `border-t` / `border-b` **hairline rows in a list**. That IS the pattern.
- A **control** with its own border — `<input>`, `<textarea>`, a button. A
  control is not a surface.
- A **floating layer** over the page — dialog, popover, sheet, dropdown,
  tooltip, command palette. It is not inside anything; it is above everything.

## A user-facing error never shows an internal identifier

`proj-…`, `org-…`, `usr-…`, `acct-…`, `__sentinel__` slugs. They mean nothing
to the reader, they look like a leak, and they are exactly the string that ends
up in a screenshot in a Slack channel.

Redaction happens **at the render boundary**, once, for every tool
(`libs/chat/redact.ts#redactInternalIds`) — not in each thrower, where the next
thrower forgets. The raw text is kept and travels in *Copy details*, which is
what that control is for: the operator gets the id, the reader does not. This
is §12 *hide complexity, never hide truth* read carefully — the truth is what
failed, not which row it failed on.

**Where it came from.** The CEO's preview on a fresh database, 2026-09-16,
rendered `Error  agent __search__ not found in org proj-2df61364-…` verbatim.

A related rule with the same shape: **an empty state is a state, not an
error.** A workspace with no agents says so *before* a turn runs, with the next
step and a link — not after one fails with whatever the server threw. The
composer stays live: somebody may still want to ask what to do, and the answer
is the same sentence.

---

# Do not make me leave

Three mechanisms, one intent: **the thing you need arrives where you are
standing.** A person reading a record should not have to navigate away to ask
about it, should not have the record taken away to make room for the asking,
and should not lose the page to look at something it references.

They are one family because they share one screen and therefore have to
cooperate — which is a contract, not a convention. The seams are named under
each.

## Select → talk

**The one thing that happens when a person highlights words, anywhere.**

`features/comments/AnchoredComments.tsx` + `features/comments/CommentLayer.tsx`
are the standard. A selection inside a commentable region raises a small
control at the selection whose default action is **Ask about this**: the
passage goes to the agent surface as `PageContext.selection` and the composer
takes focus, empty, for the person to say what they want. No special semantics,
no note required, the same motion on every Detail page.

**How a page opts in** — a provider, and regions:

```text
<CommentLayerProvider targetRef="briefing:61" record=… >
  <Section eyebrow="Needs your decision">…</Section>
  <Section eyebrow="Changed since the last brief">…</Section>
</CommentLayerProvider>
```

- `targetRef` — the document notes are stored against (`lead_brief:412`,
  `briefing:61`).
- **The regions are the archetype's own `Section`s.** `Section` emits
  `data-comment-field` from its eyebrow, so a Detail page opts in by being
  wrapped, not by annotating itself. A page outside the archetype marks its
  own regions with the same attribute. The field's *rendered* text is the text
  of record: a reviewer commented on what they saw, so anchors resolve against
  the DOM, not against the markdown behind it.
- `record` — what the passage is about, carried with it so the turn is filed
  against the right thing.

Live on: the personalization lead workspace (every `Section` on every tab) and the **Briefing detail** (every rendered section of the typed
document, through `Section`). The briefing's own bespoke "Ask Vocion" pill is
gone; two selection controls on two pages doing the same job was the defect,
per design principle 6.

**Seam:** `dismissSelectionControl()` (`features/comments/AnchoredComments.tsx`)
— a surface that opens over the page dismisses the control rather than sitting
beside it. Two floating things about two different pieces of the page, one of
which the person did not ask for, is the state that avoids.

### …and a tag is what makes it act

On the personalization lead page the same gesture has one special outcome: the
ask must **alter the sequence draft**, not be answered. That outcome is a
**tag**, not a second control.

The selection control offers a second action, *Add change*, where — and only
where — the page declares `changeIntent`. It stores the anchored note and puts
**`@change`** in the composer beside the quoted passage. The rail's send path
reads the tag and routes to `ReviewService.rewriteDraft({ runId, hint,
contentId })` with the content the anchor named; the send comes back rewritten
and re-presented. Without the tag, the same words are a question.

`@change` is a `ContextRef` of type `intent`, id `change`
(`features/dashboard/chat/composerTags.ts`) — it rides the composer's existing
`@` mention exactly as `@artifact` does, appears in the same popover, is
inserted by the same `(+)` menu, and is stripped from `context_refs` before the
wire because it points at no record. The `(+)` lists it only where a sequence
draft is in view: a menu entry that cannot act is a menu entry that lies.

So the person learns **one** thing — select, then talk — and the tag is the
visible reason a particular ask did something more. Full detail in
`docs/agent-chat-surface.md` § Intents.

## Record pages are full width; the rail is a keystroke away

A record page renders at full width. The conversation rail is an **overlay** on
the right edge, collapsed to its edge tab when you arrive, opened by ⌘J, the
header toggle, *Ask about this*, or a selection. The choice persists per
browser, as the rail's width already does.

Two reasons it is an overlay rather than a column that opens:

1. **The document must not move.** Anchored highlights and the selection
   control above them are positioned from a rectangle measured in the page. A
   rail that reflows the page moves both — the rail would fight the mechanism
   above it in this list.
2. **Geometry belongs to the viewport.** As a column the rail was a child of
   whatever mounted it; the lead page mounts its own, inside the shell's page
   gutter, whose `@container` makes it the containing block for anything
   `fixed` inside it. The rail therefore measured itself against a padded,
   1180px-capped column, and its bottom edge — the composer — sat below the
   fold until you scrolled. The rail portals to `document.body` now, so every
   rail is in the same frame whatever page mounted it.

**And it still does not cover the record.** While open the rail publishes
`--rail-inset` and the shell's page gutter pads itself by exactly that much, so
nothing is occluded; the page is full width again the moment the rail closes.
Overlay is the rail's *geometry*, not a licence to sit on the text.

**The one exception to collapsed-by-default**: a record with a **decision
waiting**. The decision is what the person came for, and hiding it behind a tab
on a page whose masthead reads "Ready for review" is not a thing to make
somebody discover. 058's *"the decision is the point"* is about a pending
decision, not about a record; read that way, both asks hold. The rule lives in
`ChatDock` (`defaultCollapsed ?? !run`), not in each caller. What the rail
opens *onto* beside a record changed on 2026-09-16 — see *The rail is the
conversation, never a second copy of the page* — but the geometry did not.

**Seams:** `dockState.ts` owns the column's geometry and nothing holds a
reference to anything else's internals. `openChatPane()` / `closeChatPane()`
(and the low-level `requestRail`) open and close the chat pane from outside it;
`claimColumn` settles which component draws the column when both `ChatDock` and
the preview's own host are mounted — the dock wins, because it is the one that
can hold both panes. `useDockOpen()` reads the state; `--rail-inset` is the
room the open column is taking. The old `yieldRail()` / `restoreRail()` borrow
is gone: nothing takes the column's slot any more, so there is nothing to
borrow and nothing to restore.

**Where it came from.** Chris, 2026-09-16: *"can we use full width by default
here?"*

## The rail is the conversation, never a second copy of the page

> Chris, 2026-09-16, on a lead page with the rail open: *"what's going on with
> the Chat UX here for personalization? review cards isn't a card. I don't
> really understand what to do with it... if anything? and it's mixed with
> chat. above or below?"*

He was looking at the same four sends twice on one screen. The page's main
pane rendered the record in full — recommended action, prospect facts,
`OUTREACH · 4 SENDS` with each send expandable, the decision in a sticky bar.
The rail then rendered `GuidedReviewPanel` beside it: `SEQUENCE OVERVIEW`
listing the same four sends, then `SEND 1 OF 4` with that send's full body and
an amber *Looks good · send 2 next* button, interleaved into the transcript.

The second copy is unanswerable by design. It is not a message and not a card;
it belongs to neither surface; and because it carries a verb it is not even
inert. "Above or below?" is the right question and it has no answer, because
the thing has no owner.

**The rule.** *The rail carries the conversation and the agent's own output; it
never re-renders what the page already shows.* A record page owns the record —
its facts, its content, and its verbs. The rail owns the talking about it. What
the rail may draw beside a record page:

- **the conversation** — the turns, and what the agent produced *in* them;
- **the agent's own output** — work it just did, something it is proposing,
  something it is blocked waiting on. None of that exists anywhere else;
- **a pointer**, where naming the subject genuinely helps: *one line, in the
  transcript's own voice, that takes the person to the thing* — scrolling the
  page to it when it is on the page, or opening it in the **preview pane above
  the chat pane** when it is not. Never a copy, never an action button.

The preview pane is the general answer to "the agent wants to show me
something". A record or an artifact the agent refers to opens *there*, where it
gets the room to be itself, instead of being flattened into a transcript-shaped
imitation of itself. A transcript that renders a record is always a worse
rendering of that record than the surface built for it.

**What it may not draw:** the record's content, and any verb that belongs on
the record's decision bar. A decision about the record is taken where the
record's other verbs are.

**The predicate.** `pageShowsRecord(ctx, ref)`
(`services/chat/pageContext.ts`) — is the record this conversation is about
already rendered by the page beside it? Evaluated once, in `ChatDock`, against
the `RecordRef` the page declared to the shell (R4's `<RecordContext record=…>`)
and the record the rail is scoped to. It is a question about **context**, not a
prop: a page already says what it is about, and a surface that says nothing —
the full-page chat — is by construction a surface with no record beside it, so
the answer is false and the rail renders the record itself. Nothing is threaded
down the component tree for the two surfaces to divide the work.

**Consequences on the lead page** (`/gtm/lead/[hubspotId]`):

- The rail shows the transcript and one `SequencePointer` line at the top of
  it, naming the sequence under discussion with *Show me the sends on the
  page*. No sequence overview, no send bodies, no buttons.
- *Looks good · send N next* is **gone**, not moved. It was a read receipt for
  a walk that only exists where there is no page to read the sends on; the page
  expresses "I have read this send" with its own accordion. The verbs that are
  actually decisions — Enroll / Snooze / Decline — were already on the page's
  sticky bar and stay there, and a rewrite asked for in the conversation still
  rides that decision (`savedGuidedEdits`).
- A rewrite lands **on the page**: the rail says *"I rewrote Day 3 …"* — that is
  the agent reporting its own work — and `draftRevision.ts` carries the new copy
  to the page, which shows it marked `edited`. Reprinting the send in the rail
  to prove it happened would be the second copy again.
- The rail's **geometry is untouched**: it still opens by itself here, at the
  same width, and still yields and restores its slot. The right column's layout
  — width, collapse, and the preview pane stacked above the chat pane — is one
  concern and it is not this one. What changed is only what the chat pane
  *contains*.

**The audit** — everything `ChatDock` puts in or beside the transcript, and
why it is allowed to be there:

| In the rail | Verdict |
|---|---|
| Messages; `WorkTimeline` (trace, tool calls, failure detail); confidence; *via* attribution | **Agent's own output.** This turn's work; exists nowhere else. |
| `HitlGate` | **Agent's own output.** The loop is blocked on this person right now. Not a record. |
| `RecommendedActionCard` / `RecommendedActionStack` | **Agent's own output** at the moment it is proposed, and the one thing in the transcript that has no page yet — it *is* the proposal. It becomes record data once accepted, and then mirrors what `/dashboard/inbox` shows; it is never rendered beside its own record page, so it is not a second copy on one screen. Left as is. If a page ever renders a proposed run beside the rail, it comes under this rule, and the answer there is the preview pane rather than a second card. |
| `EmptyState` greeting + suggestion chips | Agent/workspace output. |
| `CommentChips`, queued messages, `@` tag chips, the "About:" chip | The person's own pending input, and what the next turn will carry. Not the record. |
| `SequencePointer` | **A pointer**, by this rule. One line, no verb. |
| `GuidedReviewPanel` | **Was a duplication**; now renders only where `pageShowsRecord` is false. |
| `ArtifactChips`, the *Sources · N* pill, inline `[n]` citations | Legitimate agent output in principle, but **inert in the rail** — nothing populates `message.artifacts` here and no sources panel is mounted to open. Named, not fixed: they render nothing or do nothing rather than duplicating anything, so they are a dead-affordance bug, not a division-of-labour one. Their fix is the **preview pane**: a chip opens the artifact or the cited document above the conversation, rather than growing a second renderer inside it. |
| Dashboard link chips in agent prose (`links.ts`) | A reference, not a copy — and the right destination for it is the **preview pane**, not a navigation that costs the page. |

**Seam:** `draftRevision.ts` (`publishDraftRevision` / `useDraftRevision`) — a
window event, the same shape as `dockState.ts`, so the surface that does the
work and the surface that shows the result hold no reference to each other and
an unmounted listener simply does not hear it.

## The drawer has a scope

The conversation rail beside a record is opened from somewhere, and the
somewhere is the subject. Opened from the brief it is **Ask about brief**; from
Send 2, **Editing Send 2**; from the recommendation, **Discuss
recommendation**. The scope rides the same `requestAgentSurface({ scope })`
intent as the prompt and the context, and renders as one line in the rail's
header — **not a second panel, not a second conversation, not a second
composer.**

Two things make it a rule rather than a nicety:

- **"Make this less salesy" needs a referent.** On a page showing three
  artifacts, an unscoped ask is a guess, and the person cannot tell which guess
  the model made.
- **Scope is what the turn attaches, said out loud.** The rail lists what it is
  *Working with* above the composer, and that list is literally the artifact
  ids the turn carries (`PageContext.artifacts`, resolved server-side by
  `services/chat/grounding.ts`, which also writes them into the turn as
  canonical). It is grounding the person can see — and it is not a second
  rendering of the page, which the rule above still forbids: the chips name the
  artifacts, they never draw them.

**Where it came from.** `docs/specs/personalization-v2.md`: the chat answered
*"there's no brief or proposal to review here"* beside a page rendering a
brief, and asserted engagement facts on a brief that marked those fields
unavailable.

## Preview where you are, from any reference

A reference to a record — a citation, an evidence chip, a linked row — opens
that record in a panel over the page rather than navigating to it, so reading
one thing to understand another costs no place in the history.

**The test that separates this from *Select → talk*: is the content already
rendered on this page?** If yes it is a selection, never a preview and never an
inline expansion. If it lives elsewhere it is a preview, never an inline
expansion here.

### When

- **Preview** when a person is mid-task and needs to *confirm* a reference
  without losing their place: deciding on a proposal, reading a brief, in a
  chat turn, scanning a list. It answers "is this the right thing, and what
  does it say".
- **Navigate** when the reference *becomes* the task. The preview always
  carries the link to the full page; it never replaces it.
- **Do not preview** something already fully visible in place, and do not
  preview an action. A decision is a detail page, not a peek — an `inbox`
  reference on a briefing card stays a link.

### A row is a reference, or it is the task

A list you are *scanning to choose from* previews: search results, artifacts,
evidence, linked records. A list that *is your work* navigates: Needs you,
where the row is a decision and the detail is where you make it. **A list
declares which it is; it is never decided per row**, and there is no
per-row heuristic.

`ListRow` says it: `href` alone navigates, `href` + `onSelect` previews. The
row stays a real link either way, so ⌘/Ctrl-click, middle-click, *Open in new
tab* and a copied address always go to the page — the preview only takes the
plain click. `usePreviewList(items, navigate)` gives a previewing list the rest
of the contract at once: the selection read out of the URL, `j`/`k` and the
arrows walking the rows with the preview following, and Enter opening the
detail page. Scanning without clicking is what makes preview-by-default better
than navigation rather than merely different.

| List | Click | Why |
|---|---|---|
| Search | preview | You are finding which result you meant. |
| Artifacts | preview | You are choosing which artifact you wanted; an artifact's home is beside the conversation that made it, so you preview to find it and open it properly to work in it. |
| Needs you | navigate | The row IS the work; the detail is where the decision gets made. |

Nothing in the list's own state moves when a preview opens, so the query, the
filters and the scroll position survive opening and closing one.

**The preview is read-only, always.** An artifact is editable and the editing
happens on the artifact — a preview that sometimes writes is a different
component.

### The contract

- **One column, two stacked panes.** Chris, 2026-09-16: *"I don't want to have
  more than 1 sidebar at a time."* There is ONE right column
  (`features/dashboard/chat/RailColumn`) with one width and one resize handle.
  The preview stands **above** chat in it, separated by a divider you can drag:

  ```text
  ┌──────────────┐  preview — what you are looking at
  ├─ ─ ─ ─ ─ ─ ─ ┤  a divider you can drag; its position persists
  └──────────────┘  chat — what you are doing about it
  ```

  **Stacked, not tabbed**, and the reason is the point of both features: you
  open a preview in order to ask about it. A tab would make you choose between
  the evidence and the question, and hide the evidence at exactly the moment
  you want to talk about it.

  Opening a preview while chat is open SPLITS the column; chat keeps its
  transcript and its composer. Either pane closes on its own — closing the
  preview gives the column back to chat, closing chat leaves the preview full
  height, closing both closes the column to its edge tab. One width for the
  column, never one per pane. Below `RAIL_SHEET_BREAKPOINT` the column is a
  sheet and shows one pane at a time: the preview replaces its content and its
  close control becomes *Back to chat*, because halving a phone helps nobody.
  Opening a preview also stands the selection control down
  (`dismissSelectionControl()`). The column publishes `--rail-inset` while it
  stands beside the page, so the peek never covers the record it is about.
- **Same keyboard.** Escape closes and returns focus to whatever opened it.
  The page's own shortcuts — the decision verbs, `j`/`k` — keep working
  underneath, because the panel never takes focus: a reviewer must still be
  able to approve with `a` while reading the evidence they are approving on.
  That is the difference between a peek and a dialog.
- **Same anatomy.** Header with the source chip and the link out, then the
  body. Nothing else. A preview never carries actions that belong to the
  detail page, and it renders **no `Section`** — a comment anchored in a peek
  would be filed against the page you are standing on rather than the record
  you are reading, so a selection inside a preview raises nothing and the way
  to talk about what you found is the link out.
- **A preview is a place.** It lives in the URL (`?preview=<type>:<id>`), so it
  is linkable, survives a reload, and Back closes it.
- **The in-page pane is the one exception, and it is narrow.** A pane that is
  part of the page rather than the rail — the review sheet's context pane —
  mounts `PreviewPane` directly with `doc` (content the page already assembled
  on the server, so there is no round trip), `onClose` (its own local
  selection, so the global `?preview=` is untouched and the rail does not paint
  a second copy of the same record) and `compact` (drops Share and "Chat about
  this", which do not fit a 288px column and would take the reader off the
  decision). It is still the same anatomy and the same `back` affordance — one
  preview component, two hosts. Anything that points at a record *elsewhere*
  still goes through `EvidenceRefs` / `PreviewRef` and paints in the rail.

### Adding a type

The seam is `RecordRef` (`services/chat/pageContext.ts`). Everything that
points at a thing already is one: evidence items, `@` mentions, inbox rows,
search results, artifact links, briefing claims, CRM subjects. A record type
opts in by adding **one descriptor** to `services/preview/registry.ts` —
`{ sourceLabel, href?, resolve }` — the way a vendor opts in by adding one to
`libs/platforms/registry.ts`. Nothing in the panel, the router or any calling
surface enumerates types, so the descriptor is the whole change and every
surface that renders a ref gets it for free.

Resolvers read **mirrors** (`knowledge_document`, first-party tables), never
the external system: a peek must cost a query, not someone else's rate limit.
A type with no descriptor, or a reference with no synced copy, renders the raw
reference and its link with the reason — never a crash, never a blank panel.
**Never a raw id as a label**: `granola:<uuid>` reads as *Granola meeting*
until the resolver answers with the real title.

A surface consumes it by rendering `<EvidenceRefs sources={…} />` (citations)
or `<PreviewRef recordRef={…} />` (a typed ref) from `features/preview`. Render
the panel anywhere; only the first mounted host paints.

Live on: the proposal decision sheet's Evidence (`AskSheet`), the lead brief's
Claims (`LeadTabs`, through `EvidenceList`'s `renderSource` slot), the
briefing decision cards' evidence (`DecisionCards`), and — as whole lists —
Search (`SearchResults`) and Artifacts (`ArtifactLog`).

---

# One artifact header, and one scroller per column

Two rules about the surfaces that show ONE artifact — the preview pane beside a
conversation, the artifact's own page, and the full-screen `/open` wrapper for a
document. Both arrived on the same day, from the same review.

## The header is one component; a surface omits a verb, it never redraws it

`features/dashboard/artifacts/ArtifactHeader.tsx` owns three things and nothing
else: **the title and kind/version line**, **the tab strip**, and **the action
set**. Every surface wears it.

```text
┌ ArtifactHeader ───────────────────────────────────────────────────────┐
│ Northwind — Proposal          DOCUMENT  v6 · Proposal writer · Sep 17  │
│                            ⟨ save · history · chat · pdf · open ·     │
│                              export · share · close ⟩                 │
├───────────────────────────────────────────────────────────────────────┤
│ [▣ Document] [</> HTML] [⛨ Findings ⑨]      Add to a folder · 5 sheets │
└───────────────────────────────────────────────────────────────────────┘
```

Which verbs appear is a **pure rule**, `actionsFor(surface, artifact)` in
`headerRules.ts`, and the omissions are the content of it:

| | pane (beside a chat) | page (`/artifacts/<id>`) | `/open` |
|---|---|---|---|
| Open in chat | **no** — the pane IS a chat with this open beside it | yes | yes |
| Close | yes | no — a page has no column to give back | no |
| History / Save / Export / Share | yes | yes | no — a read of ONE version |
| PDF / Open full screen | document only | document only | PDF only |

**A surface that cannot support a verb omits it. It never renders a
different-looking version of it** (design principle 6). The page had no way into
a chat and the pane had a one-way HTML button precisely because each surface
assembled its own row; one function answering the question for all three is what
makes "the same vocabulary everywhere" checkable rather than asserted.

### More than one view of one artifact is a tab strip, never a one-way button

`tabsFor(artifact)` — also pure — gives a **document** three views of itself and
every other kind none, because one view needs no chrome:

- **Document** — the rendered sheets. The default.
- **HTML** — the hand-edit view. It is a tab, so you can leave it.
- **Findings** — the render-verify issues and the sceptical-buyer read, together,
  with a count. **Amber only when something blocks**; an empty state when there
  is nothing, because "nothing to answer" is a thing a person wants to check.

`role="tablist"`, arrows and Home/End walk it, icon-led with the label above
`@md` and a real `Tooltip` below it — never a native `title=`. The choice is
remembered per artifact in `localStorage`, inside try/catch.

**Where it came from.** Chris, 2026-09-18: *"I don't have any way to switch back
to View from HTML. Can we turn that into an icon-y tab system"*, and *"11
findings — i don't like that location. can we hide this in a tab icon like
HTML."* The findings were two amber `<details>` blocks stacked above the
document, pushing it down the pane and shouting at somebody who came to read it.

### The meta line carries what you need BEFORE opening the document

The sheet count and the verify verdict. That is all. The red-team state is the
Findings badge; `PDF N pages` is the PDF action's tooltip. *"This is probably too
much context to view at once, it's not more important than getting into the
doc."*

## The window never scrolls; one scroller per column

The shell is exactly the viewport tall (`h-svh`, `AppShell`) and the **page
gutter** is the scroller (`features/dashboard/PageWidth.tsx`). The sidebar, the
top bar and every pane header stay put.

A route that is a two-pane working surface declares itself in
`features/navigation/pageWidth.ts` — `isViewportFitPath` beside `isFullBleedPath`
— and then the gutter does not scroll either: the page lays itself out to the
height it was given with `h-full`, and the scrolling happens inside its panes.
One scroller per column:

```text
chat + artifact   conversation → MessageList scrolls
                  document     → the document scrolls INSIDE its own iframe
artifact page     the pane's body scrolls, or the document does
every other page  the gutter scrolls. Once.
```

**A page never guesses at the chrome above it.** `h-[calc(100vh-6rem)]` against
8rem of real chrome is what put a third scrollbar on the window and carried the
whole shell with it; `h-full` is the height the shell measured. The guess is now
impossible because there is nothing to guess.

**Where it came from.** Chris, 2026-09-18: *"I've got ugly scroll in scroll for
the doc"*, then *"scroll in scroll bug for chat / overall window too"* — three
scrollbars at once on `/dashboard/chat/<id>?artifact=<id>` at 1920.

## The document is the client's page; the app's chrome belongs to the app

A rendered document may not carry the app's controls. The house framework kept
emitting `<div class="actions"><a onclick="window.print()">⤓ PDF</a></div>` over
the client's first sheet however often the skill said not to, and an agent
eventually hand-patched a malformed variant of it. Asking again is the wrong
lever: `stripDocumentChrome` (`libs/documents/sheets.ts`) removes it
deterministically — before the engine verifies, before it stores, and again on
the way out of `/api/artifacts/<id>/document.html` and into the pane's srcdoc, so
rows written before the transform came along are clean too. Printing is the
app's verb, beside the PDF the renderer already made.

This is *structural over prompting* (`CLAUDE.md`) with a UI consequence: a
required rendering behaviour that the prompt cannot guarantee is enforced in
code.

---

# Everything stacked above a composer shares its column

Context chips, queued messages, `@` tag chips, anchored-comment chips, the
pasted-text chip, the docked Decision card. One padding rule, expressed in the
composer container (`ChatComposer`'s `above` slot), never per child — a child
that guesses at the inset is a child that ends up flush against the rail edge
while the box beside it is inset.

---

# Decision card

**Everything a person is asked to decide is one card**
(`features/dashboard/chat/decisions/DecisionCard.tsx`), drawn from one record
(`libs/decisions/decision.ts`; the model is in `docs/guides/decisions.md`).
Ten mechanisms asked before it — an ask sheet, a recommendation card, a
proposal card, an approval gate, a ruling's buttons, chips that sent text — and
two surfaces doing one job is a defect (design principle 6).

## Anatomy

Docked just above the composer, first in its `above` slot, the way the Claude
app asks:

```text
PRODUCT MANAGER ASKS · 1 of 3                                   ⌄
Which repo should the factory build in?
Two repos match "Northwind" and the request names neither.

 1  Northwind API     Recommended
    Builds land in northwind/api; CI runs on every push.
 2  Northwind Portal
    Builds land in the customer portal.
 3  Something else…
────────────────────────────────────────────────────────────────
↑↓ move · 1–2 pick · ↵ submit · Esc fold · Tab something else   Skip  [↵ Submit]
```

- **One surface** (`Surface name="decision"`): options are rows on hairlines,
  never boxes inside the box. The selected row takes `--surface-soft`; its
  number badge fills with `--action`. "Recommended" is `--brand-pass` text, not
  a chip.
- **The recommendation is first and preselected.** On a fresh card, Enter
  accepts it.
- **Each option says what it does**, in one line under its label.
- **"Something else"** is an inline field — the answer in their own words —
  numbered after the last option. Offered unless the Decision takes only its
  options.
- **Skip** is always there: the agent carries on without an answer.
- **One at a time.** "1 of 3" in the eyebrow when more wait; the rest queue
  behind it. The card **blocks only itself**: the composer below stays live and
  reads "Or reply directly…", and what is typed there is read against the card
  before it is routed.
- **The deadline**, when the decision clock runs one, is one line under the
  question: "Default in 2 days: Northwind API".

## The keyboard contract

The card is fully keyboard-driven, and the keys are shown on it.

| Key | On the option list | In "Something else" |
|---|---|---|
| `1`–`9` | Pick that option (toggle, where several may be chosen). The number after the last option goes to "Something else". | types |
| `↑` `↓` | Move; a single choice follows the highlight. `↓` past the last option enters "Something else". | `↑` at the start returns to the list |
| `Home` `End` | First, last option | — |
| `Space` | Pick the highlighted option | types |
| `Enter`, `⌘↵` | Submit what is picked — on a fresh card, the recommendation. On an **approval**, `⌘↵` is the recommendation (Allow once), whatever is highlighted | Submit their words |
| `Tab` | Reach "Something else", then Skip and Submit | — |
| any letter | Starts an answer in "Something else" | types |
| `Esc` | Fold the card to one line ("1 decision waiting"); nothing is answered. On an **approval**, `Esc` is **Deny** | Puts half-typed words down first (back to the list); then as on the list |

Focus: a Decision that docks **takes focus**, so Enter alone answers it — unless
the person is typing in another field, which a card never interrupts.

## An approval is a permission prompt

Claude Code's prompt, on the same card:

- **Title** `Allow <agent> to <plain action>?` (`decisionTitle`); a question
  already asked as one keeps its words.
- **Preview** — the exact payload in a monospace block under the why
  (`--surface-soft`, hairline border, scrolls past ten lines): the email as it
  will go out, a record's field-by-field diff, the command.
- **Options** `1 Allow once` (recommended, `⌘↵`) · `2 Always allow <this kind>
  in <workspace>` — present only where the trust ladder would take it for this
  person · `3 Deny` (`Esc`) · `Something else…`. Each says its consequence in
  one line. The key hints read `⌘↵ allow once · Esc deny`.

## Links, setup steps and the queue

- **An option that opens** (a sign-in, a token form) says "Opens ↗"; choosing
  it navigates, and the Decision is answered when the flow returns.
- **"Details"** at the top right opens the long form (the record, the proposal,
  the agent) in place; a sign-off has "Open it" for its artifact.
- **The queue** carries this conversation's Decisions first, then what waits on
  the person elsewhere ("Waiting on you · Revenue lead asks"); an answer to one
  of those says what it did in one line above the card.
- **A walk is the same card.** "Connect your systems" docks its steps one at a
  time with the card's own props for a step (`eyebrow`, `bodyNode`, a form in
  `children`, `skipLabel`, `submitLabel`, and `onEscape` — Esc and a labelled
  "Stop ×" go back a step or stop, in place of folding). There is no second
  docked card.
- **Warm start** (`chat/emptyChat.ts`). On an empty chat nothing docks unless
  the person started it; what waits elsewhere is the one soft chip
  (`WaitingNudge`, to Review), never a card on its own (`dockPlan`).
  The active Decision is the latest item in the thread, full height — no cap
  above the composer, no inner scroll (`decisionBlock`); its controls are 44px
  on a phone. A chip, a checklist step or a link sends the person's words as a
  turn; it never opens a card by itself (`libs/chat/ask.ts`).
- **A look.** An option whose effect has a picture (a drafted brand) draws it
  under the why (`decision-look`), from a renderer named on the option; a
  renderer the client does not know draws nothing.
- **Not locked while the agent replies**: the next card can be answered at once;
  the answer is held and sent when the turn lands.

## Accessibility

- The docked card is `role="dialog"` (`aria-modal="false"`), labelled by its
  question and described by its why.
- The options are a `role="listbox"` with `aria-activedescendant` (the list
  owns the keys; options are highlighted, not focused), `aria-multiselectable`
  where several may be chosen, `aria-selected` on each `role="option"`.
- A polite live region says **once per Decision** what arrived and how to
  answer it.
- "Something else" is a labelled input; the chevron says what it does and its key.

## Variants

- `dock` — above a composer, with the chevron and Esc.
- `list` — a Needs you row: `role="group"`, no autofocus, no fold.

## What an answer is

A typed `DecisionAnswer` — options by id, their own words, or a skip — handed to
`onAnswer`. **Never text in the composer, and never a message in the person's
name**: the card collapses into one bubble on their side — the question small,
the answer under it ("Which repo…? / Northwind API"), "Skipped" for a skip.
That bubble is the turn the agent answers. The Done line for what an option ran sits under the reply,
with Undo only where the action's kind has one.

Storybook: `Chat/DecisionCard` — every state (choice, question, approval as a
permission prompt, proposal with Always allow, sign-off, setup step, setup
connect, waiting elsewhere with its notice, several, queued, folded, deadline,
busy, refused, list row, the answer and Done lines), each in light and dark.

---

# The composer bar is one control tall, and bottom-aligned

Four things sit in that bar — `(+)`, the gauge, the text, the send button — and
until 2026-09-19 they sat on four different optical centres, because the row
bottom-aligned three different heights: a 32px ghost, a 36px send button and a
24px box holding a 22.8px line. Measured at 1920: send at 27px from the top of
the box, `(+)` and the gauge at 29px, the first line of text at 32.4px. Chris:
*"tighten or clean up vertical alignment of elements in chat bar"*.

**The rule, in `features/dashboard/chat/composerBar.ts`:** every control is
`CONTROL_PX` (32px) tall, one line of text is exactly `CONTROL_PX` tall — a
fixed 24px line box plus 4px above and below, so 14px and 16px text share a row
— and the row keeps `items-end`.

Bottom-aligned rather than centred, because the box grows DOWNWARD as it fills:
the controls belong beside the line the person is typing, not floating at the
middle of a paragraph. And because one line is exactly one control, *bottom-
aligned* and *centred* are the same picture when the box is empty. Every
control's centre is the last line's centre at every height (25px empty, 97px at
four lines, on both surfaces and both widths).

32px because that is already the repo's round-ghost control size
(`PanelCloseButton`, and `(+)` and the gauge themselves); the send button
joined them rather than the other way round, and stays the primary action by
fill, not by being bigger. The box caps at eight whole lines so the cap never
leaves half a line above the controls.

**The touch target grows, not the control.** A control that grew to 44px on a
phone would stop being one line tall and break the rule, so the hit area grows
instead — a `pointer-coarse:` pseudo-element at `-inset-1.5` (32 + 6 + 6 = 44),
with the row's gap opening to 12px there so two 44px targets sit side by side
rather than overlapping. This is the one place that does NOT follow
`min-h-11 sm:min-h-0`, and the reason is geometric.
