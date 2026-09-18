---
slug: wiki-curation
name: Wiki curation
description: >-
  How the workspace wiki is kept: what belongs on which page, what does not
  belong at all, how to write a page (whole or a dated section) with an honest
  confidence, how to merge duplicates and prune the unread, and how to start a
  wiki from what the workspace already knows. Read on every curation check and
  whenever you are about to create a page.
version: 1
---

# Wiki curation

The wiki is the workspace's **long-term memory**: what changes slowly and has to
be true every time an agent acts. Kept **true, small and read**.

## What belongs where

| It is… | It goes to… | Not to… |
|---|---|---|
| How we sound, what we never say, the signature block | **Voice** (`voice`) | a learning per phrase |
| A rule that holds across the workspace — "never promise a business outcome", "file client calls in the room, internal calls in the wiki" | **Standing rules** (`standing-rules`) | a data room's rules (those are one room's) |
| Who owns what — agents, teams, the accountable humans, partners and their roles | **Who is who** (`who-is-who`) | a CRM record |
| A decision a person made and did not walk back, dated | **Decisions** (`decisions`, append a dated section) | the activity ledger |
| A term the workspace uses its own way | **Glossary** (`glossary`, append) | prose in another page |
| What happened this week | the activity ledger, a briefing | the wiki |
| A rule for one step ("always CC the AE on…") | a learning (`add_learning`) | the wiki |
| A client's transcripts, decisions, notes | that client's data room | the wiki |

A new page is right only when none of these fits **and** the fact will be read
again. Nine weeks of a hand-run wiki taught this: pages written once and never
read again were most of the wiki, and the ledgers nobody appended to died in a
week.

## Writing a page

`write_wiki_page` with:

- `slug` — reuse the existing one to revise; one of the five above unless a new
  page is right.
- `md` — the **whole** page, when you are rewriting. Short. Headings for the
  eye, one idea per paragraph, no raw tool output, every dated thing with its
  date, every claim you took from a source with the source named in words.
- `append` — a **dated section** on a running page (Decisions, Glossary):
  `heading` is the decision or the term, `body` is two or three sentences.
- `summary` — the one line the index shows. Write it; the first paragraph is
  the fallback.
- `reason` — what changed and what you read to know it. This is the version's
  change summary; a person reads it back in the history.
- `confidence` — honest. A correction a person made in their own words: 0.9.
  A decision a person took and confirmed: 0.85. A pattern you inferred from
  two or three signals: 0.6. Removing a page: 0.4 (a person decides).

Above the bar the page is written at once and shows in Review › Decided with
Undo; below it a card carries the page and a person decides. Never claim a
queued write was made.

## Merging and pruning

- Two pages saying one thing → rewrite the one with the better slug to carry
  both, then propose the other's removal (low confidence) with the reason
  "merged into `<slug>`".
- A page whose claim a person contradicted → fix the claim; say in `reason`
  who said what and when.
- A page nobody has read — not mounted (it did not fit), not cited in a turn,
  not linked from another page — for a month → propose its removal at 0.4.

## Starting an empty wiki

Four pages, from what the workspace already knows, each short with a summary:

1. **Voice** — from `get_brand`: the voice rules and the banned phrases, as
   prose a writer can follow.
2. **Standing rules** — the trust rules a person set (what runs on its own,
   what asks) and the learnings that hold across agents.
3. **Who is who** — the agents and their teams, the accountable humans, who
   leads what.
4. **Decisions** — one dated section: "Wiki started", who asked, what it is for.

Then stop. The wiki grows through use.

## The receipt

Report every check in five lines: written (page, version, confidence), queued
(page, why under the bar), merged, left alone and why, what you could not
establish. Each line names its source.
