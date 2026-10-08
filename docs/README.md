# Vocion docs

## Start here

- [**Product Design Manifesto**](./DESIGN-PRINCIPLES.md) — why Vocion exists and the bar every product decision is held to: outcomes over activity, accountability with an owner, automation that is earned, complexity hidden without hiding the truth. Ends with the twelve-question test.
- [**Getting started in a new workspace**](./guides/getting-started-in-a-workspace.md) — what a person meets first: the workspace lead core seeds into every new shared workspace, its one-sentence introduction and three starters, the short interview, the setup plan as one-click cards that run as the person's own action with Undo, and the sidebar's Getting started · N of 4 checklist read from what is really there.
- [**Getting started — build an agent workforce from zero**](./getting-started.md) — the tutorial. Explains the configuration-driven model, then builds a complete workforce file by file, with a worked example of every entity type. Read this first.
- [**Workspaces (workspace-as-code)**](./workspace.md) — what a workspace is, how to create one, how to author and apply changes, and how base packs layer underneath.
- [**Plugins — capability you turn on**](./plugins.md) — `plugins: [wiki, data-rooms, proposals]`: a directory of agents, skills, pages, missions, automations, teams and trust rules that composes under the workspace like the base pack; the Plugins page and the chat both switch one on; how the three shipped plugins are built and how to write one.
- [**Company — a company function stood up in one move**](./apps/company.md) — the Company app: pick a template (Software Company, Marketing Agency, Support Org), answer two or three questions, and the workspace gets the teams, measures, missions, automations, trust rules and budgets that function runs on, with you accountable; how templates are built and what an install guarantees.
- [**Entity reference**](#entity-reference) — every authored file type, field by field.
- [**Where an agent turn runs**](./agent-execution.md) — the loop, the model, and the AWS account, kept apart. Read it before touching `harness.runsOn`, `harness.modelProvider`, or anything named AgentCore. Includes what the `provider` → `runsOn` rename changes for an existing workspace (nothing, unless you want it to).
- [**Object model**](./object-model.md) — the lookup table: where each object is authored, its schema symbol, its table, its runtime, its UI surface. Includes runtime-only objects (tool calls, runs, events).
- [**Artifacts — one live thing beside the conversation**](./artifacts.md) — `render_*` / `read_artifact` / `update_artifact`, the `artifact` + `artifact_version` tables, the pane a person and an agent both edit, the version rules (restore never rewrites, human saves collapse), the log at `/dashboard/artifacts`, and exporting one as a workspace page.
- [**Routing — the workspace in the URL**](./routing.md) — why `/w/<slug>/…` exists, what the entry route does, and the phase-2 design for `/{account}/{workspace}/…` as the canonical URL.
- [**Dashboard patterns — List, Detail, Ledger**](./design/patterns.md) — the UI pattern library every dashboard page composes from: which archetype for which page, anatomy, do/don't, and the migration checklist for the remaining pages.
- [**The API reference — generated from the handlers**](./api-reference.md) — how the OpenAPI document is read out of `/api/v1`, how to regenerate it, and how to write a route's doc comment so it reads well.
- [**Review operations in the base pack**](./review-ops.md) — the review-queue agents and approval-drafting skills that ship in `core@2.1.0`, how to activate them, and how to override one.

## Dashboard map

The sidebar has two views, both derived from one registry
(`packages/core/src/features/navigation/dashboardNav.ts` — groups, order, labels,
icons, admin gating; the ⌘K palette and the breadcrumb read the same list).

| View | Section | Pages |
|---|---|---|
| **Work** | Workspace | Chat `/dashboard/chat` · Needs you `/dashboard/inbox` · Briefings `/dashboard/briefings` · Search `/dashboard/search` |
| | Pinned · Pages · surfaces | This person's pins; the workspace's own pages (`/dashboard/p/<slug>`) and saved canvases; surfaces the workspace switched on |
| **Manage** | Team | Teams & agents `/dashboard/teams` (tabs: Agents `/dashboard/agents`, Hire an agent `/dashboard/hire`; `/dashboard/marketplace` 308s there) · Missions `/dashboard/missions` · Workflows `/dashboard/workflows` · Automations `/dashboard/automation` |
| | Knowledge | Connectors `/dashboard/connectors` · Objects `/dashboard/objects` · Learnings `/dashboard/learnings` · Context `/dashboard/workspace` |
| | Build | Skills & tools `/dashboard/skills` (tabs: Tools `/dashboard/tools` — every tool the workspace's agents can reach, by family: built-ins, records, each connected source, each REST source with its reads and writes, who holds each and whether it can run; Vision models `/dashboard/models`) · Evals `/dashboard/evals` · Apps `/dashboard/apps` (one card per app; each app's page has its features as On/Off switches; `/dashboard/plugins` and `/dashboard/marketplace/plugins` 308 here) |
| | Insights | Team report `/dashboard/team-report` · Activity `/dashboard/activity` · Observability `/dashboard/observability` · Autonomy `/dashboard/autonomy` · Adoption `/dashboard/adoption` (admins) |
| | Organization | Members `/dashboard/members` · Developers `/dashboard/developers` (MCP + REST endpoints, API credentials, docs) · System `/dashboard/admin` |
| **You** | avatar menu | Profile `/dashboard/profile` |

Old URLs redirect: `/dashboard/api-tokens` → Developers; `/dashboard/sources` →
Connectors; `/dashboard/logs` → Activity; `/dashboard/playbooks` → Skills.

## Entity reference

One page per authored entity type. Each page lists every field with its type,
default, and effect, plus a worked example and the rules the loader enforces.

| Entity | Authored at | What it is |
|---|---|---|
| [Workspace manifest](./entities/workspace-manifest.md) | `workspace.yaml` | The workspace's identity, defaults, lead, surfaces, plugins, and base-pack pin |
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

- [Getting started in a new workspace](./guides/getting-started-in-a-workspace.md) — the seeded workspace lead, the setup interview, `setup_options` / `propose_setup` and the `setup` card, `app.install` and `members.invite`, and the Getting started checklist.
- [Sign in with Google or Microsoft](./guides/sign-in-with-google-or-microsoft.md) — "Continue with Google", "Continue with Microsoft" (work or school accounts) and emailed sign-in links, all still invite-only: the settings, the redirect URIs to register (`/api/auth/callback/google`, `/api/auth/callback/microsoft-entra-id`), setup in the Google Cloud console and an Entra app registration, exactly which address each provider is trusted for, and linking or unlinking from the profile.
- [Agents in Slack](./guides/slack.md) — mention an agent in a channel, it answers in the thread.
- [Extensions](./guides/extensions.md) — how a deployment builds in `@vocion/enterprise`, and the neutral seams it adds through (budget guard and observer, `ext` routes and pages, slots, the Org policy hook).
- [GitHub as an event source](./guides/github.md) — pull requests, checks, reviews, merges and failed deploy runs on the repositories a workspace lists become `pr.*` and `run.failed` events automations act on; the read-only token and its permissions, the payload shapes, dedupe keys that make a re-poll idempotent, the optional webhook at `/api/webhooks/github`, and an example `when: { event: pr.checks_completed, filter: { conclusion: failure } }`.
- [Team threads](./guides/team-threads.md) — a lead puts one question to its specialists together: they post in rounds and answer each other, it ends on a settle rule (the lead's word, every member complete, the round or budget cap), the lead writes the outcome, and the whole thread is one run with its cost. Opened by `open_team_thread` or the `team-thread` job; works on both loops.
- [Team performance](./guides/team-performance.md) — the measurement model behind `/dashboard/team-report`: measures with provenance (verified · observed · human-confirmed · agent-reported), what Vocion derives (attainment, trend, cost per outcome, human load), the setup state, evidence chains and outcome lineage.
- [Any REST API as a live source](./guides/rest.md) — declare a token-authenticated API's endpoints (Bearer by default, or the header and scheme the API asks for) in `sources/<slug>.yaml` with `kind: rest`: each read becomes a live agent tool (`<prefix>_<name>`), each write is proposed through the `rest.request` action onto the review queue, and `trust.yaml` grants autonomy one endpoint at a time (`rest.request.<source>.<action>`). The YAML contract, the templating rules, the input-schema subset, and what every failure reads as.
- [QuickBooks Online as a knowledge source](./guides/quickbooks.md) — a company's accounts, invoices, bills, payments and journal entries as read-only documents, one per record with its numbers on metadata; log in once per company (no key to paste, since Intuit rotates the refresh token), or turn on sample data to try it with a fictional company and no login.
- [PostHog as a knowledge source](./guides/posthog.md) — one document per day of event counts, unique users, totals and error counts from a PostHog project, read with `search_knowledge` and summed with `posthog_event_counts`; the personal-key-not-project-token rule, what is and is not stored (aggregates only), and how the day window and checkpoint work.
- [Web analytics as a measure source](./guides/web-analytics-measures.md) — read qualified traffic, users, conversions and signups from GA4 so an adoption number carries a **verified** chip instead of an agent's own count; the service-account role it needs, and why an unconfigured measure shows "not connected" rather than 0.
- [Email](./guides/email.md) — outbound mail (Resend), the `daily-team-report` and `notify-asks` jobs, and a mailbox per workspace: mail `revenue@…` and the workspace lead answers in a threaded reply.
- [Evals in Vocion](./guides/evals.md) — **start here.** What an eval is, the four kinds of test you can run and when to reach for each, a worked tutorial graded first by Vocion and then by AWS, how the grader plugs in so a third one could be added, where to read the results, and what to do when a number looks wrong.
- [Evals graded by AWS AgentCore](./guides/agentcore-evals.md) — point a dataset at Amazon Bedrock AgentCore instead of Vocion's own judge: the IAM key it needs, the workspace YAML, which ground truth each evaluator level accepts, what costs tokens and what does not, and what AWS's refusal messages actually mean.
- [Prompt caching](./guides/prompt-caching.md) — **nothing to configure; it is on.** The prefix of every agent turn is cached at the vendor by default: what that saves (measured at 7.2x on a warm turn; a cache read is 10% of the input rate **and** does not count toward the Bedrock tokens-per-day quota), the per-model minimum below which a prompt is ignored rather than charged, the one case where turning it off is worth it (an agent called less often than once every five minutes), how to read cache counts in Langfuse and CloudWatch, and the three levels of off switch.
- [The model-upgrade test](./guides/model-upgrade-test.md) — run one role's eval dataset on today's model and a new release, compare on cost per passed case.
- [The weekly org review](./guides/org-review.md) — once a week the team looks at itself: idle agents, spend that is not paying, corrections people keep making, teams behind on their measure. Each finding is filed on Needs you as an `org.change` proposal (retire, re-scope a budget, hire, adopt a standing rule) with its evidence, waiting for a person, with Undo; and the rulebook is compacted — near-duplicates merged with their counts kept, unused and contradicted rules retired, never deleted. `defaults.orgReview` sets the cadence and thresholds.
- [Needs you — the one decision surface](./guides/needs-you.md) — every kind of thing waiting on a person (proposals, asks, stopped runs, suggested rules) in one list; the detail by kind, the verbs and keys, and how each decision feeds learning and autonomy. `/dashboard/review` forwards here.
- [Acting from context](./guides/act-from-context.md) — structured page/record context on every turn, the `page_context` tool, `<AskAboutThis>`, opening the surface with intent, recommended-action status streaming back, and the `act-within-bounds` autonomy path.
- [Agent tools that write](./guides/agent-tools.md) — every tool an agent has that changes something, and the action it rides: `propose_action` for connector writes, `file_ask` / `withdraw_ask` for a question to a person, `update_object` for a record's fields, the self-improvement tools; how each is gated, undone and switched off per agent.

## Deployment

- [Multiple environments](./deployment/multiple-environments.md)
- [Parent project pattern](./deployment/parent-project-pattern.md)

## Decision records

- [ADR 0001 — LangChain / deepagents](./internal/adr/0001-langchain-deepagents.md)
- [ADR 0002 — context execution interface](./internal/adr/0002-context-execution-interface.md)
- [ADR 0003 — skill, playbook, operation](./internal/adr/0003-skill-playbook-operation.md)

Internal working notes (roadmap, changelog, use cases) live in
[`internal/`](./internal/).
