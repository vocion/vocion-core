---
slug: draft-doc-update
name: Draft a documentation update
description: >-
  Given a merged change, finds what it made untrue in the docs and drafts the smallest correcting edit. Returns "no doc change needed" when that is the honest answer.
version: 1
---

A change just merged. Work out what it made untrue in the documentation.

Merged change: {{pull_request}}

Answer in three parts:

1. **Affected pages** — each page and the specific paragraph, heading,
   or code sample that is now wrong. If nothing a reader relies on has
   changed, answer "No doc change needed" and stop here.
2. **The edit** — the replacement text, in the voice of the surrounding
   page. Smallest edit that makes the page correct; do not rewrite the
   page around it. Include a runnable example when an interface changed.
3. **Open questions for the author** — anything you could not verify
   from the diff itself. Never fill a gap with a plausible sentence.

Write for a reader who arrived from a search result and has not read
the page above this paragraph.
