# Decks: the second client deliverable

A **deck** is a 16:9 presentation a client sees in a meeting. A **document** is
the paginated US-Letter file they carry into their own business case. Both are
**client deliverables**, and both are artifacts: versioned, red-teamed, gated
before they print, filed to a data room and shown on the Proposals board.

This file is the contract for the `deck` kind. Build to it; change it in the same
PR as the code that changes the behaviour.

## Principles this serves

- **Vocion is enough on its own.** A deck goes from draft to sent PDF without any
  outside editor, account or runtime. Vocion renders every element itself.
- **Every outside tool is an adapter, and every adapter is optional.** PPTX
  (PowerPoint, Keynote, Google Slides), DOCX (Word, Google Docs, Pages) and the
  editor-neutral MCP check-out/check-in (Claude, ChatGPT, any MCP client). No
  adapter is on the path from draft to PDF, and none is named in core prompts.
- **One shape, used everywhere** (principle 6). Decks reuse the document
  machinery: `ArtifactService` versions, the red team, the export gate, the
  learning step, data rooms and the Proposals board. Nothing is built twice.

## The format: `vocion-deck/1`

The format is deliberately close to the Claude Slides `deck.json` v4 file
layout, so that adapter stays thin, but it is Vocion's, versioned here, and no
part of Vocion loads another product's runtime.

```ts
type DeckSpec = {
  format: 'vocion-deck/1';
  title: string; // also the PDF filename
  order: string[]; // slide ids, deck order; ids match [A-Za-z0-9_-]{1,64}
  slides: Record<string, string>; // id -> exactly one <section id="<id>">…</section>
  sections?: Record<string, { description: string; start: string }>; // outline; start is a slide id
  faces?: Record<string, { family: string; href: string }>; // Google Fonts css2 links only
  assets?: Record<string, { url: string; contentType: string; bytes?: number; name?: string }>;
  playbook?: string; // 'proposal', 'concept', 'case-study', … (the client-facing test)
  origin?: { kind: 'import' | 'checkout'; tool?: string; ref?: string; baseVersion?: number };
  verification?: DeckVerification; // written by the engine, per version
  redTeam?: DocumentRedTeam; // the same receipt shape documents use
};
```

### A slide

One `<section id="<id>" style="…">` on a fixed **1920×1080 px** canvas. All
styling is inline. The section sets `background`, the text defaults
(`font-family`, `color`) and its layout (`display:flex|grid`, `padding`, `gap`,
alignment). Children flow inside it; `position:absolute` pins a child to the
slide. Later children paint over earlier ones.

Allowed elements: `h1 h2 h3 p ul ol li br b i u a span div img table tr th td
svg hr aside` and three Vocion elements:

| Element | Attributes | Renders as |
|---|---|---|
| `<x-icon name="Lock">` | `name`, inline `width`/`height`/`color` | an inline SVG from Vocion's icon map (`libs/decks/icons.ts`) |
| `<x-shape kind="arrow-right">` | `kind`: `rect rounded ellipse diamond arrow-right arrow-left arrow-up arrow-down line`; inline `background`, `border` | an inline SVG filling the element's box |
| `<x-connector x1 y1 x2 y2>` | `head`: `end` (default) `start both none`; `route`: `straight` (default) `hv vh`; inline `color`, `border-width`, `border-style` | an SVG line in slide coordinates |

An unknown icon name, shape kind or element is an **audit failure that names
it**, never a silent blank.

**Speaker notes** are plain text in one `<aside>`, the section's last child, up
to 4,000 characters. In Metacto's house style the notes carry provenance: who
said it, on which call, what is synthetic, and which figures are drafts.

**Images** use `src="asset:<id>"`, where `<id>` is a key of `assets`. Assets
are Vocion-hosted files (the same store `file` artifacts use). A `data:` URI
or a remote URL in a slide fails the asset audit; adapters translate their own
image references to and from `asset:` ids.

## The engine: `services/decks/DeckEngine.ts`

The deck twin of `DocumentEngine`, sharing its deliverable layer
(`services/deliverables/`): versions through `ArtifactService`, the red team,
the export gate and the learning hooks.

Every create and every revision:

1. **Renders** each slide at 1920×1080 in the shared Chromium
   (`libs/documents/render.ts`'s browser), with Vocion's element runtime
   (`libs/decks/runtime.ts`) inlined and `asset:` ids resolved to served URLs.
2. **Audits** each slide with DOM facts, not pixel scans:
   - content outside the 1920×1080 canvas (overflow, clipping)
   - text set under 24px
   - anything but the footer band below y 920 (report)
   - more than 200 elements
   - unknown elements, icon names or shape kinds
   - unresolved assets
   - unresolved placeholders: `[$__]`, `[__]`, `[date]` and the like (report)
   - no speaker notes (report)
3. **Screenshots** each slide (stored as files, URLs on the verification) and
   **prints the PDF**: one 1920×1080 page per slide, backgrounds on.

The verification is stored on the version it verified, exactly as documents do,
so the pane, the board and the agent's receipt all read the same facts.

## Tools

| Tool | Does |
|---|---|
| `render_deck` | Create a deck from a `vocion-deck/1` spec (or Claude Slides v4 files, converted on the way in) in a data room; render, audit, return the receipt |
| `read_deck` | The deck as files: index, slides with notes, assets, and the last receipt |
| `edit_deck` | Operations, applied atomically as one version: `replace_slide`, `insert_slide`, `remove_slide`, `move_slide`, `replace_text` (literal, must match), `set_notes`, `set_title`, `set_asset` |
| `verify_deck` | Re-render and re-audit, optionally with the vision look |
| `export_deck_pdf` | Print through the same export gate as `export_document_pdf` |
| `deck_checkout` / `deck_checkin` | The editor-neutral round trip, below. Also work for documents |
| `export_pptx` / `import_pptx` | The PPTX adapter for decks |
| `export_docx` / `import_docx` | The DOCX adapter for documents |

`red_team_document` and the export gate accept either kind. The red team reads
slide text **and** speaker notes. The gate keeps its existing behaviour and the
"accelerate, never block" rule: it holds an agent's export on a blocking
finding, and a person who asks for the PDF gets it with the finding as one line
of advice.

## Out and back

Vocion is the canonical copy. Every way out records where the deck went
(`origin`), and every way back is a new version, re-rendered and re-audited.

### MCP check-out and check-in (any assistant)

- `deck_checkout { id }` returns the deliverable as files (for a deck:
  `deck.json` plus `slides/<id>.html`; for a document: `document.html`),
  short-lived download URLs for its assets, and `baseVersion`.
- `deck_checkin { id, baseVersion, files, assets? }` writes a new version.
  New images arrive as URLs or base64. **A stale `baseVersion` is refused**
  with a slide-by-slide (or sheet-by-sheet) diff of what changed in Vocion
  since the checkout, so the person can redo their change on top.
- Claude Slides v4 files (`project/deck.json`, `project/slides/*.html`,
  `/_blob/<id>` images) are accepted as-is and converted. That conversion is
  the whole Claude adapter.

### PPTX (PowerPoint, Keynote, Google Slides)

- **Export** lays each rendered slide out as native objects: text boxes with
  their computed font, size, weight and colour; images; simple shapes. Anything
  that has no faithful native form (gradients, SVG diagrams, connectors) is
  rasterised from the render at 2×. Notes go to the slide notes. Each object is
  named `vocion:<slideId>:<path>` so it can be recognised on the way back.
- **Import** is lossy by nature, so it merges instead of replacing. A slide
  whose objects still carry their `vocion:` names gets its **text edits applied
  to the original HTML**. A new or restructured slide is converted to absolutely
  positioned HTML. Removed and reordered slides follow the file. The result is a
  new version with a per-slide report: kept, text edited, converted, added,
  removed.

### DOCX (Word, Google Docs, Pages), for documents

- **Export** maps sheets to sections with page breaks, headings and paragraphs
  to styles, tables to tables, images inline. Each paragraph carries a hidden
  `vocion:<sheet>:<path>` bookmark.
- **Import** applies changed paragraph text back into the original sheet HTML,
  matched by bookmark, then by text similarity. Paragraphs it cannot place are
  listed in the report and left out, never guessed into a sheet.

The PDF always comes from Vocion's renderer, never from an adapter.

## The pane

One deliverable pane for both kinds: page thumbnails, the selected slide or
sheet large, its notes, the version menu, the last receipt, and **Download**
(PDF, PPTX or DOCX) and **Upload a new version**. Text is edited in place on
the page; each commit is an `edit_deck` (or `edit_document`) operation and a
version with a one-line summary. Decks also have **Present**: full screen,
arrow keys, notes in a second window.
