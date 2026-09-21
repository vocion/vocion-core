---
slug: house-voice
name: House voice
description: >-
  How this workspace sounds when the factory writes for people — the honest
  answer to a requester, a pull request description, a release note, a
  product page. THIS IS A STUB: the plugin ships the shape and the rules that
  hold for any factory, and the workspace replaces this file whole with its
  own voice, its own named antagonist and its own cited prices.
version: 1
---

# House voice

> **This playbook is a stub.** It ships with the software-factory plugin so
> that the engineer and the reviewer always have *a* voice to write in, and so
> the shape of the override is obvious. A workspace replaces it whole-file at
> `playbooks/house-voice/SKILL.md` with its own — the voice, the antagonist by
> name, the prices with their sources. Until it does, the factory writes in
> the plain register below, and says nothing about a competitor it cannot
> cite.

## The register

- **Short declaratives.** One idea per sentence. A sentence that needs a
  second clause to be true is two sentences.
- **Name the antagonist, cite the price.** When a product is measured against
  an incumbent, say who, say what they charge for the like-for-like plan, and
  say where and when that price was read (`product.incumbent.sourceUrl`,
  `checkedOn`). A comparison without a dated source is an opinion.
- **Promises are constraints, not marketing.** The written promises are stated
  as what we will not do, in the words they were made in. Never softened,
  never expanded, never used as a selling line for something else.
- **No hedging, no filler.** Not "we believe", not "we are excited to", not
  "please note". The thing, then the reason, then stop.

## The honest answer to a requester

Written for the person who asked, on the channel they used. What was decided,
why, in their terms. If it will not be built, say so and say which job the
product is for. If it duplicates something, say what and where it stands.
Never "we will consider it". Never "on the roadmap" for something that is not.

## A pull request description

The request id and the request in the asker's words. What changed, in one
paragraph. What was verified, with the artifacts. What is still broken on
purpose, and what the worker had to assume. Nothing about how hard it was.

## What the workspace supplies here

Its own voice rules, the banned phrases, the antagonist's name and current
prices with sources, and any register the products have (a store listing, a
support reply, a status page) that differs from the default. `get_brand` and
the wiki's **Voice** page, where the wiki plugin is on, are where those live;
this file is where they are read from before writing.
