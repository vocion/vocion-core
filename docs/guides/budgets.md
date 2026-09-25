# Agent budgets

Every agent turn is held to a spend cap. An agent you gave no cap is held to a
default of **$100 a day**. This page covers how to set a cap, where to see it,
what happens when a turn reaches it, and how it fits with the spend limits your
model provider offers.

## Set a budget

In the agent's YAML:

```yaml
# agents/pipeline-analyst.yaml
slug: pipeline-analyst
name: Pipeline Analyst
budget:
  dailyCents: 5000 # $50 per UTC day
  monthlyCents: 60000 # $600 per UTC calendar month (optional)
```

For every agent in the workspace that sets no `budget:` of its own, in
`workspace.yaml`:

```yaml
# workspace.yaml
defaults:
  agentBudget:
    dailyCents: 10000 # $100 per UTC day for any agent without its own budget
```

Then `npm run workspace:apply`.

Both caps are hard caps in cents. The period is UTC: a daily cap resets at
00:00 UTC, a monthly one on the first of the month.

## Which cap applies

An agent's daily cap is the first of these that is set:

1. Its own `budget.dailyCents`.
2. The workspace's `defaults.agentBudget.dailyCents`.
3. The built-in default, **$100 a day**. A deployment can change it with
   `VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS` (a whole number of cents), or turn it
   off with `VOCION_DEFAULT_AGENT_DAILY_HARD_CENTS=off`.

The cap covers everything billed to the agent, not just its chat turns: its
background worker runs and the source-sync extraction charged to it count
toward the same total, and are refused at the same cap.

`defaults.agentBudget.dailyCents: null` means "this workspace chooses no
default": agents without a budget of their own run with no cap from Vocion.
Use it when you manage spend another way — see [provider
limits](#provider-spend-limits) below for what that does and does not catch.

The workspace-wide cap and the per-feature caps (embedding, rerank, image
generation) are separate and stay opt-in. The default applies to agent turns
only.

### What apply does and does not change

- A `budget:` block you write **owns** that agent's caps. The next apply puts
  them back to what the YAML says, even if someone changed them in between.
- An agent with **no** `budget:` block keeps whatever caps it already has — the
  one set when it was hired, for example. Removing the
  block does not clear the cap; set a new figure instead.
- The same goes for `defaults.agentBudget`: omit it and the stored default is
  left alone.

## What happens at the cap

- **Before a turn:** a turn whose agent is already at its cap is refused before
  it starts. The person sees why, and which setting to change.
- **During a turn:** every model call is charged as it finishes, and the cap is
  read again straight after. Once a call takes the agent over its cap, the turn
  ends before its next model call starts. A call that crossed the line with its
  final answer keeps that answer; the next turn is refused. A turn can go over
  by the one model call that crossed the line (one per branch when an agent
  runs delegations side by side).
- **The stop reason is kept.** The turn is stored as *refused* with the message
  on the record, so it reads the same after a reload and in the conversation
  history.
- **The dashboard says so.** While any agent is at its cap, a banner above every
  dashboard page names it, its spend, its cap, where the cap came from, and
  when it resets.

The in-process loop stops mid-turn. On `agentcore-container`, Vocion ends the turn and closes its stream from the container at the same point.
The `aws-managed-harness` reports no usage yet
([#116](https://github.com/vocion/vocion-core/issues/116)), so on that harness
only the before-turn check applies.

## See every agent's cap and spend

```bash
curl -H "Authorization: Bearer $VOCION_API_TOKEN" \
  "https://<your-host>/api/v1/budgets/agents?period=daily"
```

Every agent is listed, including ones that have never spent anything:

```json
{
  "period": "daily",
  "workspaceAgentDefaultCents": null,
  "builtInAgentDailyCents": 10000,
  "agents": [
    {
      "agentSlug": "pipeline-analyst",
      "agentName": "Pipeline Analyst",
      "period": "daily",
      "spentCents": 812.4,
      "tokens": 1250000,
      "hardCentsLimit": 10000,
      "hardTokenLimit": null,
      "hardCentsLimitFrom": "built_in_agent_default",
      "remainingCents": 9187.6,
      "blocked": false,
      "breach": null,
      "periodResetsAt": "2026-09-24T00:00:00.000Z"
    }
  ]
}
```

`hardCentsLimitFrom` is `own`, `workspace_agent_default`, or
`built_in_agent_default` — which setting to change to move the cap.
`workspaceAgentDefaultCents` is absent when the workspace set no default,
`null` when it set "no default", and a number otherwise. The token needs the
`manage_sources` capability. `GET /api/v1/budgets` still lists the raw stored
rows, workspace-wide and per-feature rows included.

## The proposal budget — how many things an agent may leave in Review

Spend is one runaway; the other is the queue. An agent on its own schedule — a
mission check every two hours, an automation on every event — files proposals
and asks as fast as it can think of them, and each one waits for a person.
When the person does not keep up, Review stops being a queue ("700 items need
attention is uselessly overwhelming", 2026-09-24).

So every agent has a **proposal budget**, in core, at the agent level:

```yaml
# agents/product-manager.yaml
proposals:
  openMax: 3 # undecided items it may hold in Review while acting on its own schedule
  weeklyMax: 5 # new candidate records (ideas) it may file in a rolling week
```

```yaml
# workspace.yaml — the default for every agent that sets none
defaults:
  agentProposals: {openMax: 5, weeklyMax: 10}
```

Set neither and the built-in applies (`ProposalBudgetService.DEFAULT_PROPOSAL_BUDGET`,
5 open / 10 a week), so an agent nobody configured is still bounded.

**What counts.** The agent's own pending action runs and open asks — nobody
else's. **When it counts.** Only when the agent acts on its own schedule: a
mission run, an automation, any turn with no person in the conversation. A
proposal made inside a person's chat turn never counts; the person asked.
**What happens at the cap.** `propose_action` and `file_ask` refuse, telling
the agent the cap, what it is holding (oldest first) and the one move that
frees a slot: `withdraw_proposal(kind, id, reason, superseded_by)`, which
retires one of its own with the reason on the record — a better idea replaces
an older one instead of stacking on it. The weekly cap applies to
`objects.propose_candidate` only, whatever became of those records.

The budget lives on the agent row as `approvalPolicy.proposals`, written by
`workspace:apply`. `proposalBudgetLine(orgId, agentSlug)` renders
`open 3/5 · ideas 4/10 this week` for a header or a receipt.

## Provider spend limits

Your model provider may offer its own spend limits. They are worth setting as
a second line, and they are not a replacement for an agent cap:

| | Vocion agent cap | Anthropic Console spend limit | AWS Budgets |
|---|---|---|---|
| Scope | One agent | Your whole org, or one Console workspace | An AWS account or service |
| Stops spend | Yes, at the next model call | Yes — requests are rejected once reached | Only through a budget action you configure (an IAM or SCP deny policy); otherwise it alerts |
| How quickly | Straight after the call that crossed it | At the limit | Data updates up to three times a day, 8–12 hours apart |
| What the person sees | Which agent, which cap, what to change | A provider error on every agent at once | The same, once a deny policy lands |

In short: a provider limit protects the account from a very bad month; the
agent cap stops one agent's runaway turn within the same turn, and tells you
which agent it was. If you set `dailyCents: null` and rely on the provider
instead, a runaway loop on one agent can spend up to your provider limit — or,
on AWS, whatever it spends in the hours before the next billing update — and
the failure shows up as every agent erroring at once.

Sources: Anthropic, [rate limits — spend
limits](https://platform.claude.com/docs/en/api/rate-limits#spend-limits); AWS,
[managing your costs with AWS
Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
and [configuring budget
actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html).

## Related

[Agent](../entities/agent.md#budget) · [Workspace](../workspace.md) ·
`packages/core/src/services/BudgetService.ts` (the rules, in its module
docstring) · `packages/core/src/services/agents/budgetStop.ts` (the mid-turn
stop)
