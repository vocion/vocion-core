# ADR 0012 — The wiki's evidence graph: cited claims, typed source edges, staleness without a model

Status: accepted, 2026-10-30. Additive and off by default: a workspace turns on
the `wiki-evidence` plugin (it depends on `wiki`). Nothing changes for a
workspace that does not.
(ADR 0010 is taken by the agent evals change, #1502.)

## Context

LangChain's write-up of OpenWiki with an evidence graph (2026-10-28,
"Building evidence-grounded agent memory with OpenWiki and graphs") measured
three layers on a synthetic library of 111 insurance documents that amend and
supersede one another:

- **A compiled wiki** (pages synthesised from the sources, every statement a
  *claim* that cites source lines and their hash) made a search-only agent
  about 5x more accurate on *connected* questions (0.10 → 0.52), at a third of
  the cost per correct answer. On *simple* lookups it made no difference and
  was slower.
- **Staleness without a model call**: when a cited line's hash changes, the
  claims resting on it are flagged deterministically. Only those go to a model.
- **An evidence graph** materialised from the citations and the documents'
  own references: paragraphs as nodes, typed edges (`cites`, `refers_to`,
  `supersedes`, `amends`), and two tools: `locate` (where to start) and
  `expand` (follow typed edges, auto-walking single paths). Built in under a
  second with no model calls. Compared with the wiki alone, accuracy went up
  27%, citation consistency doubled, and cost per correct answer fell 58%.

### What Vocion has today

**Partly.** The compiled-wiki half exists. The evidence half does not.

| Layer | In Vocion | Where |
|---|---|---|
| Compiled wiki, agent-written, versioned, undoable | yes | `services/wiki/WikiService.ts`, `libs/actions/wiki-write-page.ts`, `templates/plugins/wiki/` (curator, researcher) |
| Wiki in every agent's context | yes: the index plus the pages that fit (24k chars) | `WIKI_MOUNT_BUDGET_CHARS`, `services/agents/tools/wiki.ts` |
| Wiki searchable alongside sources | yes: hybrid search, `wiki` source | `services/wiki/wikiIndex.ts`, `services/RetrievalService.ts` |
| Sources split into passages, hashed per document | yes: `knowledge_chunk` (delete-and-replace on change), `knowledge_document.content_hash` | `models/Schema.ts`, `services/IngestionService.ts` |
| Typed, scoped rule memory with human approval | yes (a different job: rules, not facts) | `services/MemoryService.ts`, `LearningCandidateService.ts` |
| A wiki claim tied to the passage it rests on | **no**: "every claim with its source" is prose in the prompts | curator and researcher prompts |
| Knowing that a claim's source changed | **no**: a page stays as written until someone happens to re-read it | — |
| Typed edges between sources (this replaces that, this refers to that) | **no** | — |
| Navigation along evidence (`locate` / `expand`) | **no**: only search again | — |

Why it matters here: the questions Vocion's agents get that go wrong are
cross-source and change over time. Which rate card applies now? Did the
refund window change? What does this SOW depend on? The wiki says what was
true when it was written. Nothing tells the agent, or the person, that a
source underneath it moved or was replaced.

## Options

**A. Nothing.** The wiki plus hybrid search already answers simple lookups,
where the article found memory adds nothing. Cost: stale pages keep being
read as true, and cross-source answers stay a re-search every turn.

**B. Cited claims and staleness only.** The wiki writer cites passages with a
stable token. On every save, the claims and their passage hashes are
recorded. A deterministic check flags claims whose passage changed or whose
document is gone. Cheap, and auditable. It gives no help following one source
to another.

**C. B plus a lightweight evidence graph** (the article's design, adapted).
- Typed edges from the documents' own references: a link to another
  document's URL is `refers_to`; "supersedes / replaces / amends <title of
  another document>" is `supersedes` or `amends`.
- Wiki-to-wiki links become `links_to`.
- A claim citing a passage in a document that a newer document supersedes is
  flagged `superseded`.
- Two tools, `locate_evidence` and `expand_evidence`, follow the edges. The
  agent also sees the flags when it reads a page.
- No model calls to build. Rebuilt on wiki save and by a job.

**D. An extracted knowledge graph** (entities and relations pulled out by a
model, e.g. GraphRAG-style). Models everything, costs model calls per
document and per change, and needs entity reconciliation. The article chose
not to, and found it unnecessary for evidence navigation.

**E. Run OpenWiki itself** (the CLI) beside Vocion. It compiles repositories
and files into a separate wiki. It duplicates the wiki Vocion already has,
which is versioned, mounted, reviewed and searched, and it would sit outside
the approval and undo path.

## Decision

**C, behind a plugin, shipped only if the eval says so.**

- **Reuse what exists.** The wiki page stays a markdown artifact. Passages
  are `knowledge_chunk`s. Document ids are stable across re-ingest, chunk ids
  are not. So a citation is `[src:<documentId>.<chunkIdx>]` plus the
  passage's hash at the time it was cited, and a passage that moved within
  its document is found again by hash.
- **One new table, `memory_edge`**, with typed, directed edges:
  - nodes: `wiki`, `claim`, `doc`, `passage`;
  - edges: `cites`, `links_to`, `refers_to`, `supersedes`, `amends`;
  - inverses are read, not stored.
  - Claims are not their own table. A claim is the sentence that carries a
    citation token, keyed `slug#n`, and its text rides on its `cites` edge.
- **Deterministic everywhere.** Building edges and checking freshness make no
  model call. A claim is `fresh`, `changed`, `superseded` or `gone`.
- **Agent surface:**
  - `search_knowledge` hits show their `cite` token;
  - `read_wiki_page` lists the claims that need a check;
  - `locate_evidence` and `expand_evidence` (hops auto-walk a single path,
    e.g. a `supersedes` chain to the current version);
  - the curator's skill rechecks flagged claims first.
- **Person surface:** a Wiki evidence page (claims checked, what needs a
  check, which sources replace which), and a one-line strip on each wiki page.
- **Off by default:** the `wiki-evidence` plugin. With it off, no tool, no
  token, no edge write, no UI.

### Why not B alone, or D

The article's connected-question gains came from following edges. Citations
alone made answers auditable but not more often right. The extra cost of C
over B is a regex pass over the sources and a small table, with no model.
D's cost is per document, forever. Its benefit (modelling every entity) is
not what goes wrong here.

### The bar to ship (eval-gated)

A before and after eval (`services/evals/wikiEvidence/`, n=3) on a made-up
workspace with superseding and amending sources, a compiled wiki with one
stale and one superseded claim, and simple versus connected questions. It
runs on three conditions: search only, wiki plus search, and wiki plus the
evidence graph. Ship only if, on connected questions, the evidence graph
beats the wiki alone on accuracy without losing accuracy on simple ones, and
its cost per correct answer is no worse. The numbers live in the guide and
the PR.

### Scope and access

- Only workspace-wide documents (no `clientId`, no `teamId`), outside the
  wiki's own source, enter the graph. A token to a client or team document is
  dropped at write time, so the cross-client boundary holds.
- Each person's graph is cut to the sources they may search
  (`allowedSourceSlugs`). An edge touching a document they may not read is
  left out entirely, not shown as "gone".
- A deleted document keeps only its `cites` edges, so the claim reads
  "source removed". Only the wiki's own words show.

## Result (eval, 2026-10-29)

n=3, 360 runs per full pass. Total eval spend for the decision: $4.80
(smoke $0.12, full pass $3.20, graph re-run after fixes $1.48).

| Level | Connected accuracy: search / wiki / graph | Stale stated as current (of 36) | ¢ per correct: wiki / graph | Simple accuracy: wiki / graph |
|---|---|---|---|---|
| Quick | 96% / 51% / **100%** | wiki 12, graph 0 | 1.50¢ / 1.29¢ | 88% / 88% |
| Standard | 96% / 61% / **100%** | wiki 11, graph 0 | 1.85¢ / 1.60¢ | 88% / 92% |

All six ship-bar checks pass. The loop's fixes are as follows:
- A `refers_to` edge now comes from any exact mention of another document's
  title, not from a cue word.
- `expand` shows a document's passages, and a changed passage's old and new
  wording.
- Claims flag an amendment to their source.
- The grader no longer counts "the wiki says 30 days" as stating it.
- Claim parsing splits an uncited sentence that follows a token.

What the eval does not show: on 20 short documents, search alone is as
accurate as the graph, so the article's wiki-over-search gain is not measured
here. The case for shipping is against the wiki as it is today. A stale page
turns into wrong answers, and the graph turns it into corrections, at a lower
cost per correct answer.

## Consequences

- A wiki page written while the plugin is on carries `[src:…]` tokens. The
  wiki reading view renders them as source links, plugin on or off, so
  turning the plugin off never shows raw tokens.
- Freshness is as good as ingest. A source that is never re-synced never
  shows as changed.
- Title matching for `supersedes` and `amends` is exact on a normalised
  title, so it misses paraphrased references. It errs towards no edge, never
  a wrong one.
- Edges from the wiki are only as right as the model's citations, the same
  limit the article names. A token pointing at a passage that does not exist
  is dropped at write time.

## Not in scope

- A model revising stale claims on its own. The curator sees the flags and
  proposes revisions through `wiki.write_page`, reviewed as today.
- Episodic and procedural memory on the same edges (the article's "next").
- Reading AgentCore memory or OpenWiki output.
