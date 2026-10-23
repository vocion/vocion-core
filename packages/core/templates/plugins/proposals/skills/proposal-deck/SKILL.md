---
slug: proposal-deck
name: Proposal deck
description: >-
  Write, revise and verify a 16:9 client deck — a proposal, a concept, a case
  study — as a vocion-deck/1 artifact, grounded in the client's data room. Read
  before the first slide and again before changing one: it carries the slide
  format, the render → read the receipt → fix → verify loop, the red team, and
  how a workspace supplies its own slide library and house rules.
version: 1
---

# Proposal deck

A deck is what a client sees in the meeting; the document is what they carry
into their own business case. Both are deliverables, both are written from the
room, and both are not done until the receipt reads clean. Use a deck when the
person asked for slides, a presentation, a pitch or a walkthrough; use the
`proposal-document` skill when they asked for something to read and sign.

## The format (`vocion-deck/1`)

- A deck is `{ title, order, slides, sections?, faces? }`. `order` is the slide
  ids in deck order; `slides[id]` is **exactly one**
  `<section id="<id>" style="…">…</section>`. The title is also the PDF
  filename.
- Every slide is a fixed **1920×1080 px** canvas. All styling is **inline**:
  the section sets `background`, `font-family`, `color` and its layout
  (`display:flex|grid`, `padding`, `gap`). Children flow inside it;
  `position:absolute` pins a child to the slide, and later children paint over
  earlier ones.
- Elements: `h1 h2 h3 p ul ol li br b i u a span div img table tr th td svg
  hr aside`, plus three of Vocion's own:
  - `<x-icon name="Lock" style="width:96px;height:96px;color:#1C6D69">` — an
    icon from Vocion's map (Check, CheckCircle, Lock, Users, Verified, Chart,
    Clock, Globe, Chat, Star, Send, Link, Lightning, Cloud, Wrench, Search,
    Lightbulb, GraduationCap, Database, Code, Activity, Arrow*, Calendar, Mail,
    File, Folder, Shield, Settings, Target, TrendingUp, Dollar, Building,
    Truck, Phone, Map, Flag, Sparkle, Eye, Heart, Gauge, Layers, Cpu, Server,
    Bot, Inbox, Trophy, Rocket, Handshake, Briefcase, Receipt, Calculator,
    Clipboard, ListChecks and more; names are case-insensitive).
  - `<x-shape kind="arrow-right" style="width:300px;height:120px;background:…;border:4px solid …">`
    — `rect rounded ellipse diamond arrow-right arrow-left arrow-up arrow-down
    line`, styled like any box; text inside it sits on top.
  - `<x-connector x1="200" y1="700" x2="900" y2="900" route="hv" head="end" style="color:…;border-width:4px;border-style:dashed">`
    — a line in SLIDE coordinates, `route` straight | hv | vh, `head`
    end | start | both | none.
- **Images are assets**: `src="asset:<id>"`, with the bytes passed once in
  `assets` (`{ "<id>": { url | base64 } }`) on `render_deck` or `edit_deck`.
  A `data:` URI or a remote URL in a slide fails the asset audit.
- **Speaker notes** are plain text in ONE `<aside>`, the section's last child,
  up to 4,000 characters. **The notes carry provenance**: who said it, on which
  call and date, which figures are drafts, what is illustrative.
- Fonts: `faces` with Google Fonts css2 links; anything else falls back.
- No `<style>`, no scripts, no event handlers, no forms. An unknown element,
  icon name or shape kind is named in the receipt, never silently blank.

## Rules for every slide

- **One idea per slide.** If the title needs "and", it is two slides.
- **Text at 24px or larger.** The audit fails anything smaller. Cut words; do
  not shrink them.
- **Nothing below y 920** except the footer band: pinned elements whose top is
  at or below 920 and that are at most 80px tall (a page number, the client
  and the seller). The receipt lists anything else there.
- **Never invent a number.** A figure nobody gave you is a placeholder —
  `[$__]`, `[__]`, `[date]` — in the open, with a note saying what would fill
  it, and an open item on the room. The receipt lists every placeholder so
  none ships by accident.
- **The client's words are the spine**: their names for their products,
  stages and teams; a pull-quote is something they said, attributed and dated
  in the notes.
- Under 200 elements per slide; a slide that needs more is two slides or one
  picture.

## The loop

1. **Read the data room** (`read_data_room`). The starred sources are what you
   write from. Draft the slide list first — one line per slide, its one idea.
2. **Read your house rules**: your learnings (`/learnings/proposal-feedback.md`),
   the workspace's slide library and playbook if it has them (below), and
   `get_brand` for palette, fonts and logos.
3. **Build small**: `render_deck` with `room_id` and the first two or three
   slides, then `edit_deck` with `insert_slide` ops a few slides at a time. A
   whole deck in one call runs into the output cap.
4. **Read the receipt** after every write. It names, by slide: content past
   the canvas, text under 24px, content under the footer line, unknown
   elements, unresolved assets, placeholders and missing notes, with a
   screenshot URL per slide. Look at a screenshot you doubt.
5. **Fix by slide**: `read_deck({ slides: ["<id>"] })`, then `replace_slide`,
   `replace_text` (literal, must match once), `set_notes`, `move_slide`,
   `remove_slide`. Usually two or three rounds.
6. **Verify**: `verify_deck` with the look. The receipt must read "no issues";
   what remains in the notes list is a judgement you can explain.
7. **Red team**: `red_team_document` on the deck, with the house rubric and
   the room's facts as `context`. It reads every slide's text AND its notes.
   Fix every BLOCK by slide and run it again.
8. **Export**: `export_deck_pdf` — one 1920×1080 page per slide. A
   client-facing deck (playbook `proposal`, `concept`, `case-study`, or
   whatever the workspace gates) is read as the buyer on the way out if you
   have not; a block holds your export. When the person asked for the PDF
   themselves, pass `asked_by_person` and they get it with one line of advice.

Change the open deck in place. "Cut slide 6", "make it three phases", "move the
quote up front" are `edit_deck` ops; never render a second deck to change one.

## Out and back

When a person wants to edit elsewhere, `deck_checkout` gives the deck as files
(or as a Claude Slides project with `format: "claude-slides"`) and a
`baseVersion`; `deck_checkin` brings the edit back as a new version and the
loop runs on it. A check-in against a stale version is refused with the
slide-by-slide diff — redo the change on top, never force it.

## Your workspace's own library and house rules

This skill is generic. A workspace makes it its own without a core change:

- **Slide library**: put reusable slides — a cover, an about-us, a team, a
  method, a case study — in the workspace as a deck artifact or as files in
  its own `skills/proposal-deck/` folder (a whole-file override of this skill,
  with the slides as resources). Read the library slide, change it for this
  client, and `insert_slide` it; keep its notes' provenance.
- **House playbook**: the workspace's playbook (structure, pricing shape,
  voice) and its `brand.yaml` win over this skill where they disagree.
- **House rubric for the red team**: pass it as `rubric` to
  `red_team_document`, so the read applies your rules as well as the generic
  buyer's.
- **Which decks are gated**: `defaults.clientFacingPlaybooks` in
  `workspace.yaml`; tag each deck with its `playbook`.

## Learn from every correction

When a person cuts a slide, rejects a shape or corrects a claim, ask whether it
would apply to the next client's deck. If yes, it is a rule: `add_learning`
into `proposal-feedback` with their words as the source. A red-team finding
that appears on a second deck is a rule the same way.
