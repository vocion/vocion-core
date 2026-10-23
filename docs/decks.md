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
svg hr aside` (plus `thead tbody tfoot`, which every HTML parser inserts, and
the synonyms `strong em sup sub`; SVG children are allowed inside `<svg>`) and
three Vocion elements:

| Element | Attributes | Renders as |
|---|---|---|
| `<x-icon name="Lock">` | `name`, inline `width`/`height`/`color` | an inline SVG from Vocion's icon map (`libs/decks/icons.ts`) |
| `<x-shape kind="arrow-right">` | `kind`: `rect rounded ellipse diamond arrow-right arrow-left arrow-up arrow-down line`; inline `background`, `border` | an inline SVG filling the element's box |
| `<x-connector x1 y1 x2 y2>` | `head`: `end` (default) `start both none`; `route`: `straight` (default) `hv vh`; inline `color`, `border-width`, `border-style` | an SVG line in slide coordinates |

An unknown icon name, shape kind or element is an **audit failure that names
it**, never a silent blank: the runtime marks it `data-vocion-unknown` and
draws a dashed red box. What is never allowed in a slide — `<script>`,
`<style>`, frames, form fields, `on*` handlers, `javascript:` URLs, a slide that
is not exactly one `<section id>` matching its key, notes that are not one
trailing `<aside>` of at most 4,000 characters — refuses the write with a
sentence naming it (`libs/decks/slides.ts` `checkSlide`). Self-closed
`<x-icon …/>` is accepted and stored opened.

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
so the pane, the board and the agent's receipt all read the same facts. Its
shape (`deckVerificationSchema` in `libs/cards/specs.ts`): `{ at, slides,
pdfPages, pdf?, issues, reports, ok }`, each slide `{ id, n, label?,
overflowPx, clipped, smallText, belowFooter, elementCount, unknownElements,
unresolvedAssets, placeholders, hasNotes, image? }` — `image` is the served URL
of the slide's screenshot, the same field a document sheet carries. `issues`
are blocking and decide `ok`; `reports` (under the footer line, placeholders,
no notes, a skipped look) never do. The footer band is the pinned elements
(`position:absolute|fixed`) whose top is at or below y 920 and that are at
most 80px tall. The optional vision look reuses the document look
(`services/documents/look.ts`); its findings join `issues` as `look: slide N`.

A renderer that cannot launch still writes the version: the verification
carries the static audit (placeholders, notes, assets, unknown elements) and
an issue saying it was not rendered.

## Tools

| Tool | Arguments | Does |
|---|---|---|
| `render_deck` | `room_id?`, `title?`, `deck?` (`{title, order, slides, sections?, faces?}`) or `files?` (Vocion or Claude Slides v4 files), `assets?` (`{id: {url \| base64, name?}}`), `playbook?`, `folder?`, `look?` | Create a deck in a data room; render, audit, return the receipt |
| `read_deck` | `id?`, `slides?` (ids or 1-based numbers), `images?` | The index (one line per slide, assets), the last receipt and the red-team state; with `slides`, their HTML with notes |
| `edit_deck` | `id?`, `ops`, `assets?`, `change_summary`, `look?` | Operations, applied atomically as one version: `replace_slide{id,html}`, `insert_slide{html,after?}` (`after` omitted appends, `"^"` puts it first), `remove_slide{id}`, `move_slide{id,to}`, `replace_text{find,replace,slide?,all?}` (literal; exactly once in the named slide, or once across the deck, unless `all`), `set_notes{id,notes}`, `set_title{title}`, `set_asset{asset,value\|null}`. New images in `assets` are stored first and become `set_asset` ops |
| `verify_deck` | `id?`, `look?` (default true) | Re-render and re-audit, recorded as a system version; the red-team receipt stands |
| `export_deck_pdf` | `id?`, `asked_by_person?` | Print through the same export gate as `export_document_pdf` |
| `deck_checkout` / `deck_checkin` | below | The editor-neutral round trip. Also work for documents |
| `export_pptx` | `id?` | The deck as a PPTX file artifact beside it; returns its link and the version it was made from |
| `import_pptx` | `id?`, `file_id?` (an attachment's `file #N`; omitted = the latest `.pptx` attached in the conversation), `base_version?`, `tool?` | Bring an edited PPTX back as ONE new version; the receipt lists the per-slide report in plain words |
| `export_docx` | `id?` | The document as a DOCX file artifact beside it |
| `import_docx` | `id?`, `file_id?`, `base_version?` | Bring an edited DOCX back as ONE new version; the receipt lists edited and unplaced paragraphs |

All are in the single registry (`services/agents/tools/decks.ts` and
`deliverableAdapters.ts`, wired in `registry.ts`), so they reach every loop and
Vocion's MCP server like the document tools. `export_document_pdf` takes
`asked_by_person` too. The office tools are optional adapters: their
descriptions say what they do, and no core prompt or shipped skill tells an
agent to prefer them.

`red_team_document` and the export gate accept either kind. The red team reads
slide text **and** speaker notes; findings carry the slide number in the
stored finding's `sheet` field (one finding shape for both kinds). The gate
(`services/deliverables/exportGate.ts` + `gate.ts`) keeps its existing
behaviour and the "accelerate, never block" rule: it holds an agent's export on
a blocking finding, and when the agent says the person asked for the PDF in
their own words (`asked_by_person`), the PDF goes out with the first blocking
finding as one line of advice. `concept` and `case-study` join `proposal`,
`scope` and `partnership-update` in the default client-facing playbooks.

## Out and back

Vocion is the canonical copy. Every way out records where the deck went
(`origin`), and every way back is a new version, re-rendered and re-audited.

### MCP check-out and check-in (any assistant)

- `deck_checkout { id, format? }` returns the deliverable as files (for a
  deck: `deck.json` — format, title, order, sections, faces, playbook, and
  each asset's name, type and download link — plus `slides/<id>.html`, or a
  Claude Slides project with `format: "claude-slides"`; for a document:
  `document.html`), short-lived download URLs for its assets
  (`/api/deck-assets/<token>`, signed, one file, an hour), and `baseVersion`.
  It writes nothing.
- `deck_checkin { id, baseVersion, files, assets?, tool?, change_summary? }`
  writes a new version with `origin: {kind: 'checkout', tool?, baseVersion}`.
  New images arrive as URLs or base64; asset ids already on the deck are kept.
  **A stale `baseVersion` is refused** with a slide-by-slide (or
  sheet-by-sheet) diff of what changed in Vocion since the checkout, so the
  person can redo their change on top. Stale means the CONTENT changed: a
  version that only recorded a verify or a red-team read does not count.
  Files identical to the current version write nothing.
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

### Where an export is recorded

Every export (PDF, PPTX, DOCX) is filed beside the deliverable as a `file`
artifact on the same record (role `pdf`, `pptx` or `docx`) whose spec carries
`exportedFrom: { artifactId, version, format, at }`. That is where "it went out
as PPTX at v3" lives. The deck or document itself gets **no version** for an
export: a person downloading has not edited anything, and a version that only
says "downloaded" would be noise in the menu and a false staleness signal.
`origin` on the deliverable is written by the way BACK — `{ kind: 'import',
tool, baseVersion }` on the version an import writes (`tool` defaults to
`PPTX`), `{ kind: 'checkout', … }` on a check-in.

### The engine services (`services/deliverables/adapters.ts`)

- `exportDeckPptx({ orgId, id, author })` opens the deck with `openDeckPage`,
  runs `measureSlideLayouts` on that very page (images served from the file
  store go in as their own bytes), writes `deckToPptx`, always closes the page,
  and files the result. No renderer → a plain error, never a broken file.
- `importDeckPptx(orgId, id, buf, { baseVersion?, author, tool? })` checks the
  bytes, refuses a stale `baseVersion` with the slide diff (the same test as
  `deck_checkin`: content, not verify or red-team versions), merges with
  `pptxToDeck` against the deck as it stands, stores pictures from converted
  slides through `ingestDeckAssets`, and writes one version through
  `reviseDeck` (re-render, re-audit). A file that changes nothing writes
  nothing (`status: 'unchanged'`).
- `exportDocumentDocx` / `importDocumentDocx` the same for documents, through
  `reviseDocument`, against the author's HTML (the framework stripped and
  re-injected). Report: `{ kept, edited, unplaced }`; unplaced paragraphs are
  listed, never guessed in.
- The file's kind is read from the bytes (a zip holding
  `ppt/presentation.xml` or `word/document.xml`); a Word file sent to a deck is
  refused with a sentence, whatever its name. At most 50 MB.

### HTTP, for the pane

Both are authorised like `/api/artifacts/<id>` (`authApi`: a dashboard session
or a `vcn_live_` token, the caller's workspace, then the artifact's audience);
anything else is a 404. Errors are `{ ok: false, reason }`, `reason` one
sentence for a person.

- `GET /api/deliverables/<artifactId>/export?format=pdf|pptx|docx` streams the
  file (`Content-Disposition: attachment`, the title-based filename) and files
  it as above. `pdf` works for both kinds, `pptx` only for a deck, `docx` only
  for a document (400 otherwise). A PDF goes through the export gate as the
  person's own ask (`asked_by_person`): a client-facing version nobody has read
  is read as the buyer first, and a blocking finding comes back as advice in
  the `X-Vocion-Advice` header (URI-encoded), never as a refusal. 422 when it
  cannot be produced, with why.
- `POST /api/deliverables/<artifactId>/import`, multipart `file` (.pptx for a
  deck, .docx for a document) and optional `baseVersion` → `{ ok: true,
  version, changed, report, receipt }` (`report` is the adapter's own: the
  per-slide list for a deck, `{ kept, edited, unplaced }` for a document;
  `receipt` is plain lines). Refusals: 409 `{ ok: false, reason, diff,
  currentVersion }` for a stale `baseVersion`; 413 over 50 MB; 415 for the
  wrong kind of file; 422 when the merged result cannot be written.

## The pane

One deliverable pane for both kinds: page thumbnails, the selected slide or
sheet large, its notes, the version menu, the last receipt, and **Download**
(PDF, PPTX or DOCX) and **Upload a new version**. Text is edited in place on
the page; each commit is an `edit_deck` (or `edit_document`) operation and a
version with a one-line summary. Decks also have **Present**: full screen,
arrow keys, notes in a second window.

## Where things are (for the pane and the adapters)

- **Types**: `DeckSpec`, `deckSpecSchema`, `DeckVerification`,
  `DeckSlideAudit`, `DeckAsset` in `packages/core/src/libs/cards/specs.ts`.
  `slides[id]` is always a fragment whose root is `<section id="<id>">`.
- **Pure libs** (`libs/decks/`): `slides.ts` (check, text and notes,
  placeholders, asset refs, `withNotes`), `icons.ts` + generated `iconData.ts`
  (`packages/core/scripts/generate-deck-icons.mjs`), `runtime.ts`, `page.ts`
  (`buildDeckPage`), `audit.ts`, `edit.ts` (`applyDeckOps`), `diff.ts`
  (`diffDecks`, `diffDocuments`, `diffText`), `files.ts`, `claudeSlides.ts`,
  `outline.ts`, `assetLink.ts`.
- **A rendered deck in Playwright**: `openDeckPage(spec, { loadAsset,
  deviceScaleFactor })` in `libs/decks/render.ts` returns `{ page, blocked,
  close }` — the shared Chromium, 1920×1080 viewport, the runtime applied,
  fonts loaded. Each slide is `.vocion-slide[data-slide-id]` with its
  `<section>` inside; Vocion's generated SVG carries `data-vocion-generated`.
  The caller closes it. `deckAssetLoader(orgId, spec)` in `DeckEngine.ts`
  supplies `loadAsset`.
- **Engine** (`services/decks/DeckEngine.ts`): `createDeck`, `reviseDeck`
  (whole deck or ops, `ifVersion`), `verifyDeckArtifact`,
  `redTeamDeckArtifact`, `exportDeckPdf`, `verifyDeckSpec`,
  `ingestDeckAssets`, `deckReceipt`, `loadDeck`.
- **Assets** are stored with `storeImageAsset` (`services/deliverables/files.ts`)
  in the same file store `file` artifacts and screenshots use
  (`libs/tools/artifacts/store.ts`), served at `/api/artifacts/<id>/<file>`;
  the bytes are checked to be an image and a scripted SVG is refused. The
  renderer reads them from the store (`readStoredFile`), never over HTTP.
- **Check-out/check-in**: `services/deliverables/checkout.ts`.
- **Office adapters**: pure libraries in `libs/decks/pptx/` and
  `libs/documents/docx/` (each with a README of what round-trips and what is
  lossy), wired by `services/deliverables/adapters.ts`; tools in
  `services/agents/tools/deliverableAdapters.ts`; routes in
  `app/api/deliverables/[artifactId]/{export,import}/route.ts`. The layout pass
  finds each slide as the `<section>` inside `.vocion-slide[data-slide-id]`
  (falling back to `section#<id>` on a bare page), and a transparent section
  takes the frame's white, not the page backdrop.
- **Exports** are filed by `fileExport` (`services/deliverables/files.ts`) with
  `exportedFrom` on the file spec.
- **Card**: `libs/cards/firstParty/deck.tsx` with
  `features/dashboard/artifacts/DeckView.tsx` — the chat summary and a
  thumbnail grid from the verified screenshots, plus the PDF link.
