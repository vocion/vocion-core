# DOCX adapter

Pure library modules for the "Out and back" DOCX section of `docs/decks.md`. Reuses
`decks/pptx/htmlText.ts` (splicing text into HTML by source offset) and `xml.ts`.

| File | What it does |
| --- | --- |
| `blocks.ts` | What counts as a paragraph (leaf text blocks inside each `.sheet`), their `<sheet>`/`<path>` identity and bookmark names. Export and import both read it. |
| `export.ts` | `documentToDocx({ html, title })` writes the DOCX with `docx`. |
| `import.ts` | `docxToDocument(buf, baseHtml)` returns `{ html, report: { kept, edited, unplaced } }`. |

## Identity

Each paragraph is wrapped in a bookmark `vocion_<sheet>_<path>`, sheet 1-based, path the
child-index path from the sheet element with `_` for `.` (`vocion_2_0_2_1_1_0`). Word limits
bookmark names to 40 characters, so a longer one is written as `vocion_<sheet>_h<12 hex of sha1(path)>`;
the importer accepts both forms.

On import a paragraph is placed by bookmark first. A paragraph with no usable bookmark
(Google Docs and Pages drop them) is matched to an unclaimed base paragraph by exact text, then
by similarity (1 minus normalised Levenshtein, case-insensitive, 0.8 or better, best pairs
first). Anything else is listed in `report.unplaced` and never inserted. A bookmarked paragraph
that was emptied is left as it was (clearing text is not read as a delete).

## What round-trips

- **Text** of headings, paragraphs, list items, table cells and text `div`s. An edit rewrites
  only the changed span; inside one text node the `<b>`/`<i>`/`<a>` around it stay, across nodes the
  element becomes plain text. Tracked deletions are ignored, tracked insertions are read.
- Everything not edited is untouched: the importer splices into the original string.

## What is mapped one way only

- Sheets become Word sections (a new Letter page each, 0.75 in margins). Page geometry,
  the pinned footer (`.foot`) and page numbers are Word's to do, not exported.
- `h1`-`h6` become Heading 1-6; `ul`/`ol` become bullets and numbering (one numbering
  instance per `ol`); tables become tables (header cells bold, `colspan` kept); links, bold,
  italic, underline, strike, super/subscript, `code` font and inline `style="color:#..."` are
  kept as run formatting.
- Colours and fonts from CSS classes are not read (no computed styles in a pure module), so
  class-driven styling is not in the DOCX. Layout in the DOCX is Word's flow, not the sheet's.

## What is lost

- Images: PNG/JPEG/GIF data URIs go in inline (scaled to the 6.5 in text width); other images
  (SVG, remote URLs) become an italic `[image: alt]` line or are dropped when they have no alt.
  Image edits never come back.
- Inline SVG, `script`, `style`.
- Text sitting directly beside block children (for example a list item's own text before a
  nested list) is not a paragraph and is not exported.
- Added, deleted, split or merged paragraphs in Word cannot be placed into a sheet and are
  reported as `unplaced` (a split-off second half) or left as is (a deleted paragraph).
