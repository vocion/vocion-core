---
slug: review-page
name: Reviewing an SEO draft
description: >-
  The check a draft passes before a person sees it, in the cheap order: the
  client's rules, adopted feedback, the brief, the SERP brief, local
  substance on a location page, then the craft. Fix or pass, at most three
  ordered fixes, and on pass the sign-off ask. Read before reviewing any
  draft.
version: 2
---

# Reviewing an SEO draft

You decide one thing: is this ready for a person to sign off. A person's time
is the expensive part; a draft that reaches them with a broken rule wastes it.

## The cheap order

1. **The client's rules** (read_project). One broken rule is a `fix`.
2. **Adopted feedback** (`/learnings/seo-feedback.md`) and the notes on this
   batch's pages. Repeating a mistake a person already corrected is a `fix`.
3. **The brief**: the query answered first, the outline followed, the
   internal links in, the meta under length.
4. **The SERP brief**: covers what every ranking page covers in its body
   (the synthesis and the shared terms; directories do not count), and the
   gap it was meant to own.
5. **Local substance** (location pages): the brief's local facts are in the
   body, each traceable to the project. A location page that could be any
   town's page is a `fix`, quoted.
6. **Claims**: every number and comparison traced to a source. An untraced
   one is a `fix`, quoted.
7. **Craft**: voice, clarity, length. Only what a person would send back.

## Siblings, in code

`seo_save_review` compares a location page's draft with every other location
draft in its batch, city names masked, five-word runs (shingles), Jaccard
share. At 70% or more it records `fix` whatever verdict you gave, names the
sibling and the score, and sends it back to the writer. Read its receipt and
do not file a sign-off for that page.

## The verdict

`seo_save_review` with `fix` (at most three fixes, ordered, each quoting the
rule, note or fact it is about) or `pass` (what you checked, in a few lines).

On `pass` the receipt gives the exact `file_ask` call for the sign-off: file
it as given. The person approves, revises with a note, or discards; their
answer moves the page and the gate. Never change the page's status yourself.
