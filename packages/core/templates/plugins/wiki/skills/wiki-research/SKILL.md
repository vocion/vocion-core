---
slug: wiki-research
name: Wiki research and planning
description: >-
  How to research a question for the workspace and land the standing part in
  the wiki: read the wiki first, then the knowledge index, the data rooms and
  the web; answer with sources; offer a page whenever a conversation produces
  a standing fact or a plan; write a plan page as options / decision / next
  steps; keep pages short; never duplicate a page the curator keeps. Read
  when asked to research, compare, plan, or "write this down".
version: 1
---

# Wiki research and planning

The wiki is long-term context the agents read before they act. Research is how
new standing facts arrive; a plan page is how a decision gets made in the open.
This skill is the researcher's, and any agent that has been asked to look
something up and keep it.

## Order of reading

1. **The wiki.** `/wiki/index.md` is mounted every turn with the pages that
   fit; `read_wiki_page` fetches the rest. If a page answers, cite it and
   stop — the person can check it in one move, and a second answer beside the
   wiki's is a duplicate waiting to happen.
2. **What the workspace has.** `search_knowledge` across the connected sources
   (wiki pages are in the index too), `list_data_rooms` + `read_data_room` for
   a client's own material, `get_learnings` for the rules that hold.
3. **The outside world.** `web_search`, then `fetch_url` on the result that
   matters; `crawl_site` only when a site is the subject. Prefer the primary
   source; note the date you read it.

## Answering

- Lead with the answer, then the sources in words ("the pricing page, read
  2026-09-20", "the Voice page, v3"), linked where there is a link.
- Anything dated carries its date. "I could not establish this" beats a guess.
- Less evidence produces a shorter answer, not a longer explanation.

## When to offer a page

Offer — do not silently write — whenever the conversation produces:

| It produced… | Offer… |
|---|---|
| a fact that will be true next month (who owns X, what we always do, a term we use our own way) | a dated section on the page that fits (**Who is who**, **Standing rules**, **Glossary**), or a revision of it |
| a decision a person took and did not walk back | a dated section on **Decisions** |
| a question with options and a recommendation | a **plan page**: `plan-<topic>` |
| research a person will need again | a **research page**: `research-<topic>` |
| what happened today, a transcript, a one-step rule | nothing — the ledger, the data room, a learning |

When the person says yes, or asked you to write in the first place, propose it
with `write_wiki_page` and say what happened: written (with the link, undoable
from Review › Decided) or queued for a person. Never claim a queued write.

## A plan page

Short. One plain paragraph saying what is being decided (it is the summary),
then:

```
## Options
One line each, with the trade-off and the source it rests on.

## Recommended decision
Which, and why — the reason a person can disagree with.

## Next steps
Owner · step · when. Three to five.

## Sources
Named, dated, linked.
```

When the decision is taken, the researcher appends the dated section to
**Decisions** and the plan page is left as the record of how it was reached;
the curator decides later whether the plan page still earns its place.

## Writing rules

- `slug` — reuse an existing slug to revise; `plan-…` / `research-…` for a
  new page. Never create a second **Voice**, **Standing rules**, **Who is
  who**, **Decisions** or **Glossary** — those are the curator's pages; you
  append to them or revise them.
- `md` — the whole page when rewriting; `append` — a dated section on a
  running page. No `#` title line; `##` headings; one idea per paragraph; no
  raw tool output; every claim with its source named in words.
- `summary` — the one line the index shows. Write it.
- `reason` — what changed and what you read to know it. The reviewer reads
  this first.
- `confidence` — 0.9 for a person's own words, 0.85 for a confirmed decision,
  0.6 for what you inferred or researched. The researcher's writes start at
  review and earn their way to running on their own (`trust.yaml`,
  `wiki.write_page.wiki-researcher`), so an honest number is what earns it.
