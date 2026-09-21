# Workspace manifest — `workspace.yaml`

The one required file in a workspace. It names the workspace, says which
organization owns it, sets the defaults every agent inherits, and declares
which base pack (if any) the workspace builds on.

| | |
|---|---|
| **Path** | `workspace.yaml` (or `workspace.yml`) at the workspace root |
| **Schema** | `WorkspaceManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `project` (lead, goal, surfaces, plugins, mailbox) + a `workspace_version` audit row. Never the pause columns — see [the off switch](#the-off-switch--pausing-the-whole-workspace) |
| **Layering** | Not composable — the manifest is always the workspace's own |

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `version` | `1` | yes | Manifest format version. Only `1` is valid. |
| `orgId` | string | yes | Id of the project (tenant) the workspace belongs to — auth.js (next-auth v5) session/org scoping, not Clerk. Templates ship a placeholder; `workspace:apply --project` resolves it to the live project. |
| `name` | string | yes | Display name of the workspace. |
| `description` | string | no | One-paragraph summary, shown in the dashboard. |
| `lead` | slug | no | The workspace lead agent — the one that runs the whole workspace and consults the team leads. Applied to `project.leadAgentSlug`. Omit for no lead. |
| `accountableUser` | email | no | Workspace-default accountable human. Resolved to a user id at apply and stored on `project.accountableUserId`. Teams without their own `accountableUser` inherit this at read time. |
| `goal` | string | no | The workspace's top-line goal, one sentence. Stored on `project.goal`; the team report anchors every team's spend share and KPI progress under it. |
| `mailbox` | object | no | Email as a chat surface. `mailbox: { enabled: true }` gives the workspace `<slug>@<VOCION_MAIL_DOMAIN>`; `address:` names one on that domain instead. Mail to it is answered by the workspace lead and threads into a conversation (`surface = email`); unknown senders become an `ask`. Stored on `project.mailboxAddress` / `mailboxEnabled`. Errors at apply if the deployment has no `VOCION_MAIL_DOMAIN` or the address is off it. See [the email guide](../guides/email.md). |
| `defaults.model` | string | no | Model every agent falls back to. |
| `defaults.temperature` | string | no | Temperature every agent falls back to. |
| `defaults.learningEagerness` | integer 0–10 | no (default `7`) | How eager this workspace is to improve itself. Moves the confidence bar for the class of actions that change what the system knows about how to work — today, adopting a rule from a correction a person made to an agent's work (`learning.adopt_rule`). `0` always asks; `7` puts the bar at 72%; `10` at 60%. It moves the bar, never the confidence, so a rule the model had to infer still asks at `10`. A trust rule naming `autoApproveAbove` for a kind wins over the dial for that kind. Stored on `project.learning_eagerness`. See [earned autonomy](../guides/earned-autonomy.md). |
| `plugins` | string[] | no (default `[]`) | Plugins to turn on, by slug (`packages/core/templates/plugins/<slug>/`). Each is a bundle of agents, skills, object types, missions, automations, teams, pages and trust rules that composes under the workspace like the base pack — always active, overridable by slug with `extends: core`, suppressible with `disable:`. Dependencies (`depends:` in `plugin.yaml`) load first. The resolved list lands on `project.enabled_plugins`; a plugin's `surfaces` join `surfaces` below. See [`docs/plugins.md`](../plugins.md). |
| `surfaces` | string[] | no (default `[]`) | Optional dashboard surfaces to switch on, by registry id. Today: `personalization`, `discovery` (see `packages/core/src/features/navigation/surfaces.ts`). An unknown id fails the load. |
| `extends` | string | no | Base-pack pin, e.g. `core@2.1.0`, or bare `core` to track the pack's current version. Omit for no base layer at all. |
| `use` | `all` \| selector | no | Which base-pack defaults to activate. See [base pack](./base-pack.md). Omitted while `extends` is set means activate nothing. |
| `disable` | selector | no | Suppress a base default even under `use: all`. |

A selector is `{agents: [...], skills: [...], playbooks: [...]}`; every key is optional.

## Example

```yaml
version: 1
orgId: proj_meridian_revenue
name: Meridian Outdoor — Revenue
description: >-
  Revenue workspace for Meridian Outdoor Supply. Four teams under one
  workspace lead.
lead: revenue-director
accountableUser: ops@meridian.example
goal: Every open deal has a next step, and the team is never surprised by its pipeline.
mailbox:
  enabled: true # → meridian-revenue@<VOCION_MAIL_DOMAIN>, answered by revenue-director
defaults:
  model: gpt-5.4-mini
  temperature: '0.3'
  learningEagerness: 9 # keener than the default 7 to adopt what people correct
surfaces: [discovery]
extends: core@2.1.0
use:
  agents: [revenue-director, proposal-writer]
  skills: [lead-triage]
disable:
  playbooks: [warming-etiquette]
```

## Folder layout — `wiki/`, pages seeded from the repo

Beside the manifest, a workspace may carry the first pages of its wiki as
files, so the wiki starts from what the repo already says rather than from an
agent imagining it. Each file becomes — or refreshes — the markdown artifact
with the same slug in the org's `wiki` folder on `workspace:apply`, through
the normal artifact save: versions, restore and undo work, every agent's
context mounts it next turn, and the wiki plugin's `index-artifact`
automation indexes it for search. The wiki plugin gives the pages their
meaning (`packages/core/templates/plugins/wiki/README.md`); the seeding is
core (`libs/workspace/wiki-pages.ts`, `services/wiki/WikiSeedService.ts`).

```
<workspace-dir>/
└── wiki/
    ├── voice.md            # → wiki page `voice`
    ├── who-is-who.md       # → wiki page `who-is-who`
    └── index.md            # optional — seeded like any page; generated from the others when absent
```

**The file.** `wiki/<slug>.md`, top level only. The slug is the filename:
lowercase letters, digits and dashes, starting with a letter (`who-is-who`,
not `who_is_who` or `Who-Is-Who`). YAML frontmatter, then the page:

```markdown
---
title: Who is who            # required
summary: Agents, teams, the accountable humans and who leads what.   # optional, ≤ 200 chars — the index line; the first paragraph otherwise
order: 20                    # optional number — sorts the generated index; unordered pages come last, A–Z
tags: [people, teams]        # optional
managed: true                # optional, default true — see below
---
The page body, as markdown. No `#` title line: the title renders above the body.

## Agents
…
```

Unknown frontmatter keys fail the load, so a typo cannot be dropped in
silence; a missing `title` or an empty body fails it too. Files are read
**as written** — no `{{env.NAME}}` substitution, because a wiki page may well
document that syntax. Files other than `*.md`, and subdirectories, are left
alone.

**What an apply does with each file**

| The page… | The apply… |
|---|---|
| does not exist yet | creates it, author `system` (the seed), version 1 |
| exists and the file is unchanged since the last seed | leaves it (`unchanged`) |
| exists, the file changed, and nobody has edited the page in the app since the last seed | writes a new version with the file's content (`updated`) — undo is one click, as for any version |
| exists and **someone edited it in the app** since the last seed | **keeps** it (`kept`) and warns, naming the page: *edit the file to match the page, or set `managed: false` to stop seeding it* |
| has `managed: false` | is seeded once, if absent, and never touched again |

"Edited since the last seed" is exact: the seed records the artifact version it
wrote (`spec.seed.version`, beside `sha`, `path` and `appliedAt`), and the page
is still the seed's only while that version is the head — a person's Save, an
agent's `write_wiki_page` or a Restore all move it. A page that predates
seeding (no `seed` block) is the seed's only while its last author is `system`.

**Deleting a file does not delete the page.** Pages are what people read and
cite, so removing one is a person's call from the Wiki page. The apply warns
once that the page is orphaned — recorded as a `system` version whose change
summary names the removal, so the history says why — and then stays quiet. A
page someone edited in the app is theirs already; its file going away is no
warning at all.

**The index.** Unless `wiki/index.md` is itself seeded, the apply generates the
`index` page from every seeded page's `order`, `title` and `summary` and
refreshes it whenever any of them changes. Agents see it at the top of the
mounted `/wiki/index.md`, followed by the full listing with freshness and
author. Edit the generated index in the app and it is kept like any other
page; seed your own `wiki/index.md` to take it over.

**Dry run** (`workspace:check`, `workspace_diff`, the drift banner) validates
every file and reports what it would create, update, keep or leave — without
writing. With no database answering it reports the count as `unknown`, per
the rest of the dry run.

**The summary line.** `workspace:apply` prints
`wikiPages  created=… updated=… unchanged=… kept(human-edited)=…`; the same
counts land on the `workspace_version` row and in `workspace_apply` over MCP.

## The off switch — pausing the whole workspace

A workspace has one control that stops everything it does by itself, and it
is **not** authored in `workspace.yaml`. It is an operator's act, held on the
`project` row (`paused_at`, `paused_by`, `paused_note`, migration 0132) and
never written by an apply — the same shape, and the same rule, as an
[automation's pause](./automation.md#pausing-and-resuming).

Real work demanded it on 2026-09-21: stopping the Squatch factory meant
twenty `POST /api/v1/automations/:slug/pause` calls, typed by hand, by
someone who had to know every slug first. They worked, and they still left
mission runs, worker runs and gated actions going.

| | |
|---|---|
| **Who can** | An owner or PM (dashboard admin). Any member may pause one automation; holding the whole workspace is heavier, so it is admin-gated. |
| **Where it is** | The top bar, on **every** authenticated page: *Pause workspace*, one click from wherever a person is, labelled at phone width too. Not on `/dashboard/workspace` — that is the Context map, an overview someone opens on purpose, and a stop nobody can find is not a stop. |
| **What is recorded** | `paused_at`, `paused_by` (the `user.id`, or `token:<id>` when an API token placed it) and `paused_note` on the project row. The note is **required** everywhere: it is the line everyone else reads on every page until the hold is lifted. |
| **What is shown** | A banner across the top of every page in the workspace: "This workspace is paused. *note*" and "Paused by *name* *when*", plus what is refused and what is still running. A Resume button beside it for an admin; everyone else reads the name and knows who to ask. |
| **Surface** | `client.workspace.pauseState()` / `.pause({ note })` / `.resume()`. A pause on a paused workspace (or a resume on a running one) answers `CONFLICT` — the state on screen is stale. |
| **Over the API** | `POST /api/v1/workspace/pause` `{ note }` and `POST /api/v1/workspace/resume`. Owner or PM (a `['*']` grant passes). 409 (`WORKSPACE_STATE`) when the state already is what was asked. `GET /api/v1/workspace` reads `paused`, plus `refuses` and `allows` so a client's copy of the list cannot drift from the guard's. |
| **Over MCP** | `workspace_pause { note }` and `workspace_resume` — the same service path, the row naming the MCP identity. |

### What it refuses

One guard, `services/workspacePause.ts` → `assertWorkspaceRunning`, asked by
four callers and no others. Every refusal happens **before any model call**,
so a stopped workspace spends nothing.

| Refused | Where the guard is asked | What the caller sees |
|---|---|---|
| Every automation fire, scheduled or event | `beginAutomationFire`, and `emitEvent` before it dispatches | A `skipped` `automation_run`, `reason: workspace_paused`, carrying the note — so "why did nothing run all afternoon" is answered from the run log rather than from nowhere |
| Starting a mission run — API, MCP `mission_start`, chat, an automation's check | `startMission`, before the planner | `WORKSPACE_PAUSED` with the note |
| Queueing or claiming a worker run | `createWorkerRun` and `claimWorkerRun` | `WORKSPACE_PAUSED`. The claim is the half that matters: the Fargate worker polls, so refusing it is what stops work starting on runs queued before the switch |
| Executing a gated action | `ActionService.executeAction` | `WORKSPACE_PAUSED`, with the `action_run` left exactly where the approver left it |

### What it allows, and why

**Chat with an agent stays available. This is the judgement call.** A person
talking is not the factory working, and the first thing anyone does after
pulling the switch is ask what just happened — so taking chat away would take
away the tool for understanding the thing that made them stop. If that turn
then tries to start a mission, queue a worker run or execute a gated action,
the guard refuses it with the pause note: the refusal lands where the work
would have started, not on the conversation.

**A worker already mid-run is not killed.** It finishes, heartbeats, and
reports; `heartbeat`, `complete` and `fail` stay open to a worker holding a
lease. Its completion events are still written to `event_log` — a completion
that happened happened — and they raise **no** automation, because the fire
is what a pause refuses.

**A hand-off action is still released.** `libs/actions/manual.ts` kinds — a
merge, a deploy, a credential — execute nothing; they hand a person a list of
steps. A person working by hand is not the factory.

### What it does not touch

**Per-automation pauses.** A workspace pause writes to no automation row, so
resuming restores exactly what was there before: two debriefs someone paused
last week are still paused, and nothing else is. Nothing is snapshotted on the
way in, which is precisely why nothing can be lost on the way out. That is the
reason this is a separate fact rather than a bulk edit of every automation —
there is no honest way to tell the ones a blanket stop paused from the ones a
person paused for their own reasons.

**An apply.** `workspace:apply` names every project column it writes and the
three pause columns are not among them. A deploy does not lift a person's
stop, the same rule #494 set for automations.

## Rules

- `surfaces` entries must be ids this core registers; unknown ids fail `workspace:check` with the list of valid ids.
- `lead` must name an agent in this workspace.
- `use` naming a slug the pinned pack does not ship is a hard error.
- The pinned pack version is appended to `workspace_sha` (`<sha>+core@2.1.0`), so the same files on two pack versions stay distinguishable.

## Related

[Base pack](./base-pack.md) · [Agent](./agent.md) · [Team](./team.md) · [authoring guide](../workspace.md)
