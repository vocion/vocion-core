# Component vocabulary

The classes in `framework.css`, and the markup each expects. Copy these shapes;
do not invent siblings. Palette is CSS variables on `:root` in the same file
(`--ink`, `--body`, `--muted`, `--teal`, `--accent`, `--seafoam`, `--sage`,
`--line`, `--line2`, `--cream`).

**You do not paste `framework.css` into the document.** The render path puts it
into every document it renders, underneath whatever `<style>` you write, and
re-injects the current file on every edit and every verify. Your `<style>` block
carries the brand's `:root` tokens and nothing else it does not need. A class
you use that has no rule anywhere in the document is reported by name in the
render receipt — every one of them renders as a bare `<div>`, which is the
single biggest reason a document looks less designed than it reads.

## Sheet skeleton

```html
<article class="sheet">
  <div class="strip">
    <span class="l">Doc label · Section</span>
    <span class="r"><img src="data:image/svg+xml;base64,…" alt="metacto" /><span class="div"></span><span class="tag">CLIENT</span></span>
  </div>
  <div class="body">…</div>
  <div class="foot"><div class="pnum">3 / 11</div></div>
</article>
```

Cover footer only: `<div class="foot fsplit"><div class="fnote">Prepared by … · Metacto · …</div><div class="pnum">1 / 11</div></div>`.
Add `dense` to `.body` on a sheet that carries a table and a list (`<div class="body dense">`).

## Headings and prose

- `h1` — the cover promise (inside `.body.cover .hero`, with `.eyebrow` above and `.subtitle` below).
- `h2` — one per sheet, uppercase by CSS; `<span class="num">3</span>` before the words for a numbered section.
- `h3` — sub-heads inside a sheet.
- `.lede` — the teal callout paragraph; `style="border-left-color:var(--accent)"` for a pull-quote with a `<span>` attribution under it.
- `.docmeta` — the small metadata line under a title (client · version · date).

## Rows and labels

- `.bdt` › `.bdt-row` › `.bdt-l` (label; add `g` for accent) + `.bdt-t` (text). The cover's goal / build / deliverables.
- `.drow` — editorial hairline row: `<div class="drow"><b>Reads:</b> what it reads</div>`. `.drow.ico` for an icon column.
- `.sysrow` › `.syschip` — a row of chips (measures, systems, skills).
- `.pill` — a status chip; `.pill.appr` / `.pill.hold` / `.pill.done`.

## Journey strip

```html
<div class="journey">
  <div class="jstep"><div class="j-w">Days 1–30</div><div class="j-t">Record</div><div class="j-d">One line.</div></div>
  <div class="jarr">→</div>
  <div class="jstep o">…</div>
  <div class="jarr">→</div>
  <div class="jstep">…</div>
</div>
```
Three steps, two arrows — the cover's shape. `o` makes a step accent.

For a process with **four or five steps**, add `n4` or `n5` to `.journey` and
drop the arrows: `<div class="journey n5 mid">` with five `.jstep`s, no
`.jarr`. `mid` is the smaller top margin for a strip inside a sheet rather
than under the cover's mission paragraph. Colour the rules by phase — leave
the steps the client does teal, and make the ones the system does `o`.

## Agents and people

- `.crew` › `.agent` blocks: name, one line of what it does, `.skills` › `.sk` chips. A `.gly` inline SVG (24 viewBox, 1.8 stroke, currentColor) marks agent vs human.
- `.mag` › `.mag-row` (+ `.opt` for a future build, `.hum` for the client's team) › `.mag-s` state; `.mag-sk` skills line; `.mag-note` under the list.
- A future build is unmistakable: `.opt` row, dashed chips, `.futtag` "FUTURE BUILD · NOT IN THIS SCOPE".

## Product UI windows

The **only** boxed elements in a document. Call it "the product UI" in prose,
never "mock", and put a `.mock-cap` italic caption under every one.

`.win2` is the workhorse: a dark titlebar over hairline rows of believable
records. Titlebar names the client's own app and where they are; the right of
the titlebar carries the queue state; each row is a title, a muted subline and
a status `.pill`.

```html
<div class="win2">
  <div class="wh">
    <i class="wd r"></i><i class="wd y"></i><i class="wd g"></i>
    <span class="wu"><b>Northwind Quality</b> · Bellwater Yard</span>
    <span class="wr-meta">14 structures in queue · 3 awaiting sign-off</span>
  </div>
  <div class="wr2">
    <div class="tl2">48" manhole · Structure 48-2291<i>Pour complete 09:40 · Inspector: assigned</i></div>
    <span class="pill hold">In walkaround</span>
  </div>
  <!-- three more .wr2 rows -->
</div>
<div class="mock-cap">Illustrative interface. Checklists, SKU types and which steps require a photo are defined with your quality team in month 1.</div>
```

- `.wh` — the dark titlebar. `.wd.r/.y/.g` mac dots, `.wu` the app and place (`<b>` the app name), `.wr-meta` the right-aligned queue state.
- `.wr2` — one record row; `.tl2` the record, with an `<i>` inside it for the muted second line; a `.pill` on the right for the state.
- `.pill.hold` amber (waiting on someone) · `.pill.done` teal outline (finished) · `.pill.appr` solid accent (needs a person now).
- `.plat` — the full app shell for a cover: `.plat-bar` (dots + `.plat-url`), then `.plat-nav` + `.plat-main`.
- `.ovcards` › `.ovc` › `.ovh` (dots + `.oht` title) + `.ovb` body — three small windows side by side, for three products at once.
- `.hitl` — the review-queue window with `.h-top`, `.h-req`, `.h-draft`, `.h-btn`, `.h-conf`.
- `.ctx` › `.cr2` › `.ck` + `.cv` — a key/value read-out inside a window.
- `.cb.u` / `.cb.a` — chat bubbles inside a window, the person's and the agent's.

## Gantt

`.gantt` › `.g-head` (week labels) then `.g-lane` › `.g-lbl` + `.g-row` with `.g-bar` positioned by `style="grid-column: 2 / 5"`. `.g-bar.b` for the accent track, `.g-bar.stretch` for an optional, open-ended item. `.g-gate` for a decision line, `.g-note` to anchor week 1 to a date. Bars must land on the intended week columns — the look pass checks.

## Money and stats

- `.money` — the price block; `.vals` › `.val` for a stat row; `.dtiles` › `.dtile` for dashboard tiles with `.dmeter` / `.dbars` / `.dchart` indicators (categories only: Baseline · Target · Measured — never invented performance numbers).
- `.offer` — the post-delivery option box with an eyebrow.
- `.faq` — two-column Q&A; answers that are yes start with "Yes."
- `.opts` › `.opts-h` (the eyebrow) › `.opt-row` › `.opt-v` (the figure, right) — a priced line-item list.
- `.twocol` — two equal columns with no rule between them. The "what changes / what does not change" pair under a product UI window is this, with a `h3` and a `<ul>` in each half.
- `.ph` — the amber placeholder for anything unbaselined or unverified.
- `.apx` — appendix rows with `.apx-tag`.

## Logos

Inline as data URIs. A stacked wordmark turns to mush at 15px: use the mark in the strip and the full lockup (`.clogo-lockup` › `.clogo-mark` + `.clogo-txt`) on the cover only.
