# Component vocabulary

The classes in `framework.css`, and the markup each expects. Copy these shapes;
do not invent siblings. Palette is CSS variables on `:root` in the same file
(`--ink`, `--body`, `--muted`, `--teal`, `--accent`, `--seafoam`, `--sage`,
`--line`, `--line2`, `--cream`).

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
Three steps, two arrows. `o` makes a step accent.

## Agents and people

- `.crew` › `.agent` blocks: name, one line of what it does, `.skills` › `.sk` chips. A `.gly` inline SVG (24 viewBox, 1.8 stroke, currentColor) marks agent vs human.
- `.mag` › `.mag-row` (+ `.opt` for a future build, `.hum` for the client's team) › `.mag-s` state; `.mag-sk` skills line; `.mag-note` under the list.
- A future build is unmistakable: `.opt` row, dashed chips, `.futtag` "FUTURE BUILD · NOT IN THIS SCOPE".

## Product UI windows

- `.win2` / `.plat` — the one boxed element in a document: mac dots `.wd.r/.y/.g`, a `.plat-url`, then `.plat-nav` + `.plat-main`. `.mock-cap` caption under it. Call it "the product UI", never "mock".
- `.ovcards` › `.ovc` › `.ovh` (dots + `.oht` title) + `.ovb` body — three small windows side by side.
- `.hitl` — the review-queue window with `.h-top`, `.h-req`, `.h-draft`, `.h-btn`, `.h-conf`.

## Gantt

`.gantt` › `.g-head` (week labels) then `.g-lane` › `.g-lbl` + `.g-row` with `.g-bar` positioned by `style="grid-column: 2 / 5"`. `.g-bar.b` for the accent track, `.g-bar.stretch` for an optional, open-ended item. `.g-gate` for a decision line, `.g-note` to anchor week 1 to a date. Bars must land on the intended week columns — the look pass checks.

## Money and stats

- `.money` — the price block; `.vals` › `.val` for a stat row; `.dtiles` › `.dtile` for dashboard tiles with `.dmeter` / `.dbars` / `.dchart` indicators (categories only: Baseline · Target · Measured — never invented performance numbers).
- `.offer` — the post-delivery option box with an eyebrow.
- `.faq` — two-column Q&A; answers that are yes start with "Yes."
- `.ph` — the amber placeholder for anything unbaselined or unverified.
- `.apx` — appendix rows with `.apx-tag`.

## Logos

Inline as data URIs. A stacked wordmark turns to mush at 15px: use the mark in the strip and the full lockup (`.clogo-lockup` › `.clogo-mark` + `.clogo-txt`) on the cover only.
