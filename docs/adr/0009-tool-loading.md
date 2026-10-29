# ADR 0009 — Which tools a turn loads

Status: accepted, 2026-10-29. Shipped behind `harness.toolLoading`, default
`history` (no behaviour change). `core` is switched on per workspace after
the eval gate below passes.

## Context

Every agent is built with 90 to 135 tools: 91 on every agent whatever its
sources, plus each connector's. Measured as the model receives them (name,
description, JSON input schema; `scripts/measure-tools.ts`), that is 145k to
200k characters, 57k to 80k tokens. Anthropic's token counter reads tool
definitions at 2.5 characters per token: JSON schema is denser than prose.
Public guidance puts the point where tool choice starts to slip at 30 to 50
tools (Anthropic) or 20 (OpenAI). Every agent is 2 to 4 times past it.

Since 2026-10-04, on the direct Anthropic API, `toolTiers.ts` keeps an
agent's **recently used** tools loaded (the tools behind 90% of its last 30
days of calls, 4 to 12 of them). It defers the rest behind Anthropic's tool
search (`defer_loading`, `tool_search_tool_bm25`). That cut the cost of the
catalog, but history measures what an agent **did**, not what it is
**for**. Each of these incidents was patched with a one-off exemption:

| Date | What happened | Patch |
|---|---|---|
| 2026-10-04 | An agent told a person it could not make an image while `generate_image` was behind the search. | The search note: "search … before saying you cannot". |
| 2026-10-15 | MCP discovery was not visible. | `mcp_list_tools` and `mcp_read` `alwaysLoaded` (#1342). |
| 2026-10-23 | A lead's prompt was rewritten to use `read_wiki_page` and `goal_progress`. Both were deferred because it had never called them. | `namedInPrompt` (#1400). |
| 2026-10-23 | The review-queue tools had to be found by searching. | Always loaded while on the queue (#1414). |
| 2026-10-27 | A teammate on its own model could not open a draft, because the read was deferred and it was never told to search. | SEO tools `alwaysLoaded`; teammates get the note (#1491). |
| from day one | State questions. | `query_state` `alwaysLoaded`. |
| 2026-10-28 | A read-heavy pipeline analyst asked to update a deal said it had no tool to: `recommend_action` was deferred. | Prompt fix in the workspace. |

The last one reproduces in the `agent-behaviour` eval below: in `history`
mode the analyst found and read the deal, showed the change, and then said
"I don't have a tool available to make direct updates to HubSpot deals".

Loading everything is not the fix: it puts 57k to 80k tokens in front of
every call and takes every agent past the accuracy threshold. With prompt
caching working it costs cents per turn, not dollars, so cost is not what
decides. Accuracy and context are.

## Decision

**A turn's loaded tools come from the agent's configuration, within a
budget; the long tail waits behind the search, and the search note says
what is there.** `harness.toolLoading` (agent) or `defaults.toolLoading`
(workspace) picks the mode (`services/agents/toolLoading.ts`):

| Mode | Loaded | Deferred |
|---|---|---|
| `history` (default) | Exactly the behaviour before this ADR: recent use, grants, tools the prompt names, `alwaysLoaded` tools. No history: everything. | The rest. The note is unchanged. |
| `core` | The **core tier** (below), `alwaysLoaded` tools, grants, tools named in the prompt **or the agent's skills and playbooks**, recent use, and **every declared connector's tools**, within the budget. If the whole catalog fits the budget, everything. | The rest, listed by family in the search note. |
| `all` | Everything. The old `harness.toolSearch: false` still means this. | Nothing. |

Only the direct Anthropic API runs the search, so any other provider loads
every tool in every mode, as before.

**The core tier** is how an agent acts, decides and reads the workspace:
`recommend_action`, `propose_action`, `withdraw_proposal`, `decide_proposal`,
`decide_ask`, `file_ask`, `withdraw_ask`, `request_human_review`,
`query_state`, `search_knowledge`, `lookup_objects`, `page_context`,
`where_to`, `list_capabilities`, `describe_sources`. About 30k characters.

**The budget** is 40 tools or 64k characters (about 25k tokens), whichever
comes first (`TOOL_BUDGET`).

**Families.** `tools/registry.ts` tags every tool group with the family the
search note names it by (`metadata.toolFamily`) and marks a connector's tools
(`metadata.connectorTool`). The tags change nothing else.

**The search note in `core`** names each deferred family with a few of its
tools: "Not loaded until you search for them: - Decks: render_deck,
read_deck, edit_deck, verify_deck, and 3 more …". BM25 then gets the tool's
words, not only the person's.

### Over the budget (an agent like a revenue lead)

A revenue lead with seven connectors and 18 granted tools has 130 tools and
about 200k characters. Its configuration alone does not fit. `core` cuts it
in this order:

1. **Always kept, even past the budget:** the core tier, `alwaysLoaded`
   tools, grants and tools named in the prompt, skills or playbooks. Each is
   the author's explicit choice, and deferring one is exactly the incident
   this ADR prevents. If these alone are over the budget, the plan says so
   (`overBudget`): a warning is logged and the turn's trace carries it. The
   fix is then in the agent's configuration (fewer grants, or a teammate),
   not in core.
2. **Recent use**, one tool at a time while the budget lasts.
3. **Declared connectors, a whole family at a time** while it fits. Families
   the agent already uses come first, then the smallest. A family that does
   not fit is deferred whole and named in the note. Half a family loaded
   reads as a family that cannot do the other half.

For the eval's revenue lead that is 38 tools, 63k characters: the core
tier, its 18 grants, its recent use, and the Gmail, Calendar and Zoom
families. HubSpot's other 12 tools, Drive and the team-chat reads are
deferred and named in the note; its most used HubSpot read stays loaded
from history. It is not `overBudget`: core tier and grants are 33 tools.
No shipped template agent is over the budget (`toolMeasure.test.ts`).

### What a turn records

`run_meta` carries `tools`: mode, loaded, deferred, `overBudget`, loaded
tokens and the deferred families. The Langfuse trace's metadata carries the
same, plus the turn's counts: tool searches run (`server_tool_use` blocks),
calls to a tool the turn does not have, and tool errors. No migration: the
trace is where a turn's cost and latency are already read.

### Descriptions, and the caps CI holds

The largest definitions are mostly **schema structure, not prose**.
`update_project` is 8.7k characters, of which the description is 1.0k and
the schema's own words 2.3k. Shortening prose moves the total little. This
change removes repeated and wordy text from `file_ask` (its kinds were
listed twice), `propose_action`'s decision arguments, `list_recent_runs`
and the HubSpot count tools' shared notes: −2.9k characters across the
catalog. Cutting the large schemas is follow-up work.

`toolMeasure.test.ts` holds the catalog in CI, with no model call:

- no tool definition over 9k characters and no description over 4.5k;
- the whole catalog of an agent with every common connector at 180k or less
  (175k today);
- every core-tier tool is built for every agent;
- in `core`, every template agent and every eval agent fits the budget, and
  none is over it.

A cap is raised only with a reason recorded here.

## Validation: the `agent-behaviour` eval

`services/evals/agentBehaviour/`, run with
`scripts/eval-agent-behaviour.ts`. Three fictional agents shaped like real
ones: a pipeline analyst (HubSpot, Gmail, Drive, read-only history), a
revenue lead (seven connectors, 18 grants) and a workspace lead (no
connectors, the wiki). Each has the real catalog, descriptions and schemas,
loaded as the harness loads them. Tools answer from made-up data
(`stubs.ts`), arguments are checked against the real schemas, and the
model is the real one: Quick on the fast model with thinking off, Standard
on the main model. Twelve cases: the write path (asked and confirmed),
connector and granted reads, the long tail (a chart, a deck, an image, a
wiki page), and false-refusal probes (a goal, a preference, an ask, "can
you update deals?").

The loop is the eval's own, not the deepagents graph, because the graph
needs a database, a workspace and connectors. It does not include the
platform's shared prompt rules or per-turn middleware.

**The gate for switching `core` on**, `core` against `history` at each level:

| Metric | Bar |
|---|---|
| Tool awareness (expected tool called without an error) | ≥ 95% |
| False refusals ("I can't" without the work) | 0 |
| Tool errors | No worse than `history`, per call. Per turn rewards a refusal, which makes no calls. |
| Warm Standard turn | At most +2¢ over `history` |
| Median time to first token | At most 1 s slower |

## Rollout

- This change ships with the default `history`: nothing changes on merge.
- After the gate passes, one workspace sets `defaults.toolLoading: core`,
  then the others. That is workspace configuration, not a core change.
- **Rollback:** `toolLoading: history`, or `all` for one agent.

## Not in scope

Model routing and effort levels; live evals of production agents (ADR 0010);
which connector actions exist; renaming tools for search.
