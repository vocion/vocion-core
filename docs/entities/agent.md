# Agent — `agents/<slug>.yaml`

An agent is an LLM orchestrator: a name, a system prompt, and a list of what it
is allowed to reach. Agents are the front door of a workspace — a workspace lead
consults team leads, and team leads consult their specialists.

| | |
|---|---|
| **Path** | `agents/<slug>.yaml`, usually beside `agents/<slug>.system-prompt.md` |
| **Schema** | `AgentManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `agent` table |
| **Runtime** | Compiled into a deepagents graph per `(org, slug)` — `services/agents/harness.ts` |
| **Surface** | `/api/v1/agents`, `/dashboard/agents` |
| **Layering** | Composable — a base default can be patched with `extends: core` |

## Identity and display

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. Lowercase, starts with a letter, letters/numbers/dashes/underscores. |
| `name` | string | required | Display name. |
| `description` | string | — | One-line summary shown in the agent list. |
| `icon` | string | — | Lucide icon name. |
| `accent` | string | — | CSS color name for the chat header and sidebar. |
| `eyebrow` | string | — | Short tagline above the chat title. |
| `persona` | `{displayName?, iconUrl?}` | — | The name and avatar this agent's chat-surface replies are posted under. A channel binding's own persona still wins. See [Agents in Slack](../guides/slack.md). |
| `active` | boolean | `true` | Set `false` to keep the file but hide the agent. An agent a person retired from the [org review](../guides/org-review.md) is held inactive whatever this says — apply keeps the hold (`agent.paused_at/by/note`) and names it in its summary; Undo on the run that retired it brings it back. |
| `suggestions` | `{label, prompt}[]` | `[]` | Empty-state prompts shown in the chat UI. |

## Structure

| Field | Type | Default | What it does |
|---|---|---|---|
| `parent` | slug | — | The primary agent this specialist reports to. Omit for a primary agent. |
| `team` | slug | — | The team this agent belongs to — a file in `teams/`. |
| `agentType` | `mission` \| `workflow` \| `operational` | — | The work mode this agent primarily runs. |
| `role` | `lead` \| `specialist` | — | **Deprecated.** Derived from `parent`. If authored it must match the derived value. |

The hierarchy is one level deep: an agent named as a `parent` must itself have
no `parent`.

## Behaviour

| Field | Type | Default | What it does |
|---|---|---|---|
| `handles` | string[] | `[]` | What this agent answers for — short topics, intents or example asks (`[wiki, standing rules, research, plans]`). The router's model reads these, with the description and what the agent owns, when nobody named an agent. Composable: `{ $append: [...] }` adds to a base's list. |
| `initiative` | `low` \| `normal` \| `high` | `normal` | How much the agent volunteers. Three effects, each real: it breaks a routing tie; `high` ends a turn that produced something standing (a fact, a decision, a plan) with **one** offer to carry it forward, asked as a question, while `low` never volunteers; and `low` sits out **debriefs** — automations on the completion events (`worker_run.completed`, `worker_run.failed`, `mission_run.completed`, `conversation.ended`, `automation_run.completed`, `pr.merged`) are skipped for a low-initiative agent. Shown on the agent card as a small label when it is not `normal`. |

### Routing — who answers a message nobody addressed

A person who types `@wiki-researcher` has chosen; a channel binding or a
mailbox has chosen for them. Everywhere else — the chat composer with no tag,
an MCP client's `ask_workspace` — the workspace chooses, in code a person can
read (`services/agents/router.ts`), and writes the decision down.

The order, most structural first. An agent the person names (`@slug`, "ask
the *name*") answers. A follow-up stays with the agent the thread is with. On a
record's page, the agent its type names as `x-owner` answers. Otherwise a small,
fast model (the `classifier` role) reads the message against the roster: each
active agent's slug, name, `description` and `handles`, the record types it
answers for (`x-owner`) and files (`objectTypes`), its `harness.grantTools` and
its skills. It returns `{ chosen, confidence, reason }`, checked against the
roster, and code routes on it; below a confidence of 0.5 the workspace lead
answers — `lead:` in `workspace.yaml`, else the first active agent. Meaning is
read by a model, never matched: "file it and build it" belongs to the agent
that owns requests, whatever words the message shares with a researcher's
description (conversation 397).

The read is bounded at 2.5 seconds. When it fails, times out or names an agent
that is not on the roster, the old keyword scorer decides instead — a `handles`
phrase scores 3, all its words 2, each shared `description` word 1 (at most 3),
each shared `suggestions` word ½ (at most 2), the best wins at 2 or more, ties
go to `initiative`, then the lead — and the decision says so.

The decision — the chosen slug, `defaulted`, one sentence of reason, which path
decided (`decidedBy`: `named`, `thread`, `page`, `model`, `keywords`, `roster`),
the model's `confidence`, and on a fallback why the read was not used — is stored on the message it was made for
(`conversation_message.routing_json`), returned in the `ask_workspace` result,
and shown in chat as "via *Agent*" with the reason on hover. An agent with no
`handles` is reached by name, by the lead's delegation, or as the default.

## Prompt

| Field | Type | Default | What it does |
|---|---|---|---|
| `systemPromptFile` | path | — | Markdown prompt file, relative to the agent file. Preferred for long prompts. |
| `systemPrompt` | string | — | Inline prompt. Handy for short prompts and for base-pack agents that must be self-contained. |

Exactly one of the two is required. The loader resolves whichever is present
into the agent's effective prompt.

## Voice — how it talks in chat

`voice:` sets how the agent talks in chat. You steer the agent, never its replies after they are written.

| Key | Values | What it does |
|---|---|---|
| `length` | `brief` \| `standard` \| `detailed` | How long a reply runs. `brief` fits a phone screen, and detail goes to the card or the record. |
| `narration` | `off` \| `on` | `off`: it never announces its next step ("Let me check…", "Here's the card:"). The trace shows its steps, and its cards sit under the reply. |
| `creativity` | `0`–`1` | `0` stays with what the records and wiki support, and `1` offers ideas beyond them. It also sets the sampling temperature on models that accept one. Claude 4.7+ and the 5 family do not, and there the prompt carries it alone. |
| `style` | a wiki page slug | That page, in prose, is composed in as how this workspace talks. |

```yaml
voice:
  length: brief
  narration: off
  creativity: 0.2
  style: house-voice
```

A person can change the voice from the agent's page (the Voice panel, which saves on each tap and offers Undo), by asking in chat (the `set_voice` tool: "be briefer"), over MCP (`agent_voice_get` and `agent_voice_set`), or over the API (`GET` and `PUT /api/v1/agents/:slug/voice`). All four call one service and write the agent's `voice_override`. An apply rewrites `voice` from the YAML and leaves the override alone. "Reset to the workspace voice" (or `clear: true`) drops the override. With no `voice:` at all, an agent runs with the platform voice.

## What the agent can reach

| Field | Type | Default | What it does |
|---|---|---|---|
| `skills` | string[] | `[]` | Skill slugs this agent mounts. Each must resolve to a skill the workspace or its pack ships. |
| `playbooks` | string[] | `[]` | Playbooks attached by name — context always present for this agent, independent of any skill. |
| `connectorSources` | string[] | `[]` | Source slugs this agent may search. |
| `objectTypes` | string[] | `[]` | Business object type slugs this agent works with. |
| `documentSetIds` | number[] | `[]` | Document set ids this agent may read. |
| `learningSteps` | string[] | `[]` | Names of `learning_step` rows this agent owns. |

## Model and retrieval

| Field | Type | Default | What it does |
|---|---|---|---|
| `model` | string | workspace default | Model id. |
| `temperature` | string \| number | workspace default | Sampling temperature. |
| `searchConfig.recencyDecay` | number | — | How hard to favor recent material. |
| `searchConfig.sourceWeights` | `{source: number}` | — | Per-source relevance multipliers. |
| `searchConfig.maxResults` | number | — | Cap on retrieved chunks. |
| `searchConfig.minRelevance` | number | — | Floor on retrieval score. |
| `fewShotExamples` | `{input, output, label?}[]` | `[]` | Worked examples appended to the prompt. |
| `langfuseProjectId` | string | — | Override the observability project for this agent. |
| `approvalPolicy` | object | `{}` | Free-form approval settings read by the review layer. |

## Sub-agents

`subagents` defines helpers the parent dispatches with the `task` tool. Each
entry needs `systemPrompt` or `systemPromptFile`.

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | slug-shaped string | required | How the parent addresses it. |
| `description` | string | required | When the parent should hand off to it. |
| `systemPrompt` / `systemPromptFile` | string / path | one required | The helper's instructions. |
| `tools` | string[] | — | Restrict the helper to these tools. |
| `model` | string | — | Override the model for this helper. |

## Harness

`harness` holds the per-agent knobs for the reusable agent harness.

| Field | Type | Default | What it does |
|---|---|---|---|
| `runsOn` | `in-process` \| `agentcore-container` \| `aws-managed-harness` | derived — see below | Which machinery runs the turn. `in-process`: our harness, in this app's process, no AgentCore. `agentcore-container`: the same harness, in our container, hosted on AWS AgentCore Runtime. `aws-managed-harness`: AWS's own harness instead of ours — it drives the turn and calls back for tools, and the agent gets one tool and no subagents, playbooks or gates. |
| `provider` | — | — | Pre-rename name for `runsOn`, with values `local` / `runtime` / `agentcore`. Still read and normalised; not written back. |
| `interrupts` | string[] | `[]` | Skill or tool slugs that pause for human approval before executing. |
| `maxTokens` | positive int | — | Cap on the model's output tokens. |
| `maxSteps` | positive int | — | Stop a turn after this many steps and show the person a "stopped after N steps" error in place of an answer. A step is a LangGraph graph step: one model call plus the tools it asked for is about two, and parallel tool calls share one. Unset keeps each harness's own backstop — 10,000 steps on `in-process` and `agentcore-container`, 12 tool rounds on `aws-managed-harness`, which gets half of `maxSteps` when it is set. It limits each loop, not the whole turn: a subagent started with the `task` tool gets its own `maxSteps` on every delegation. Set it on an agent whose loop could run away, such as one that drains a queue; about 200 leaves room for normal work. |
| `excludeTools` | string[] | `[]` | Withhold built-in tools by name — e.g. `propose_action` for an agent that should have no CRM-write surface at all. The tools that write are listed in the [agent tools guide](../guides/agent-tools.md). |
| `grantTools` | string[] | `[]` | The inverse: tools too powerful to be default-on, granted only to agents that name them. |
| `model` | string | — | Model override for the `agentcore` / `runtime` providers. |
| `promptCache` | boolean | on | Ask the vendor to cache this agent's prompt prefix. Nothing to set for normal use — it is on, and a prefix under the model's minimum is ignored rather than charged. Written only to say `false`, for an agent called less often than once every five minutes (it would pay the 1.25x write premium on every call and never read one back), or one whose prompt must not sit in a vendor's cache at all. Beats the call site; `VOCION_PROMPT_CACHE=0` turns it off everywhere. See [prompt caching](../guides/prompt-caching.md). |
| `recommendActionBackstop` | boolean | — | When a turn ends with fewer than three `recommend_action` cards, run the card pass over the finished answer: one fast call lists the decisions it names, then one call per card writes it, in parallel, each card on screen as its own call returns (`services/agents/cardBackstop.ts`). A card whose action refuses it becomes one line under the answer, never a card with nothing to press; a build with no filed request becomes the filing. |
| `ownLedger` | string[] | — | Action kinds this agent earns trust for on its **own ledger**. A proposal of a listed kind keys the autonomy ladder on `<kind>.<agent-slug>` — `wiki.write_page.wiki-researcher` — so a rule in `trust.yaml`, the rung and the alignment evidence are this agent's alone while every other agent keeps the kind's shared rule. Honoured by the actions that carry a `by` field (`wiki.write_page` today); the tool fills it from the agent it runs as, never from the model. See [trust](./trust.md#the-agents-own-writes). |

For how the loop, the model vendor, and the AWS account relate — and why two fields both end in "provider" — see [where an agent turn runs](../agent-execution.md).

**`runsOn` is derived when you leave it out.** An agent with `modelProvider: bedrock` and no `runsOn` gets `agentcore-container`. Everything else falls to `in-process`. Choosing Bedrock as the model vendor therefore also chooses AWS as the place the turn runs, and writing `runsOn: in-process` alongside it opts back out.

On `agentcore-container` the container signs Bedrock with a short-lived session core mints from the org's own stored AWS key, so model spend lands on the customer's account. An org that has stored no key gets no session and the container falls through to the platform's own credentials.

## Budget

`budget` caps what this agent may spend, in cents. See the [budgets guide](../guides/budgets.md).

| Field | Type | Default | What it does |
|---|---|---|---|
| `dailyCents` | int ≥ 0 | the workspace's `defaults.agentBudget`, else **$100** (`10000`) | Hard cap per UTC day. A turn is refused once the day's spend reaches it, and a turn that crosses it partway stops at its next model call. |
| `monthlyCents` | int ≥ 0 | none | Hard cap per UTC calendar month. |

Leaving `budget` out is **not** unlimited: the agent is held to the workspace default, and failing that to $100 a day. Written, the block owns the agent's caps and apply resets them to it; left out, apply leaves any stored cap alone. `GET /api/v1/budgets/agents` shows the cap in force for every agent and where it came from.

## Example

```yaml
slug: pipeline-analyst
name: Pipeline Analyst
description: Reads the funnel — stage aging, conversion, and drifting close dates.
icon: trending-up
accent: indigo
parent: revenue-lead
team: revenue-ops
agentType: mission
skills:
  - pipeline-health-report
connectorSources: [hubspot]
budget:
  dailyCents: 5000 # $50 a day; leave out for the workspace default ($100 a day unless set)
suggestions:
  - label: What's stalling?
    prompt: Which open deals have gone quiet, and what would you do about each?
harness:
  provider: local
  interrupts: [send_email]
systemPromptFile: ./pipeline-analyst.system-prompt.md
```

Patching a base-pack agent instead of writing a whole one:

```yaml
extends: core # required marker when the slug exists in the pack
slug: proposal-writer
systemPromptFile: ./proposal-writer.system-prompt.md
connectorSources: {$append: [slack]}
```

## Rules

- Slugs are unique across agents.
- `parent` must name an agent in this workspace, must not be the agent itself, and that parent must have no parent of its own.
- `role`, if authored, must equal `specialist` when `parent` is set and `lead` when it is not.
- `team` is validated whenever the workspace defines any teams. A team's lead must belong to the team it leads, or omit `team:` and apply assigns it.
- Every `skills:` and `playbooks:` entry must resolve to something loaded, from the workspace or the activated pack.
- Either `systemPromptFile` or `systemPrompt` must be present.

## Related

[Team](./team.md) · [Skill](./skill.md) · [Playbook](./playbook.md) · [Mission](./mission.md) · [Base pack](./base-pack.md)
