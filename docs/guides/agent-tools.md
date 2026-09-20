# Agent tools that write

Most of what an agent can do is read: search the knowledge base, look up records, fetch a page,
render an artifact beside the conversation. This page is about the tools that **change
something**, because every one of them rides the same rail — *propose → gate → execute* — and the
rail is what makes an agent's writes safe to leave on by default.

The rule is one rule (design value 4, *autonomy that was earned*): a tool that writes never writes
directly. It **proposes** a registered action with a confidence; the [trust ladder](../entities/trust.md)
decides whether that runs at once or waits for a person; what runs is recorded as an `action_run`
with who, why, and what was there before; and anything reversible can be put back with one Undo
from the Review queue's Decided tab. A workspace moves the bar per kind in `trust.yaml`; an agent
loses a tool altogether with `harness.excludeTools` ([agent](../entities/agent.md)).

The tool surface is one list, `packages/core/src/services/agents/tools/registry.ts`, and every
harness — in-process, AgentCore, and the MCP server at `/api/mcp` — serves the same tools with the
same gates.

## The tools

| Tool | Action it proposes | What it changes | Present for | Default on the ladder |
|---|---|---|---|---|
| `propose_action` | any registered id — `hubspot.update`, `gmail.send`, `objects.propose_candidate`, … | The outside world: a CRM record, an email, a candidate for a person to judge. | every agent | per action: `hubspot.update` done for you at 0.8; a send or a candidate always asks |
| `recommend_action` | none on emit — the card files `propose_action` when tapped | Nothing until a person taps. | every agent (not over MCP) | — |
| `file_ask` | `ask.file` | Puts one question on Needs you ([ask](../entities/ask.md)): a ruling, an approval, an input, a credential, a merge, a recommendation, a gate. Owned by the agent, bound to its run, about the records it names. | every agent | low, reversible → done for you at 0.8; Undo withdraws it while open |
| `withdraw_ask` | `ask.withdraw` | Closes an open question **this agent** filed, as superseded with the reason. | every agent | low, reversible → done for you at 0.8; Undo reopens it |
| `update_object` | `objects.update_meta` | Declared fields on an existing record of an [object type](../entities/object-type.md) the agent works with — a priority, a state, the task that answered a request. Never the title, the lifecycle status or the id. | agents with `objectTypes:` — and only for those types | low, reversible → done for you at 0.8; Undo restores the previous values |
| `write_wiki_page` | `wiki.write_page` | A page of the workspace wiki. | while the `wiki` plugin is on | self-improving: the learning dial (the plugin sets 0.6) |
| `update_mission_notes` | `mission.update_notes` | The running mission's working notes. | inside a mission check (not over MCP) | self-improving: the learning dial |
| `remember_preference`, `add_learning`, `update_learning`, `remove_learning` | `learning.adopt_rule` and the learning services | Standing rules the agent reads on later turns. | every agent | self-improving: the learning dial |
| `file_feedback` | — proposes a rule for a person | A suggested rule on Needs you. | every agent | always a person |
| `apollo_add_to_list`, `apollo_remove_from_list` | Apollo, direct | A prospect list that can feed a live cadence. | agents granted them (`harness.grantTools`) with an Apollo source | the grant is the gate |

Data-room filing (`file_to_data_room`, `unfile_from_data_room`) and artifact editing
(`update_artifact`, `edit_document`) write inside the workspace and the conversation and are not
on the ladder: nothing leaves, and every version is kept.

## What a receipt says

Every write tool returns one of a few sentences, and the agent is told to repeat the right one:

- **Done for you** — the write ran (`run #N`), a person can undo it from Review › Decided. The agent
  says it was done.
- **Pending** — the confidence was under the bar, or the workspace holds the kind at approval. The
  agent says it is *queued for approval*, never that it happened.
- **Refreshed** — a pending card for the same target already existed and now carries this payload.
  Nothing new was queued.
- **Already decided** — a person judged this exact record before. The agent moves on.
- **Refused** — the rail said no before any row existed: an unknown field, a record that is not
  there, an option shape the service does not take. The reason is a sentence the agent can act on.

An ask's receipt also carries the ask's id and its URL on Needs you, so the agent can link the
question where it reports — and the agent is told it does *not* have the answer yet.

## Asking a person — `file_ask`

An ask is not a proposal: nothing executes when it is answered. It is the right tool when the
decision is a person's to make and the agent's job is to put it in front of them well — the
question as the title, two to four lines of why, options whose description is the consequence of
picking each, the long form behind `context_md`. [Writing a good ask](../entities/ask.md#writing-a-good-ask)
is the reference.

What the tool adds on the agent's behalf: `agentSlug` from the run, `sourceRef` as the action run
(so a retry updates rather than doubles), and `contextUrl` as the mission run the question came up
in. What the agent should add: `object_refs` — the records the question is about — because they
ride the `ask.decided` event beside the agent slug and the kind, and an automation filtered on
those writes the person's answer back onto the record. A batch shares a `group_key` and is
decided as one sheet; `decision_cost` is the minutes each question takes, which is what a batch is
metered by.

Why it is on the ladder at all: an agent that asks too much is a cost, and *whether this agent may
interrupt people unasked* is the workspace's call. The default says yes above 0.8 with Undo; a
`trust.yaml` rule parking `ask.file` at `execute-with-approval` means a person first sees "this
agent wants to ask you something" and approving it is what files the question.

## Writing a record — `update_object`

The write beside `lookup_objects`. It is scoped twice: the agent's own `objectTypes:` list says
which types it may write at all (a type outside it is refused before anything is proposed), and
the type's `schema.properties` says which fields — an undeclared field, or a value outside its
field's enum or type, is refused with the list of what the type does declare, so a new field is
a change to `type.yaml` first. The row's own columns (`title`, `status`, `id`, the bookkeeping)
are never written through here; each has its own path.

Every write records the previous values on its run, which is what makes it reversible and
therefore done for you by default. The runs are the record's write history — who, why, what
changed, what was there before — under a dedup key that names the record and the fields, so a
re-scored priority refreshes one pending card while a write to other fields on the same record
stands beside it.

The ladder keys each write on its type — `objects.update_meta.<objectType>` — so `product` can be
held at approval while `request` earns its way; a type with no rule reads the action's default.
See [trust](../entities/trust.md#the-agents-own-writes).

## Over MCP

The same tools are served by the MCP server (`/api/mcp`), running **as an agent**: the default is
the workspace lead or `VOCION_MCP_AGENT_SLUG`, and every tool takes `agent_slug` to run as another
one, re-gated at call time. `file_ask` and `withdraw_ask` are present for every agent;
`update_object` only for one with object types, and only for those types. The MCP credential never
widens what the agent may do: a proposal from over MCP rides the same agent principal, at working
autonomy, judged by the same ladder.

### Asking the workspace

Working *as* an agent is one thing; asking one is another. `ask_workspace` takes a `message` and
runs one real turn — the same harness, tools, trust gating, enabled plugins and wiki mount the
dashboard chat runs — as the token's principal, and persists it as a conversation (surface `mcp`,
visible on `/dashboard/conversations`). Who answers is the **router's** call
([agent → Behaviour](../entities/agent.md#behaviour)): the message is matched against what each
agent `handles`, its description and its suggestions, a tie goes to the higher `initiative`, and
nothing convincing means the workspace lead. The result carries the whole `reply` (no stream),
`agentSlug` and `agentName`, `routing` — the candidates considered, the chosen slug, `defaulted`,
one sentence of reason — `conversationId` to continue with, `turnId`, `traceId`, `actions` (anything
the agent filed for a person, with ids, statuses and inbox links) and `url`. Pass `agent_slug` to
skip the router, `conversation_id` to continue a thread (its agent answers, no routing), `title` to
name a new one. A turn longer than `VOCION_CHAT_TURN_LIMIT_MS` (120s) returns what was said so far
with `truncated: true`; the rest lands in the conversation when the turn finishes. `list_agents` is
the roster the router chooses from — slug, name, `handles`, `initiative`, suggestions, `lead`.

## Related

[Trust rules](../entities/trust.md) · [Earned autonomy](./earned-autonomy.md) ·
[Needs you](./needs-you.md) · [Ask](../entities/ask.md) · [Object type](../entities/object-type.md) ·
[Agent](../entities/agent.md)
