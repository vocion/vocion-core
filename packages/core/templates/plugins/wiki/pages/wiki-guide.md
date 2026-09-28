# How the wiki works

The wiki is the workspace's **long-term memory**: what changes slowly and has
to be true every time an agent acts.

## What belongs here

- **Voice** — how we sound, what we never say, the signature block.
- **Standing rules** — what holds across the workspace: what runs on its own,
  what asks, what we never promise.
- **Who is who** — agents, teams, accountable humans, partners and their roles.
- **Decisions** — a dated section per decision a person made and did not walk
  back.
- **Glossary** — the terms we use our own way.

What does **not**: what happened today (the activity ledger has it), a rule for
one step (a learning), a client's material (its data room).

## Who writes it

The agents. Any agent that learns a durable fact, or is corrected on a standing
one, writes the page with a confidence. Above the bar the page is written at
once and shows in **Review › Decided** with Undo; below it a card carries the
change and you decide. The **Wiki researcher** answers first — ask it anything,
in chat or over MCP; it reads the wiki, then the knowledge index and the web,
answers with sources, and offers the page whenever the conversation settles a
standing fact or a plan. Its pages go through review until it has earned its
way. The **Wiki curator** runs every Friday: it consolidates the week's
learnings, decisions and corrections, merges pages that say one thing, and
proposes removing what nobody reads.

The repo can start it. Pages under `wiki/<slug>.md` in the workspace folder
are seeded on apply — created if missing, refreshed when the file changes, and
**kept** when someone has edited the page here since (the apply says which).

You edit any page in place from its row, restore any version from its history,
and share a page like any artifact.

## How to change it

Say it in chat. "We write *the client's team*, never *their team*" becomes an
edit to Voice. "Remember: internal calls file in the wiki, client calls in the
room" becomes a standing rule. "We decided to price per opening" becomes a dated
section under Decisions. The agent cites the page when it relies on it, so you
can check the claim in one move.

## What an agent reads, and when

The wiki's index — every page's title and one-line summary — rides into every
agent turn. A page tagged `always` in its frontmatter rides in whole. Every
other page is read on demand: the agent calls `read_wiki_page` when the turn
is about it, and cites the page when it relies on it. That keeps a large wiki
from crowding out the work in front of the agent, and keeps the pages that are
the tie-breakers in view.
