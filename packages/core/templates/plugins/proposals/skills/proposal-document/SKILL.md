---
slug: proposal-document
name: Proposal document
description: >-
  Write, revise and verify a paginated, print-ready client document — a
  proposal, scope doc or partnership update — in the house sheet framework,
  grounded in the client's data room. Read before the first sheet, and again
  before changing one: it carries the framework, the component vocabulary, the
  structure rules, the language rules and the verify loop.
version: 3
resources: [framework.css, components.md, spine.md, visuals.md, red-team.md]
---

# Proposal document

A client document is US-Letter **sheets**, self-contained HTML, printed to the
PDF the client reads. Not markdown. Not a slide deck. Sheets.

What good looks like is in `spine.md` (the twelve sheets and what each
carries), `visuals.md` (when a sheet earns a visual and the vocabulary) and
`red-team.md` (how the buyer will read it). Read all three before the first
sheet of a new document.

## The loop

1. **Read the data room** (`read_data_room`). The starred sources are what you
   write from. The client's own words — their project names, their stage
   names, their vocabulary — become the document's spine. If the newest call
   has no **decision log** (a numbered list of the decisions and corrections a
   person actually said, in their words), write one and file it on the room
   first; every sheet then traces to a line in it.
2. **Read your learnings** (`/learnings/proposal-feedback.md` is mounted):
   what people cut, rejected or corrected in earlier proposals. They win over
   this skill where they disagree.
3. **Draft the sheet list** before any HTML: one line per sheet, in order,
   from `spine.md`. Pass `room_id` on `render_document` so the document lands
   on the room and the Proposals board.
4. **Read the brand** (`get_brand`): paste its `:root` tokens into the
   `<style>` block ahead of `framework.css`, inline its logo data URIs in the
   strip and the cover, and keep its voice rules beside the ones below.
5. **Build sheet by sheet, never the whole document in one call.** A 12-sheet
   proposal is 40 KB of HTML; one tool call that size runs into the model's
   output cap and arrives truncated (production, 2026-09-18: `render_document`
   called with no `html`). So: `render_document` with the head, the brand
   tokens, `framework.css` and the COVER sheet only; then `edit_document` with
   one `insert_sheet` per sheet, in order, reading each receipt. Every call
   stays small, and every sheet gets its own verdict.
   Inline `framework.css` into the `<style>` block; use the components in
   `components.md`; logos as data URIs.
6. **Read the receipt.** It names every sheet whose footer moved, every sheet
   that overflows and by how much, every element past the edge, the PDF page
   count and any asset that did not load.
7. **Fix by sheet** with `edit_document` — `replace_sheet` with the trimmed
   sheet, `remove_sheet`, `insert_sheet`, `replace_text` — and read the next
   receipt. Trim content on an overflowing sheet; never shrink the footer
   reserve. Usually two to four rounds.
8. **Verify**: `verify_document` with the look on. The receipt must read "no
   issues" and the PDF page count must equal the sheet count.
9. **Red team**: `red_team_document` with the rubric from `red-team.md` and
   the room's starred facts as `context`. Fix every BLOCK by sheet and run it
   again. A document is done when verify is clean and the red team has no
   blocks; say what you left and why.
10. `export_document_pdf` when the person asks for the PDF, or when it is ready
   to send. The send email is a separate, light-themed artifact with no dollar
   figure in it.

Change the open document in place. "Cut page 9", "make it three agents",
"price it per opening" are `edit_document` ops on named sheets. Never render a
second document to make a change.

## The framework (non-negotiable)

- `<title>` is the PDF filename: `<Subject> - <What it is> (Metacto) v<N.N>`.
  On a codenamed deal use the codename so the filename cannot leak a name.
- `.sheet` is `8.5in × 11in`, `overflow:hidden`, a flex column of `.strip`
  (doc label left, seller and client logos right), `.body`, `.foot`.
- **Footers are pinned, never flowed.** `.foot{position:absolute;bottom:0.5in}`
  and `.body{padding-bottom:44px}` to reserve its height. `margin-top:auto`
  looks right until one page overflows, and then only that page's footer
  moves. Pinning reveals overflow instead of hiding it — that is the point.
- **One footer form for the whole document.** The "Prepared by" `.fsplit`
  variant is the cover only; every other sheet is the page number alone.
- `@page{size:Letter portrait;margin:0}`. No print button inside the
  document: the frame around it carries PDF and Open, and a control drawn on
  the sheet prints with it. (One "PDF" was showing twice, 2026-09-18.)
- **Force print colours** — `print-color-adjust:exact` on `html` and again
  inside `@media print` with `!important` — or the brand rule and the sage
  panels vanish on the client's own printer. Headless print has them on, so a
  test PDF hides the trap.
- **Light, always.** Client documents ship no dark-mode block.
- Renumber footers programmatically — `edit_document` does it — never by hand.

## Structure rules

- **Three named products or agents, one sheet each**, in the client's own
  language and their sequence. Products, not architecture layers.
- Order them so each makes the next work: the record has to exist before
  anything can read it.
- **Sparsity beats cramming.** A topic that deserves a sheet gets a sheet.
- **Pull-quote the client** with attribution on the sheet their words drove.
- A **measurement sheet** that builds the number the client does not have,
  with amber `.ph` placeholders on anything unbaselined.
- The cover: client logo, eyebrow, an h1 promise in the client's terms, an
  accent subtitle, a short mission paragraph, then `.bdt` rows for
  **The goal** (metrics bolded, never guaranteed), **The build**,
  **The deliverables**.
- The last sheet: investment, next steps as **Confirm · Send the inputs ·
  Kickoff** (with a real date), and a plain paragraph on what the system will
  not do.

## Language rules

- Never promise a business outcome. No P&L, margin or revenue figures. Commit
  capabilities; measure together. Goals sit under "The goal" with the metric
  bolded.
- No antithesis phrasing ("not X, but Y"). Do not lead with the negative.
- Numerals, not spelled-out numbers: 1,257 · $548,000 · 46%.
- Metacto takes a capital M in prose.
- Staffing is "provided as individual or combined resources", never headcount.
- "the <client> team", never "<person>'s team".
- No consultant jargon for the client's systems or people: "the systems you
  run today", never "your estate".
- No prose em-dashes. Split the sentence, or a colon after a bold label.
- Say plainly what the system will not do: the agent flags, the client's team
  decides.
- Assume the yes. Cut any line that invites a no.
- Kill the chatbot register: "before anything moves", "tell me plainly",
  "moving the needle", constructed contrast tails. Say the literal thing.

## Learn from every correction — this is the loop that matters

Feedback on a proposal generalises more often than most feedback. When a person
cuts a line, rejects a shape, or corrects a claim in chat, ask: **would this
apply to the next client's proposal?** If yes, it is a rule — `add_learning`
into `proposal-feedback` with the person's words as the source, at 0.9 when
they said it and 0.6 when you inferred it. A red-team finding that appears on a
second document is a rule the same way. Review decisions on your proposals
file there on their own; you file what you hear in conversation. The next
proposal starts without the mistake.

## Grounding

- Every claim traces to the data room. An unverified number, stat or quote
  renders as an amber `.ph` placeholder and is filed as an open item on the
  room. It is never invented and never quietly dropped.
- Once a client has seen a document, revisions are a new version with a new
  dated title; the reviewed version stays in the history untouched.

## Pricing

- Restructure before discounting: a rejected number wants a different
  commercial shape, not a smaller figure.
- Discounts are named, earned concessions, each with what it buys — a term
  waives the build; a case-study agreement lowers the monthly.
- Give the buyer a unit they already think in ("$100 per open role per month
  at your typical 20").
- Never bundle away the run cost: hosting and model usage stated separately,
  at cost, as an estimate sized to the deployment.
- Risk reversal beats a further discount: a 60-day walk-away trial.
- Pricing and commercial shape are the seller's call: propose the nearest
  precedent, flag it unconfirmed on the room, and confirm before sending.
