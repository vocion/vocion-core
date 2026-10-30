# Wiki evidence

**What it is:** the wiki remembers where each claim came from. Every claim an
agent writes ends with a token naming the source passage (`[src:104.0]`). Vocion
keeps a small graph of those links, plus links between sources ("Travel Policy
2026 supersedes Travel Policy 2025"). When a source changes, is replaced, or is
removed, the claims resting on it are flagged. No model is involved in that
check: it compares a hash of the passage.

**Why:** a compiled wiki is fast and cheap, but it goes stale quietly. In our
eval, agents reading a wiki with one stale page repeated the old value as
current in about a third of connected questions. With the evidence graph they
did not repeat it once. See [Results](#results).

Design and options: [ADR 0012](../adr/0012-wiki-evidence-graph.md). The idea
comes from LangChain's [Building agent memory with OpenWiki and evidence
graphs](https://www.langchain.com/blog/building-agent-memory-openwiki-graphs).

## Turn it on

It is off by default. In one workspace, add it beside `wiki`:

```yaml
# workspace.yaml
plugins:
  - wiki
  - wiki-evidence
```

Or ask in chat: "turn on the wiki-evidence plugin" (the `plugin.enable` card).

The graph builds itself the first time an agent or the page needs it, then:

- each wiki save rebuilds that page's claims;
- a nightly automation (`wiki-evidence-rebuild`, 06:30 UTC) rebuilds the
  source-to-source links and drops pages that no longer exist.

## What changes for agents

- **Search hits** carry a `cite: [src:<doc>.<passage>]` line to copy into a claim.
- **`read_wiki_page`** ends with the page's checks, e.g.
  `Evidence: 1 of 2 cited claims need a check…`, naming what changed or what
  replaced the source, and any amendment that may qualify a claim.
- **`locate_evidence`** finds pages, claims and sources by words.
- **`expand_evidence`** follows the links from one node: a claim to its passage
  (with the old and new wording when it changed), a document to what replaced
  or amended it, a page to its claims. A single chain is walked on its own.
- The prompt says: never state a flagged claim as current, cite tokens, end
  each wiki claim with its token, and offer a revision for flagged claims.

## The Wiki evidence page

**Workspace → Wiki evidence** (`/dashboard/wiki-evidence`):

- **Needs a check**: each flagged claim, its page, its source, the newer
  source, and for a changed passage the old and new wording.
- **Pages**: cited claims per page and how many need a check.
- **Sources that replace or amend others**.

The page shows only sources you may search. The wiki's reading view shows
tokens as small **source** links to the document.

## Scope and access

- Only workspace-wide documents count (no client- or team-scoped documents).
  A token to one is dropped when the page is saved.
- Each person's graph holds only the sources they may search. An edge touching
  a document they may not read is left out entirely.
- A deleted document keeps its citations, so the claim reads "source removed".
  Only the wiki's own words show, never the deleted text.

## Results

Eval: `packages/core/src/services/evals/wikiEvidence/`. 20 made-up documents,
6 wiki pages (one with a changed passage, two resting on replaced documents),
20 questions (8 simple, 12 connected), 3 conditions, Quick and Standard, n=3.
Graded without a model.

| Level | Questions | Search only | Wiki + search | Wiki + evidence graph |
|---|---|---|---|---|
| Quick | connected, accuracy | 96% | 51% | **100%** |
| Quick | connected, stale stated as current (of 36) | 0 | 12 | **0** |
| Quick | connected, ¢ per correct answer | 0.52¢ | 1.50¢ | 1.29¢ |
| Quick | simple, accuracy | 88% | 88% | 88% |
| Standard | connected, accuracy | 96% | 61% (±9) | **100%** |
| Standard | connected, stale stated as current (of 36) | 0 | 11 | **0** |
| Standard | connected, ¢ per correct answer | 1.29¢ | 1.85¢ | 1.60¢ |
| Standard | simple, accuracy | 88% | 88% | 92% (±7) |

What this says, and does not:

- Against the wiki as it is today, the graph turns a stale wiki from a hazard
  into a source of corrections, at lower cost per correct answer.
- On this small corpus, search alone is as accurate: twenty short documents
  are easy to search. The article's gain of a wiki over search shows on larger
  libraries; this eval does not measure it.
- Per question the graph costs more than the wiki (1.29¢ vs 0.50¢ on Quick,
  1.60¢ vs 1.03¢ on Standard) and takes about 2 s longer, from the extra tool
  calls. Per correct answer it is cheaper.
- One simple question fails everywhere: search returns one hit per document,
  and the answer is in a document's second passage.

Run it (about $3 for all conditions at n=3; needs `ANTHROPIC_API_KEY`):

```bash
cd packages/core
NODE_ENV=development DATABASE_URL=postgres://ci:ci@localhost:5432/ci \
  npm run eval:wiki-evidence -- --repeat 3 --out we.json --markdown we.md
# regrade or merge saved runs, no model calls:
npm run eval:wiki-evidence -- --from we.json,we-graph-rerun.json --out merged.json
```

## Limits

- Freshness is only as good as ingest: a source never re-synced never changes.
- "Supersedes" and "amends" need the newer document to name the older one by
  its exact title after a cue word. Paraphrases are missed (no edge, never a
  wrong one).
- Edges from the wiki are only as right as the model's citations.
- Source links are rebuilt over the newest 5,000 documents.
