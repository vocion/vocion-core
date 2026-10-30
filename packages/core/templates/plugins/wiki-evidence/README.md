# Wiki evidence

Ties the wiki to its sources (ADR 0012).

- **Cited claims.** A wiki page cites the passage a claim rests on with a
  `[src:<document>.<passage>]` token. `search_knowledge` shows each hit's token
  while this is on. On save, each cited sentence becomes a claim, recorded with
  the passage's hash at that moment.
- **Typed links between sources.** "This policy supersedes …", "amends …", a
  link to another document, or a mention of its exact title become
  `supersedes`, `amends` and `refers_to` edges. These are read from the
  documents' own words, with no model.
- **Checks without a model.** A claim whose passage changed, whose document
  was replaced by a newer one, or whose document is gone is flagged.
  `read_wiki_page` lists the flagged claims, and agents are told not to repeat
  them as current.
- **Walking it.** `locate_evidence` finds where to start, and
  `expand_evidence` follows edges, e.g. `superseded_by` to the current version.
- **Wiki evidence page** (`/dashboard/wiki-evidence`): claims that hold,
  claims that need a check (with the old wording beside the current one), and
  which sources replace which.

Scope: workspace-wide sources only. A document scoped to a client or a team
is never in the graph, and a person sees only documents from sources they
can search.

Turn it on with `plugins: [wiki, wiki-evidence]` in `workspace.yaml`.
Turning it off removes the tools, the tokens in search results and the page.
The edges stay in `memory_edge` until the next rebuild with it on.
