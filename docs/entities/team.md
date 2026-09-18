# Team — `teams/<slug>.yaml`

A team groups agents under a lead and names the human accountable for its work.
Teams are how the dashboard organizes a workspace, how a lead knows which
specialists it can hand work to, and the unit the team report grades.

| | |
|---|---|
| **Path** | `teams/<slug>.yaml` — **the filename is the slug** |
| **Schema** | `TeamManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `team` table |
| **Runtime** | Lead consultation merge in the harness |
| **Surface** | `/dashboard/teams` (org chart) · `/dashboard/team-report` (team performance) |
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
| `lead` | slug | no | The agent leading this team — the **AI team lead**. A team may exist before its lead is chosen (rendered "no lead yet"). |
| `accountableUser` | email | no | The **accountable owner** — the human. Resolved to a user id at apply. Omit to inherit `accountableUser` from `workspace.yaml`. |
| `goal` | string | no | The team's **mission**, one sentence. Shown under the team's name on the team report, beneath the workspace's `goal:`. |
| `measures` | measure[] | no (default `[]`) | What the team is graded on, each with a target and a **source** saying where the reading comes from. Keys are unique within a team. Readings are computed at report time, never stored. |
| `kpis` | kpi[] | deprecated | Alias for one release. Each entry is read as an `agent-reported` measure (its `all` window becomes `quarter`). Export writes `measures:`. |

## Measures

Every measure declares; Vocion derives attainment, trend, cost per outcome and
the rest ([Team performance](../guides/team-performance.md)).

| Field | Type | Required | What it does |
|---|---|---|---|
| `key` | slug | yes | Stable id, e.g. `qualified_referrals`. |
| `label` | string | yes | What a person reads, e.g. "Qualified referrals". |
| `dimension` | `outcome` \| `quality` \| `velocity` \| `economics` | no (default `outcome`) | Which of the four questions this answers. The first `outcome` measure is the team's **primary outcome** and leads its section. |
| `target` | number > 0 | yes | The reading that counts as on target, in the window. |
| `baseline` | number ≥ 0 | no | Where the reading stood when the contract was set. Attainment is measured from here. Must sit on the far side of `target` from the direction of improvement. |
| `unit` | string | no | Suffix after the reading: `referrals`, `%`, `$`, `min`. `$` and `%` format as money and percentage. |
| `window` | `24h` \| `7d` \| `30d` \| `quarter` | no (default `7d`) | How far back the reading reaches. A measure reads its own window whatever the report page is showing; the trend compares against the window before. |
| `direction` | `higher` \| `lower` | no (default `higher`) | Whether more or less is better (a turnaround time is `lower`). |
| `source` | source | yes | Where the reading comes from — see below. |
| `contributesTo` | `workspace-goal` | no | Opt this measure into the workspace goal-progress figure. |
| `weight` | number > 0 | with `contributesTo` | Its share of the goal. Goal progress is Σ weight × attainment / Σ weight; heterogeneous units are never summed. |

### Sources — measurement provenance

| `kind` | Fields | Reading |
|---|---|---|
| `verified` | `connector: hubspot`, `query: { object: deals \| contacts \| companies, filter: {…}, aggregate: count \| sum(amount) }` | A query against the synced HubSpot mirror: records created in the window matching the filter (`dealStages`, `pipelines`, `dealStatus`, `lifecycleStages`, `industries`, `ownerIds`). Carries the mirror's freshness — "verified (synced 25m ago)". |
| `verified` | `connector: web-analytics`, `query: { metric: sessions \| users \| conversions \| signups, filter: { pathPrefix?, channel?, event? } }` | A report the analytics provider runs over the window. Needs a **Google Analytics** credential on the workspace; with none, the measure reads "not connected" and shows nothing — never 0. See [wiring web analytics](../guides/web-analytics-measures.md). |
| `observed` | `actions: [gmail.send, …]`, `counts: <key>` **or** `rows: workspace-members` | Vocion saw it happen in our own tables: `action_run` rows that reached `done` for those action ids, completed `worker_run`s carrying that `counts` key, or `account_membership` rows created in the window for the account that owns this workspace. Exactly one of the three. |
| `human-confirmed` | `actions: […]` and/or `askKinds: [ruling, approval, …]` | A person approved it: approve / edit decisions on those action ids, and asks of those kinds decided with anything but a reject. |
| `agent-reported` | `counts: <key>` | Σ `worker_run.counts.<key>` over the team's agents. The worker grades itself — the report labels it as the weakest kind. |

## Example

```yaml
name: Founder GTM
description: Founder-led outreach into the network.
lead: gtm-lead
accountableUser: lili@example.com
goal: Turn the founder network and event activity into qualified introductions.
measures:
  - key: qualified_referrals
    label: Qualified referrals
    target: 10
    unit: referrals
    source:
      kind: human-confirmed
      actions: [gmail.send]
    contributesTo: workspace-goal
    weight: 0.4
  - key: accepted_clean
    label: Accepted without edit
    dimension: quality
    target: 0.9
    unit: '%'
    source:
      kind: observed
      actions: [gmail.send]
  - key: pipeline
    label: Qualified pipeline created
    dimension: economics
    target: 400000
    unit: $
    window: quarter
    source:
      kind: verified
      connector: hubspot
      query:
        object: deals
        filter: {dealStages: [Qualified]}
        aggregate: sum(amount)
  - key: qualified_traffic
    label: Qualified sessions on the docs
    target: 500
    unit: sessions
    window: 30d
    source:
      kind: verified
      connector: web-analytics
      query:
        metric: sessions
        filter: {pathPrefix: /docs, channel: Organic Search}
  - key: signups
    label: Signups
    target: 20
    window: 30d
    source:
      kind: observed
      rows: workspace-members
```

## Outcome contract

The team report (`/dashboard/team-report`) presents every team as the outcome
contract the [Product Design Manifesto](../DESIGN-PRINCIPLES.md) asks for — *Outcome →
Accountability → Measurement → Learning → Automation → Capability* — and reads
each field from what the workspace already authors:

| Contract field | Read from |
|---|---|
| Mission | `goal` (falling back to `description`) |
| Accountable owner | `accountableUser`, or the workspace default, with its provenance |
| Primary outcome · Target · Baseline · Current performance | `measures[]` — each read from its `source`, with provenance |
| Quality · Velocity · Economics | a declared measure of that dimension, else derived: approved-without-edit rate, median turnaround, cost per outcome |
| Human load | derived: interventions, decision latency, intervention rate, autonomous completion rate, escalation rate, blocked time |
| Control | the agents' `approvalPolicy` keys and the rung each action kind stands on ([autonomy ladder](../guides/earned-autonomy.md)), collapsed into one line |
| Needs you | what is waiting on a person right now, with the oldest age |
| Roster · AI team lead | the agents whose `team:` is this team; `lead` |

Activity — runs, tokens, spend by member — is the evidence layer beneath the
contract, collapsed by default, with one chain per executed action: action ·
human decision · what the CRM shows now · cost. Board reviews and red-team
grades are counted as judgement spend, not output.

## Rules

- The filename must be a valid slug: lowercase, starts with a letter, letters/numbers/dashes/underscores.
- Slugs are unique across teams.
- `lead` must name an agent in this workspace.
- An agent's `team:` must name a team file — validated whenever the workspace defines any teams. A workspace with no `teams/` directory keeps the older free-text label behavior.
- An agent that leads a team must belong to that team. Either author the matching `team:` or omit it and let apply assign it.
- Measure keys are unique within a team, across `measures:` and the `kpis:` alias.
- A measure on tokens or cents is not a measure — operating cost is reported on its own.

## Related

[Agent](./agent.md) · [Workspace manifest](./workspace-manifest.md) · [Worker run](./worker-run.md) · [Team performance](../guides/team-performance.md)
