# Team — `teams/<slug>.yaml`

A team groups agents under a lead and names the human accountable for its work.
Teams are how the dashboard organizes a workspace, and how a lead knows which
specialists it can hand work to.

| | |
|---|---|
| **Path** | `teams/<slug>.yaml` — **the filename is the slug** |
| **Schema** | `TeamManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `team` table |
| **Runtime** | Lead consultation merge in the harness |
| **Surface** | `/dashboard/teams` (org chart) · `/dashboard/team-report` (runs, spend, KPI progress) |
| **Layering** | Workspace-only — a base pack ships no teams |

There is no `slug:` field. The slug comes from the filename, so a team can
never disagree with its own path: `teams/revenue-ops.yaml` is `revenue-ops`.

Teams are flat by construction — no `parent` field here, and no parent column in
the `team` table.

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `name` | string | yes | Display name. |
| `description` | string | no | What the team is responsible for. |
| `lead` | slug | no | The agent leading this team. A team may exist before its lead is chosen — it renders as "no lead yet". |
| `accountableUser` | email | no | The accountable human. Resolved to a user id at apply. Omit to inherit `accountableUser` from `workspace.yaml`. |
| `goal` | string | no | The team's standing goal, one sentence. Shown at the top of the team's section on the team report, under the workspace's `goal:`. |
| `kpis` | kpi[] | no (default `[]`) | The measures the team is graded on. Each reads a `worker_run.counts` key summed over the team's agents; progress is computed at read time, never stored. Keys are unique within a team. |

Each KPI:

| Field | Type | Required | What it does |
|---|---|---|---|
| `key` | slug | yes | Stable id, e.g. `prs_merged`. |
| `label` | string | yes | What a person reads, e.g. "Merged PRs". |
| `target` | number > 0 | yes | The reading that counts as done. |
| `baseline` | number ≥ 0, < target | no | Where the reading stood when the contract was set. Progress is measured from here rather than from zero. |
| `unit` | string | no | Suffix after the reading, e.g. `PRs`. |
| `source` | `counts.<key>` | yes | Which `worker_run.counts` key is summed. A worker reports counts on heartbeat and complete; whatever key it reports can be a KPI. |
| `window` | `24h` \| `7d` \| `all` | no (default `all`) | How far back the sum reaches. A KPI reads its own window regardless of the window the report page is showing. |

Inheritance is resolved at read time and is *not* baked in on export, so the
workspace-level default stays the single place to change it.

## Example

```yaml
name: RevOps
description: >-
  Pipeline health, follow-ups, and revenue insight — keeps the funnel honest
  and flags anything going stale.
lead: revenue-lead
```

With a goal and KPIs — an engineering team whose workers report `prs_opened`
and `prs_merged` in their run counts:

```yaml
name: Engineering
description: Framework, docs-site and demo engineering — PR only, tests green.
lead: core-engineer
goal: Merged-quality PRs that a demo or article needs, never a push to main.
kpis:
  - key: prs_merged
    label: Merged PRs
    baseline: 3
    target: 8
    unit: PRs
    source: counts.prs_merged
  - key: prs_today
    label: PRs opened today
    target: 2
    source: counts.prs_opened
    window: 24h
```

## Outcome contract

The team report (`/dashboard/team-report`) presents every team and member as the
outcome contract the [Product Design Manifesto](../MANIFESTO.md) asks for —
*Outcome → Accountability → Measurement → Learning → Automation → Capability* —
and reads each field from what the workspace already authors:

| Contract field | Read from |
|---|---|
| Purpose | `goal` (falling back to `description`); an agent's `description` |
| Owner | `accountableUser`, or the workspace default, with its provenance |
| KPI · Baseline · Target · Current performance | `kpis[]` — the reading is the sum of `worker_run.counts.<key>` over the team's agents in the KPI's window |
| Permissions | the agents' `approvalPolicy` keys (empty = every outward action waits for a person) and the org's enabled trust rules |
| Autonomy | per action kind the team's agents have had decided in the last 30 days: its rung on the [autonomy ladder](../guides/earned-autonomy.md) and the agreement rate behind it (`decision_alignment`, `autonomy_policy`, `trust_rule`) |
| Escalation | not modeled yet — the report points at the inbox |

Activity — runs, tokens, spend — is the evidence layer beneath the contract,
collapsed by default. Spend weight is always shown beside outcome share (a
member's part of the team's KPI readings), so "is this member worth its share
of the spend" is answerable from the page. Board reviews and red-team grades are
counted as judgement spend, not output.

## Rules

- The filename must be a valid slug: lowercase, starts with a letter, letters/numbers/dashes/underscores.
- Slugs are unique across teams.
- `lead` must name an agent in this workspace.
- An agent's `team:` must name a team file — validated whenever the workspace defines any teams. A workspace with no `teams/` directory keeps the older free-text label behavior.
- An agent that leads a team must belong to that team. Either author the matching `team:` or omit it and let apply assign it.
- `kpis[].source` must be `counts.<key>`; a KPI on tokens or cents is not a KPI — spend is reported on its own on the team report.

## Related

[Agent](./agent.md) · [Workspace manifest](./workspace-manifest.md) · [Worker run](./worker-run.md)
