---
slug: designing-a-surface
name: Designing a surface
description: >-
  The standard every page in this product is held to. Index pages display
  decisions and meaning; detail pages display records and evidence. A missing
  optional capability makes the interface smaller, not fuller. And each of the
  four surfaces answers one question and refuses the other three: Products
  what we operate, Work what we are doing about it, Releases what reached
  people, Review only decisions. Read before writing, planning or reviewing
  any page, panel, column or empty state.
version: 1
---

# Designing a surface

This playbook exists because the same correction has now been made three
times, on Products, on Work and on the work item, in the same words. A standard
that has to be re-derived per page is not a standard. This is the written
form, and the skills that write and review a page are attached to it.

The governing document these rules serve is
`docs/design/PRODUCT-PHILOSOPHY.md` in `Meta-CTO/metacto-vocion-agents`, with
one spec per surface beside it (`FACTORY-PAGE-SPEC.md`, `PRODUCTS-PAGE-SPEC.md`,
`WORK-PAGE-SPEC.md`, `REVIEW-SPEC.md`, `PERFORMANCE-SPEC.md`,
`ACTIVITY-SPEC.md`, `IA-SPEC.md`, `EVIDENCE-SPEC.md`). They are not copied
here. Read them when a judgement call is not settled below, and change them
there, once, when the standard itself changes. In this repository,
`docs/DESIGN-PRINCIPLES.md` and `docs/design/reduction.md` are the
engineering-side statement of the same values.

## 1. Index pages display decisions and meaning. Detail pages display records and evidence

An index answers "what should I do, and why". A detail page answers "prove
it". A page that leads with a record's fields has made the reader do the
interpretation the system was supposed to do first.

The tell is a column that only makes sense if you know the schema: `state:
triaged`, `recommendationState: proposed`, `manual_toil`, `sizeClass: major`,
a priority integer. None of those are decisions or meanings. They are the
material a decision is derived FROM, and the derivation belongs in code, once,
not in the reader's head, every time.

**In practice.** Lead with the sentence, not the field. Collapse a state
machine into the handful of states a person actually manages, and keep the
internal states underneath where the system needs them. Say "waiting on you
to decide whether to build" rather than showing four columns that together
imply it. Put the evidence, the history, the runs, the checks and the
forensics one click deeper, on the record's own page, and make the row itself
that click rather than adding an affordance beside it.

## 2. A missing optional capability makes the interface smaller, not fuller

A column of dashes does not report that a figure is zero. It advertises, once
per row, that we never recorded it, in the width a fact could have used.

**In practice.** A field no row can fill is not drawn (`hideWhenEmpty` on a
page field, on by default). A field every row answers identically is said once
above the table, not once per row (`hideWhenConstant`). A genuine gap, the
kind that should be fixed rather than hidden, is surfaced ONCE, as one line in
the place it matters, never sprayed through every row. "Not recorded" is never
a cell.

The property this protects: **a maturing workspace should look quieter, not
busier.** As autonomy improves, Review shrinks, warnings become rare,
missing-data messages disappear and Work gets shorter. The interface itself
should communicate increasing competence.

## 3. Each surface answers one question and refuses the other three

| surface | the question it answers |
|---|---|
| Products | what we operate, and how it is doing |
| Work | what we are doing about it, and what is waiting on me |
| Releases | what reached people, and who has been told |
| Review | what only a person can decide, and nothing else |

The filter every page and every element on it passes before it ships: **can a
product exec make a decision or get value from this?** A panel that explains
the machine — runs, leases, heartbeats, spend per attempt — fails it and lives
inside the record, not on a page. Performance and reporting return when use
demands them, not before (2026-09-24).

A surface that starts answering a second question is how two pages become
four views of one thing. When a fact seems to belong on two surfaces, it
belongs on the one whose question it answers, and the other one links.

Work and Review are the case worth stating outright, because it looks like a
conflict and is not: **Work owns the work state, Review owns the decision
interaction.** Work must show that an outcome is stopped on a person, because
that is what is happening to the work. The decision itself is still taken in
Review, one batch at a time.

## What fails review

A page, panel or column change is returned when:

- a column, badge or heading renders a stored code, state name or priority
  integer that a person would have to learn the schema to read;
- a field is drawn that no visible row can fill, or a cell reads "not
  recorded", or the same missing fact is reported on more than one row;
- an index page shows evidence (runs, attempts, internal counters, process
  metrics such as tasks written) that answers "prove it" rather than "what
  should I do";
- a queue is presented as ordered without a visible order, or ranks work the
  system has no recorded reason for;
- a row carries a second affordance that opens the same thing the row opens;
- a fact appears on a surface whose question it does not answer, instead of a
  link to the surface that owns it;
- the change adds a second mechanism for something the platform already does
  once (a rule that is real is closed generically, in the page layer, rather
  than locally on one screen).

## How to apply it

Design the reading first, in sentences, as if a person were telling you what
is going on. Then ask which of those sentences the records can support. Then
derive them, once, in code that a test can argue with, and let the page
declare the reading rather than the schema. The test for any screen: what
decision or understanding does this page give a person that they did not have
before, what is the minimum information required to give them that, and can
every other detail move one click deeper?
