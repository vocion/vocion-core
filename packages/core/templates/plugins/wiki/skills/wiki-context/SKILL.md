---
slug: wiki-context
name: Using the wiki
description: >-
  How any agent uses the workspace wiki as context: read the relevant page
  before acting on a standing fact (voice, rules, who is who, decisions), cite
  it, and write back when a durable fact is learned or a person corrects a
  standing one. Read when a task touches how we sound, what we always or never
  do, who owns something, or what was decided.
version: 1
---

# Using the wiki

The wiki is long-term context: the voice, the standing rules, who is who, the
decisions that hold. It is mounted for you every turn — `/wiki/index.md` lists
the pages with a one-line summary each; the pages that fit are at
`/wiki/<slug>.md`; `read_wiki_page` fetches one that did not.

## Before you act

- Writing anything a person will send or read → read **Voice** first.
- About to do something the workspace may have a rule about (send, file,
  promise, name a client) → read **Standing rules**.
- Naming who owns, leads or decides → read **Who is who**.
- Acting on "what did we decide about…" → read **Decisions**; the newest dated
  section wins.

Cite the page when a standing fact you state came from it — the receipt line
carries its link, so a person can check in one move.

## When you learn something

A fact that will be true next month too — not what happened today — goes back
to the wiki with `write_wiki_page`:

- A person corrects a standing fact ("we say *the client's team*, never
  *their team*") → revise **Voice** or **Standing rules**; confidence 0.9,
  `reason` quotes them.
- A person decides something and does not walk it back → `append` a dated
  section to **Decisions**; confidence 0.85.
- You notice the same correction across conversations → `append` or revise at
  0.6 so a person confirms it.

Above the bar the page is written at once (undo is one click for a person);
below it a card carries the change and a person decides. Never say a queued
write was made. A rule for one step is a learning (`add_learning`), not a page;
a client's material is its data room, not a page.
