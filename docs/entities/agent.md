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
| `active` | boolean | `true` | Set `false` to keep the file but hide the agent. |
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

## Prompt

| Field | Type | Default | What it does |
|---|---|---|---|
| `systemPromptFile` | path | — | Markdown prompt file, relative to the agent file. Preferred for long prompts. |
| `systemPrompt` | string | — | Inline prompt. Handy for short prompts and for base-pack agents that must be self-contained. |

Exactly one of the two is required. The loader resolves whichever is present
into the agent's effective prompt.

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
| `excludeTools` | string[] | `[]` | Withhold built-in tools by name — e.g. `propose_action` for an agent that should have no CRM-write surface at all. |
| `grantTools` | string[] | `[]` | The inverse: tools too powerful to be default-on, granted only to agents that name them. |
| `model` | string | — | Model override for the `agentcore` / `runtime` providers. |
| `recommendActionBackstop` | boolean | — | When a turn ends with zero `recommend_action` calls, run a short follow-up pass to emit the action cards the agent's rules require. |

For how the loop, the model vendor, and the AWS account relate — and why two fields both end in "provider" — see [where an agent turn runs](../agent-execution.md).

**`runsOn` is derived when you leave it out.** An agent with `modelProvider: bedrock` and no `runsOn` gets `agentcore-container`. Everything else falls to `in-process`. Choosing Bedrock as the model vendor therefore also chooses AWS as the place the turn runs, and writing `runsOn: in-process` alongside it opts back out.

On `agentcore-container` the container signs Bedrock with a short-lived session core mints from the org's own stored AWS key, so model spend lands on the customer's account. An org that has stored no key gets no session and the container falls through to the platform's own credentials.

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
