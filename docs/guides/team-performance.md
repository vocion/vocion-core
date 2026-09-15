# Team performance

> "Vocion should not tell me whether my agents ran. It should tell me whether
> my AI workforce is earning its keep, whether I can trust it, and exactly why
> it believes that." — [the spec](../specs/team-report-v2.md)

`/dashboard/team-report` answers, in about ten seconds: what are my AI teams
supposed to accomplish, are they accomplishing it, what is it costing, how
much human help do they need, and where is something going wrong. This guide
is the model behind the page — what a team declares, where every number comes
from, what Vocion derives, and how a workspace gets from nothing to a report.

The [manifesto](../MANIFESTO.md) principles it serves: #1 outcomes over
activity, #2 if it matters measure it, #3 accountability has an owner, #12
hide complexity never truth, #13 measure the business and the person.

## The model in one line

> **This team exists to cause X, measured by Y, at a target of Z, within these
> quality / cost / risk constraints, with this level of autonomy, accountable
> to this human.**

A team **declares** — in `teams/<slug>.yaml` — its mission, its measures with
targets and sources, and its accountable owner. Vocion **derives** everything
else at report time and stores none of it:

| Declared | Derived |
|---|---|
| Mission · Accountable owner | Goal attainment · Trend vs the prior window |
| Measures: label · dimension · target · baseline · window · direction · **source** | Cost per outcome · Quality rate |
| Autonomy policy · permissions (`trust.yaml`, `approvalPolicy`) | Human interventions · Decision latency · Intervention rate · Autonomous completion rate · Escalation rate · Blocked time |
| Budget caps (`agent_budget`) | Budget variance |
| Roster · AI team lead | Teams on target · Goal progress (normalized, opt-in) |

## Measures and provenance

A measure is one thing the team is graded on. The four dimensions are the
four questions a manager asks of any workforce; autonomy is layered over them
and is never itself a performance figure.

| Dimension | Example |
|---|---|
| **outcome** | Qualified referrals · MQLs · Proposal-stage pipeline |
| **quality** | Accepted without material revision |
| **velocity** | Median turnaround |
| **economics** | Cost per completed work item |

Every measure names where its reading comes from. This is the part the spec
calls **measurement provenance**, and the report shows it as a small chip
beside every number. Strongest first:

| Kind | Means | Read from | Chip |
|---|---|---|---|
| `verified` | A system of record says so | HubSpot, through the synced CRM mirror (`CrmRecordsService`). Count or `sum(amount)` of records created in the window that match the filter. Carries the mirror's own freshness: "verified · HubSpot (synced 25m ago)", and says *stale* when the sync is older than its schedule promises. | green |
| `observed` | Vocion saw the action execute | `action_run` rows that reached `done` for the named action ids (approved or auto-executed), or completed `worker_run`s carrying the named `counts` key | neutral |
| `human-confirmed` | A person approved it | approve / edit decisions on the named action ids (the alignment ledger), and asks of the named kinds decided with anything but a reject | neutral |
| `agent-reported` | The worker said so | Σ `worker_run.counts.<key>` over the team's agents | muted, dashed — "the worker reported this; not independently verified" |

The product rule: **agents do the work; systems of record measure the outcome
whenever possible.** An agent-reported count is evidence the worker *claims*
it did the work. It is on the page, honestly labelled, because it is often
the only reading a young workspace has — and it is visibly the weakest.

### Authoring

```yaml
# teams/founder-gtm.yaml
name: Founder GTM
lead: gtm-lead
accountableUser: lili@example.com
goal: Turn the founder network and event activity into qualified introductions.
measures:
  - key: qualified_referrals
    label: Qualified referrals
    target: 10 # in the window
    unit: referrals
    window: 7d # 24h | 7d | 30d | quarter — default 7d
    source:
      kind: human-confirmed
      actions: [gmail.send] # approve/edit decisions on these
    contributesTo: workspace-goal # opt into the normalized goal figure
    weight: 0.4
  - key: pipeline
    label: Qualified pipeline created
    target: 400000
    unit: $
    window: quarter
    source:
      kind: verified
      connector: hubspot
      query:
        object: deals # deals | contacts | companies
        filter: {dealStages: [Qualified]}
        aggregate: sum(amount) # count | sum(amount)
  - key: turnaround
    label: Turnaround
    dimension: velocity
    target: 30
    unit: min
    direction: lower # less is better
    baseline: 240
    source: {kind: agent-reported, counts: turnaround_min}
```

Field reference: [Team](../entities/team.md#measures). The filter keys under
a verified query mirror `CrmFilter` (`dealStages`, `pipelines`, `dealStatus`,
`lifecycleStages`, `industries`, `ownerIds`).

`kpis:` — the previous, worker-reported-only shape — is accepted for one
release and read as `agent-reported` measures. Its `all` window becomes
`quarter`, the longest window a measure is judged in. Export writes
`measures:`; the alias is read, never written.

## What Vocion derives

All of this is in `packages/core/src/services/team-report/` and none of it is
stored. Definitions, so the numbers can be argued with:

| Metric | Definition |
|---|---|
| **Attainment** | 0..1, capped, direction-aware. `higher`: (value − baseline) / (target − baseline). `lower`: 1 at or under target; above it, (baseline − value) / (baseline − target), or target / value with no baseline. |
| **Trend** | value − the same reading over the window immediately before, with an arrow and whether the move is an improvement for the measure's direction. |
| **Cost per outcome** | team operating cents over the **primary measure's own window** / the primary outcome's value in that window — like with like, never a day of spend over a week of outcomes. Null — shown as plain operating cost — when nothing was produced (spend over zero is not a ratio) or nothing was spent (a $0.00 outcome is a gap in the cost record, not a bargain). |
| **Quality rate** | approved without an edit / (approved + edited + rejected). Derived from decisions unless the team declares a `quality` measure. |
| **Velocity** | median (finished − created) over the window's executed actions and completed runs, unless the team declares a `velocity` measure. |
| **Human interventions** | decisions a person took: action approve / edit / reject + asks answered. |
| **Decision latency** | Σ (decided_at − created_at) per decided item, capped at 8h each. Labelled *decision latency*, not review time — nothing records when a person first *looked*, so this is the whole wait. |
| **Intervention rate** | items that needed a person (a proposal that did not auto-execute, an ask, a paused run) / work items (proposals + runs). |
| **Autonomous completion rate** | auto-executed / executed actions. |
| **Auto-completed work** (headline) | work items that needed nobody / work items. |
| **Escalation rate** | asks filed + runs paused or awaiting review / work items. |
| **Blocked time** | Σ (now − created_at) over what is open right now. |
| **Budget variance** | Σ current-period spend / Σ hard caps − 1, over members with a cap. |
| **Teams on target** | teams whose primary outcome is met / teams with a readable primary. |
| **Goal progress** | Σ weight × attainment / Σ weight over measures that declare `contributesTo: workspace-goal` with a `weight`. **Heterogeneous units are never summed** (spec §3); with no opt-in the figure is omitted, not zero. |

The **primary outcome** is a team's first `outcome`-dimension measure (else
its first measure). The **Control** line collapses autonomy and permissions
into one sentence — "Human approval required · 5 action types · 0
auto-execute" — from the action kinds the team's agents have proposed or are
permitted and the rung each stands on ([earned autonomy](./earned-autonomy.md)).

## Setup state

A report full of zeroes makes the product look dead; a checklist makes it
look unfinished, which is the truth. The page shows **Workforce setup** —
four lines and one action — when any of these is missing:

- a workspace outcome (`goal:` in `workspace.yaml`)
- at least one team with a measure
- any completed work, ever

"Ever", deliberately: a configured workforce that was quiet over a weekend
has a quiet report, not a broken one.

**Configure workforce** is a guided form: the workspace outcome, then per
team a mission and one primary outcome measure — label, target, unit, window
and how it is measured. It plans the YAML the workspace-as-code path would
have been given by hand, shows it for review, and:

- **applies it** when this host has the project's workspace folder
  (`WORKSPACE_PATH` / `VOCION_WORKSPACE_MAP`) — writes `workspace.yaml` and
  `teams/<slug>.yaml`, then runs the same `loadWorkspace → applyWorkspace`
  every apply uses; admin only;
- **hands it over to copy** otherwise, file by file.

No file path appears in the report's primary copy. Every "Edit
`teams/<slug>.yaml`" lives under the **Advanced** menu (spec §11).

## Evidence and lineage

**Evidence** is collapsed under every team: work items · completed · cost on
the summary line; inside, one chain per executed action —
`action · human decision · resulting external event · cost` — then activity
by member, where tokens live. A chain follows the links the record has:
`action_run` → the decision in the alignment ledger → the synced CRM record
for the id the action named ("Deal now at Proposal", with the mirror's sync
time). Where a link is missing the line says so: an action carries no cost of
its own, so cost per action reads *not attributed*.

**Lineage** is the funnel behind a primary outcome. Click the figure and a
sheet traces outcomes → approved items → recommendations → agent runs → model
and tool cost → human review, each node with its count and its items (inbox
item, run, CRM record) linked. `OutcomeLineageService.trace(team, measure)`
(`services/team-report/lineage.ts`) is the service; `router.teamReport.lineage`
the route. It names the links the schema does not record — a proposal is not
tied to the run that made it; a CRM record is not tied to the action that
moved it — rather than inventing them.

## The daily mail

`daily-team-report` leads with the same model: goal attainment per team with
its provenance, human load, cost per outcome, and the needs-attention count;
then the manifesto's four questions; tokens only in the evidence footer. See
[Email](./email.md).

## Vocabulary

| Use | Not |
|---|---|
| Mission | Purpose |
| Accountable owner | Owner |
| Measure · Primary outcome | KPI |
| Operating cost · AI cost | Spend |
| Control | Permissions / Autonomy (on this page) |
| Needs you | Escalation |
| Unassigned agents | Not on a team |
| Evidence | Evidence |

"Outcome contract" stays as the internal concept and on detail pages.

## Where it lives

- **Schema:** `TeamMeasureSchema`, `MeasureSourceSchema` in
  `libs/workspace/schemas.ts`; `team.measures` (migration `0100`).
- **Services:** `services/team-report/` — `measures.ts` (shapes, windows),
  `provenance.ts` (the four readers), `derive.ts` (every derivation),
  `humanLoad.ts`, `setup.ts`, `evidence.ts` (chains), `lineage.ts`,
  `configure.ts` (the form's YAML plan); `services/TeamReportService.ts`
  composes them.
- **Routes:** `router.teamReport.lineage | planConfig | applyConfig`.
- **UI:** `features/dashboard/team-report/*`; the page at
  `app/[locale]/(auth)/dashboard/team-report`.
- **Mail:** `services/reports/dailyTeamReport.ts` (performance summary),
  `renderDailyTeamReport.ts`.
