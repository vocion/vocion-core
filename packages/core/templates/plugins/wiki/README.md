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
- The **Wiki curator** runs on Friday: it reads the week's learnings, decided
  review items, data-room notes and corrections, consolidates what became a
  standing fact into the right page, merges duplicates, and prunes what nobody
  read. On an empty wiki it starts the four pages from what the workspace
  already knows (brand voice, trust rules, the team, the learnings).

**What it measures** — pages written by agents this week, pages that exist,
and edits a person had to decide on (the fewer, the more trusted).

**Customise it** in the workspace: patch the curator with
`agents/wiki-curator.yaml` + `extends: core`, change the bar in `trust.yaml`
(`wiki.write_page`), give your lead the `wiki-context` skill with
`skills: {$append: [wiki-context]}`, or just use it — a correction in chat
becomes a page edit.
