# Wiki

The workspace's **long-term memory**: what changes slowly and has to be true
every time — the voice, the standing rules, who is who, the decisions that
hold, the glossary. Not a log of what happened (that is the activity ledger),
not a rule for one step (that is a learning), not a client's own material (that
is its data room).

**How it works**

- A page is a **markdown artifact** in the `wiki` folder, so it already has
  versions, restore, the preview pane, share and `@mention`. The Wiki page
  lists them; open one to read or edit it in place.
- Every agent gets the wiki **in context**: the index at `/wiki/index.md` and
  the pages that fit at `/wiki/<slug>.md`, fresh each turn. The system prompt
  says to read the relevant page before acting on a standing fact and to cite it.
- The **writer is the agent.** `write_wiki_page` proposes the change with a
  confidence; above the bar (`trust.yaml`, 0.6) it is written at once and shows
  in Review › Decided with Undo; below it a person decides on a card that
  carries the page. Nobody pastes into the wiki.
- Every save **indexes for search** (`artifact.saved` → `index-artifact`), so
  `search_knowledge` finds a wiki page like any connected document.
- Two agents, one team. The **Wiki researcher** is the front door: it answers
  in chat and over MCP the moment it is asked, researches against the wiki
  first and then the knowledge index and the web, and offers to write the page
  whenever a conversation produces a standing fact or a plan. The **Wiki
  curator** runs on Friday: it reads the week's learnings, decided review
  items, data-room notes and corrections, consolidates what became a standing
  fact into the right page, merges duplicates, and prunes what nobody read. On
  an empty wiki the curator starts the four pages from what the workspace
  already knows — or the repo does, see below.

**Start the wiki from the repo**

A workspace folder may carry its first pages as files, and `workspace:apply`
seeds them:

```
<workspace>/wiki/
├── voice.md
├── standing-rules.md
├── who-is-who.md
└── index.md          # optional; generated from the others when absent
```

```markdown
---
title: Who is who                     # required
summary: Agents, teams, accountable humans, who leads what.   # optional — the index line
order: 20                             # optional — sorts the generated index
tags: [people]                        # optional
managed: true                         # default; false seeds once and never again
---
The page, as markdown. No `#` title line — the title renders above the body.
```

The slug is the filename (`who-is-who.md` → page `who-is-who`; lowercase,
digits, dashes). Each apply creates a missing page, refreshes one whose file
changed, and **keeps** one that anyone has since edited in the app — with a
warning naming the page and how to reconcile (edit the file to match, or set
`managed: false`). Deleting a file keeps the page and warns once. Every write
is an ordinary version, so undo and restore work and the page is indexed for
search like any other. The apply summary carries the counts:
`wikiPages created=… updated=… unchanged=… kept(human-edited)=…`. The full
contract is in [`docs/entities/workspace-manifest.md`](../../../../../docs/entities/workspace-manifest.md#folder-layout--wiki-pages-seeded-from-the-repo).

**The researcher, in chat and over MCP**

The researcher shows in the chat agent picker like every agent (its
`suggestions` are the chips on an empty chat) and, as the team's lead, is the
wiki agent the workspace lead consults. In chat and over MCP the **router**
sends it the questions it `handles` — `wiki`, `standing rules`, `research`,
`plan`, `decision` — when nobody names an agent; its `initiative: high` takes
a tie against another agent (`services/agents/router.ts`; the decision is
written on the message, and shown as "via Wiki researcher" with the reason on
hover). Over MCP the verb is `ask_workspace`: the message is routed, one turn
runs, and the reply comes back with `routing` — which agents were considered,
who answered and why — or pass `agent_slug: wiki-researcher` to skip the
router. An MCP client can also work *as* the researcher through the bridged
tools: every domain tool (`search_knowledge`, `read_wiki_page`,
`write_wiki_page`, `web_search`, …) takes `agent_slug`, so `write_wiki_page`
with `agent_slug: wiki-researcher` proposes the page as the researcher, under
its own ledger — or set `VOCION_MCP_AGENT_SLUG=wiki-researcher` to make it the
default agent for the server. `mission_start` and `workflow_run_start` remain
the ways to run longer work from a client.

**The debrief.** Finished work is read once for what it settled. The
`wiki-debrief` automation fires on core's completion events —
`worker_run.completed`, `mission_run.completed`, `conversation.ended`,
`pr.merged` — and checks the `wiki-debrief` mission: the researcher reads the
run, the conversation or the pull request itself, decides whether a standing
fact, a decision or a plan changed, and proposes the page revision through
`wiki.write_page` (its own ledger, so review until promoted). Work that
settled nothing writes nothing. `conversation.ended` is raised by the
`sweep-idle-conversations` job, which this plugin schedules every fifteen
minutes (`automations/conversation-sweep.yaml`, thirty quiet minutes ends a
thread); the other three events core raises on its own. The curator is
`initiative: low` and sits debriefs out — it consolidates on Friday.
Core never fires the debrief on its own check's completion — a fire carries
its chain on the run it starts and the matcher skips it — and holds it to
`when.maxFiresPer10m` (default 6) event fires in ten minutes, coalescing the
rest into one run; override the ceiling on the automation's slug if a
workspace finishes more work than that ([automation](../../../../../docs/entities/automation.md#when)).

**Earned trust.** The researcher's writes key on their own ledger —
`wiki.write_page.wiki-researcher`, because its `harness.ownLedger` names the
kind — and start at **review**: a person sees each proposed page until the
Autonomy page shows the evidence to promote it (low tier: twenty decisions at
90% agreement, no rejection in fourteen days). The curator's writes, and any
other agent's, stay under the shared `wiki.write_page` rule at 0.6.

**What it measures** — pages that exist, pages written by the agents this week,
and edits a person had to decide on (the fewer, the more trusted).

**Customise it** in the workspace: patch either agent with
`agents/wiki-researcher.yaml` or `agents/wiki-curator.yaml` + `extends: core`,
change a bar in `trust.yaml` (`wiki.write_page`,
`wiki.write_page.wiki-researcher`), give your lead the `wiki-context` skill
with `skills: {$append: [wiki-context]}`, seed pages under `wiki/`, or just use
it — a correction in chat becomes a page edit.
