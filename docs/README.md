# Vocion docs

## Start here

- [**Product Design Manifesto**](./MANIFESTO.md) — why Vocion exists and the bar every product decision is held to: outcomes over activity, accountability with an owner, automation that is earned, complexity hidden without hiding the truth. Ends with the twelve-question test.
- [**Getting started — build an agent workforce from zero**](./getting-started.md) — the tutorial. Explains the configuration-driven model, then builds a complete workforce file by file, with a worked example of every entity type. Read this first.
- [**Workspaces (workspace-as-code)**](./workspace.md) — what a workspace is, how to create one, how to author and apply changes, and how base packs layer underneath.
- [**Entity reference**](#entity-reference) — every authored file type, field by field.
- [**Where an agent turn runs**](./agent-execution.md) — the loop, the model, and the AWS account, kept apart. Read it before touching `harness.runsOn`, `harness.modelProvider`, or anything named AgentCore. Includes what the `provider` → `runsOn` rename changes for an existing workspace (nothing, unless you want it to).
- [**Object model**](./object-model.md) — the lookup table: where each object is authored, its schema symbol, its table, its runtime, its UI surface. Includes runtime-only objects (tool calls, runs, events).
- [**Canvas — rendered output as data**](./canvas.md) — `render_*` tools, the `artifact`/`canvas` tables, the cards that render them on the chat and the canvas beside a conversation, and exporting a saved canvas as a workspace page.
- [**Routing — the workspace in the URL**](./routing.md) — why `/w/<slug>/…` exists, what the entry route does, and the phase-2 design for `/{account}/{workspace}/…` as the canonical URL.
- [**Review operations in the base pack**](./review-ops.md) — the review-queue agents and approval-drafting skills that ship in `core@2.1.0`, how to activate them, and how to override one.

## Entity reference

One page per authored entity type. Each page lists every field with its type,
default, and effect, plus a worked example and the rules the loader enforces.

| Entity | Authored at | What it is |
|---|---|---|
| [Workspace manifest](./entities/workspace-manifest.md) | `workspace.yaml` | The workspace's identity, defaults, lead, surfaces, and base-pack pin |
| [Base pack](./entities/base-pack.md) | `packages/core/templates/base/pack.yaml` | The reusable layer that loads underneath a workspace, and how activation and overrides work |
| [Agent](./entities/agent.md) | `agents/<slug>.yaml` | An LLM orchestrator: prompt, hierarchy, what it may reach, harness settings |
| [Team](./entities/team.md) | `teams/<slug>.yaml` | A group of agents under a lead, with an accountable human, a goal, and the KPIs it is graded on |
| [Skill](./entities/skill.md) | `skills/<slug>/SKILL.md` | A unit of work the agent reads on its own judgement |
| [Playbook](./entities/playbook.md) | `playbooks/<slug>/SKILL.md` | Standing context attached to a skill or an agent by name |
| [Mission](./entities/mission.md) | `missions/<slug>.yaml` | A standing responsibility: goal, success criteria, autonomy |
| [Workflow](./entities/workflow.md) | `workflows/<slug>/workflow.yaml` | A deterministic procedure with human gates |
| [Automation](./entities/automation.md) | `automations/<slug>.yaml` | The only place time and events live: when, then do |
| [Object type](./entities/object-type.md) | `objects/<slug>/type.yaml` | The definition of a business entity, and how to classify into it |
| [Source](./entities/source.md) | `sources/<slug>.yaml` | A connection to outside data, its sync cadence, and who may retrieve from it |
| [Trust rules](./entities/trust.md) | `trust.yaml` | Which actions may auto-execute, above what confidence, and where each kind stands on the autonomy ladder — see the [earned autonomy guide](./guides/earned-autonomy.md) |
| [Learning step](./entities/learning-step.md) | `learnings/<name>.yaml` | A named bucket of accumulated rules an agent reads |
| [Eval dataset](./entities/eval-dataset.md) | `evals/<slug>.yaml` | Test cases for one agent, graded on substance |
| [Ask](./entities/ask.md) | runtime — `POST /api/v1/asks` | One question waiting on a person, answered on the Needs-you page or over the API |
| [Workspace page](./workspace-pages.md) | `pages/<slug>.yaml` | A tenant-defined dashboard page, derived from a core page archetype |

Workspace pages keep their own page because they are file-only: nothing is
written to the database and `workspace:check` / `workspace:apply` do not know
about them.

## Guides

- [Agents in Slack](./guides/slack.md) — mention an agent in a channel, it answers in the thread.
- [Email](./guides/email.md) — outbound mail (Resend), the `daily-team-report` and `notify-asks` jobs, and a mailbox per workspace: mail `revenue@…` and the workspace lead answers in a threaded reply.
- [The model-upgrade test](./guides/model-upgrade-test.md) — run one role's eval dataset on today's model and a new release, compare on cost per passed case.
- [Acting from context](./guides/act-from-context.md) — structured page/record context on every turn, the `page_context` tool, `<AskAboutThis>`, opening the surface with intent, recommended-action status streaming back, and the `act-within-bounds` autonomy path.

## Deployment

- [Multiple environments](./deployment/multiple-environments.md)
- [Parent project pattern](./deployment/parent-project-pattern.md)

## Decision records

- [ADR 0001 — LangChain / deepagents](./internal/adr/0001-langchain-deepagents.md)
- [ADR 0002 — context execution interface](./internal/adr/0002-context-execution-interface.md)
- [ADR 0003 — skill, playbook, operation](./internal/adr/0003-skill-playbook-operation.md)

Internal working notes (roadmap, changelog, use cases) live in
[`internal/`](./internal/).
