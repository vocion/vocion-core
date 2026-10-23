# Vocion design system

The one place to start. Everything visual about Vocion is decided here or in a
page this index links to; a component's code points back to the page that
explains it. When a rule changes, change it here first, in the same PR as the
code.

## The 60-second version

- **A calm app with an agent that comes alive.** The chrome is warm paper,
  ink and hairlines. Colour has one job: the **spark** (the mark's violet,
  indigo, blue and teal) appears only while an agent is working. See [the spark](./foundations/spark.md).
- **One surface.** The page and the sidebar are the same warm paper, split by
  a hairline. Hairlines, not boxes; a bordered surface never holds another.
- **One primary.** Each screen has one ink primary action (`Button`, default
  variant). Everything else is outline, ghost or text.
- **One shape per job.** One agent mark (`AgentDot`), one chip, one notice, one
  count, one popover surface, one icon button, one close button. Two shapes
  doing the same job is a defect (principle 6).
- **Amber means four things only:** the Org's brand, links, the focus ring,
  and *something waits on a person*. Never "AI", never decoration.
- **Status has names.** `pass`, `warn`, `fail`, `waiting`, each with a dark
  value. Never a raw palette hue.
- **Motion says what changed.** A turn fades in, the spark blooms over an agent
  that starts working and settles when it stops, a changed region washes
  once. Reduced motion keeps the meaning and drops the movement.
- **Light, dark or system,** one click under your initials; System by default.

## Where everything lives

| Topic | Page |
|---|---|
| Why: values, the thirteen principles and the five-question test | [`../DESIGN-PRINCIPLES.md`](../DESIGN-PRINCIPLES.md) |
| Product method: the reduction pass, mapping onto the nouns we have | [`reduction.md`](./reduction.md) |
| Colour: tokens, status, amber's meanings, tints, charts, dark mode | [`foundations/colour.md`](./foundations/colour.md) |
| The spark: the AI colour and where it may appear | [`foundations/spark.md`](./foundations/spark.md) |
| Type, shape, elevation and icons | [`foundations/type-shape-icons.md`](./foundations/type-shape-icons.md) |
| Motion | [`foundations/motion.md`](./foundations/motion.md) |
| Components: the one component per job, and what it replaced | [`components.md`](./components.md) |
| Page archetypes (List, Detail, Ledger, Front doors), the "Never" rules, staying in place, the artifact header, the decision card, the composer | [`patterns.md`](./patterns.md) |
| The chat surface (§ numbers are cited from code) | [`../agent-chat-surface.md`](../agent-chat-surface.md) |
| Workspace pages (manifest archetypes) | [`../workspace-pages.md`](../workspace-pages.md) |
| Org branding: logo, accent, fonts | [`../guides/branding.md`](../guides/branding.md) |
| Agent output voice | [`../guides/voice-rules.md`](../guides/voice-rules.md) |

`patterns.md` is long and will be split into `patterns/*` pages; until then it
stays the home of the archetypes and the interaction rules.

## The airy pass (B-034b)

About twenty code comments cite "B-034b §1–§4", a spec from September 2026
that is no longer in the repo. These are its rules, restored so the citations
resolve.

- **§1 Type.** One humanist sans (Inter) for the app: the display face
  collapses onto the body face; page titles 20px/600 with tight tracking.
  Outfit stays on the marketing site and the empty chat's greeting.
- **§2 Quiet controls.** Buttons are ghost by default in spirit: the one
  primary is ink, secondaries are hairline outlines, the rest is text. Fields
  are a soft grey with no border and no shadow; focus is a ring. Badges and
  labels have no solid fills. A dashboard section is not a card. Outline icons
  at 1.5 stroke.
- **§3 The shell.** A 56px icon rail, 13px nav rows (h-9) with 16px icons, the
  sidebar collapsing to the rail, breadcrumbs as workspace › section ›
  record, page gutters 24px to 40px with 32px vertical rhythm, and the command
  palette to jump anywhere.
- **§4 No fills for emphasis.** Heroes and stat rows lose their tints and
  coloured borders: numbers sit in a row between hairlines; an outlined mark,
  not a solid one; the accent, if any, stays in the icon tile.

## How a rule gets added

A rule earns a place here the second time the same correction comes back. Write
it as the rule plus where it came from (who, when, what broke), put a
component or token behind it where one can enforce it, and link the code to it
with a one-line pointer. A rule with no component behind it is a note.
