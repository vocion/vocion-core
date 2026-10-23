# PPTX adapter

Pure library modules for the "Out and back" PPTX section of `docs/decks.md`.
No tools, no services; the engine calls these.

| File | What it does |
| --- | --- |
| `layout.ts` | `measureSlideLayouts(page, slideIds)` walks a rendered deck (one `section#<id>` per slide at 1920 x 1080) and returns `SlideLayout[]`: native objects plus PNG rasters, taken at 2x. |
| `export.ts` | `deckToPptx({ deck, layouts })` writes the PPTX with pptxgenjs (13.333 x 7.5 in, 144 px per inch, 1 px of font = 0.5 pt). |
| `import.ts` | `pptxToDeck(buf, base)` merges an edited file into the deck and returns `{ deck, newAssets, report }`. |
| `htmlText.ts`, `shared.ts`, `xml.ts` | Text splicing into HTML by source offset, object names and the notes marker, and a small XML reader. `docx/` reuses them. |

## How a slide is recognised

Two independent signals, either is enough:

1. **Object names**: `vocion:<slideId>:<path>` on every object, where `<path>` is the dotted
   child-index path from the slide's `<section>` (`0.2.1`). Extra objects of one element get
   `~bg` (its box), `~bt/br/bb/bl` (uneven borders) or `~anonN` (loose text beside blocks).
2. **A marker at the end of the slide's notes**:
   `[[vocion:v1 id=<slideId> n=<notesHash> t=<path>:<hash>,... o=<otherNames>]]`. It holds the
   hash of each text object as exported, so the importer knows what the person changed without
   re-rendering, and the names of every other object, so a deleted object is noticed.

The marker lives in the notes because PowerPoint, Keynote and Google Slides all keep speaker
notes, and none of them reliably keeps custom XML parts or shape names. The importer strips the
marker before the notes go back into the `<aside>`. A slide with neither signal is new.

## What round-trips

Lossless (the slide's HTML comes back byte-for-byte):

- A slide whose text and notes were not edited.
- Slide order and slide deletion (the file wins; the report says `moved` and `removed`).

Merged into the original HTML:

- **Edited text** in a text box that still carries its name. Only the changed span is
  rewritten: if the change sits inside one text node the surrounding `<b>`, `<i>`, `<span>` and
  `<a>` stay; if it spans nodes or adds a line break the element's content becomes plain text.
  Prefix and suffix are matched case-insensitively, so a `text-transform: uppercase` heading
  does not read as rewritten.
- **Edited notes** (replace the `<aside>` content).

Converted (`status: converted` / `added`), because the structure no longer matches the HTML:

- A recognised slide where an object was deleted or a new one added.
- Any slide with no marker and no names (Google Slides can drop both): all of it is imported as
  a new `imported-N` slide and the original is reported `removed`.
- Conversion produces absolutely positioned HTML: one `<p>` per text box (first run's font,
  size, weight, colour; other runs as `<span>`), `<div>` for filled shapes, `<img src="asset:<key>">`
  for pictures (bytes returned in `newAssets`), `<table>` for tables, notes as `<aside>`.

## What is lossy

- **Rasterised on export**: `svg`, `canvas`, `x-icon`, `x-shape`, `x-connector`, and any
  element with a gradient, background image, `box-shadow`, `filter`, `clip-path` or
  `backdrop-filter` (that element's own box only; its text stays native on top). The picture
  is isolated (nothing else on the page) and transparent. These are not editable in PowerPoint
  and an edit to them does not come back.
- **Images** with rounded corners, `object-fit` crops, filters or non-PNG/JPEG sources are
  rasterised as PNG too; plain PNG/JPEG data URIs go in as the original bytes.
- **Not applied on import for a recognised slide**: moved or resized objects, font, size and
  colour changes, new shapes (these convert the slide instead), table structure.
- **Text approximations**: the browser's line wrapping and the font that PowerPoint actually
  has can differ (fonts are named, not embedded); line spacing is exact points from the CSS
  line height; letter spacing and alignment are kept; vertical centring inside a taller box is
  by box placement, not by anchor; list markers are native bullets/numbers with an indent.
- **Opacity** below 1 is applied to fills only, not to text.
- **Z-order** is DOM order; `z-index` is ignored.
- Colours in non-sRGB spaces are converted to sRGB through a canvas.
- Loose text next to block siblings is exported (`~anonN`) but not editable on the way back.
