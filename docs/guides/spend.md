# Spend: the model-call ledger

Every paid model call lands in one table, `model_call` (migration `0214`), one row per call. A row knows the workspace and the Org, the agent, the feature, the person, the conversation, the run, the model and its vendor, the effort level, tokens split four ways, the cost in micro-cents, latency and the trace. Spend is read from it by any of those, over any period: on **Observability → Spend**, over oRPC (`spend.by`), and at `GET /api/v1/spend`.

Budgets are unchanged. `agent_budget` keeps its per-period counters, which is what caps are enforced against. The ledger is the history the counters never had: a counter knows the agent and the day, and a rollover overwrites it.

## One write path

`chargeUsage` (`services/BudgetService.ts`) is where every charge already lands, so it is also the only thing that writes the ledger (`services/spend/ledger.ts`). A call that charges a budget is a call in the ledger, and nothing else writes there.

The row takes what the charge knows (workspace, agent, feature, model, tokens, cost, and latency and trace when the caller has them), and what the **call context** knows:

| From | What | Opened by |
|---|---|---|
| Call context (`services/spend/callContext.ts`) | person, conversation, run, effort, trace, agent | `runAgentDeep` (person, agent, conversation, mission run; effort and trace once known), the chat stream route (person, thread), browser runs (`browser_run`, or `routine_run` for a routine's row), legacy workflow agent steps (`workflow_run`), evals (`eval_run`, keyed by dataset), engineering runs (`worker_run`) |
| Run-cost scope (`services/budget/runCost.ts`) | conversation, mission run | `withRunCost`, wherever a run's cost is already counted |

An inner context lays over an outer one field by field, so a browser run a chat turn starts is filed under the browser run and still under the person.

A charge with both an agent and a feature is two budget counters (the agent's row and the feature's) but **one ledger row**. Add up ledger rows freely; adding agent rows and feature rows from `agent_budget` together still counts those calls twice, as it always did.

The write is best effort, like a run's cost: the call already happened and was paid for. A lost row is logged as an error with its cause and never fails the call.

## Calls that were not charged before

These made paid calls and charged nothing, so they spent outside every budget and every report. Each now charges once, under its own feature:

| Call | Feature |
|---|---|
| `turnJudge` (intent, consent, a decision's answer) | `chat.judge` |
| `stepLabeler` | `chat.step-label` |
| `deliverableBackstop` | `chat.deliverable` |
| `correctionReflector`, `workCorrections` | `chat.correction` |
| `gates/handoffJudge` | `gate.handoff` |
| `kitVision` (raw Anthropic SDK) | `tool.vision` |
| `documents/look`, `documents/redTeam` (raw Anthropic SDK) | `document.look`, `document.red-team` |

A call made inside an agent's graph was already charged by the agent's own callback, because LangChain hands a graph's callbacks down to every model call under it. The callback marks the response it charged (`markCharged`), and `chargeModelCall` skips a marked response, so nothing is counted twice. Raw SDK calls go through `chargeAnthropicCall`, which adds the cache counts back onto Anthropic's uncached `input_tokens`.

The container runtime's `usage` events now carry one-hour cache writes (`cacheWrite1hTokens`, priced at 2x), and a charge that fails there is logged as an error with its cause.

The main agent trace now carries the conversation as its Langfuse session, so a thread's turns read as one session.

## Reading it

`spendBy({ scope, groupBy, from, to, filters })` (`services/spend/spend.ts`):

- `scope`: `{ accountId }` for every workspace in an Org, or `{ orgId }` for one workspace. Every query is fenced to it; names (agents, conversations, workspaces) are read only from inside it.
- `groupBy`: `workspace`, `agent`, `user`, `feature`, `model`, `run`, `conversation`, `day`.
- `filters`: `orgId`, `agentSlug`, `userId`, `feature`, `model`, `runKind`, `runId`, `conversationId`.
- Returns rows of `{ key, label, calls, tokens, microCents }`, biggest first (newest first by day), at most 200, and the total over everything.

Who may read: an Org admin reads the Org or this workspace; a workspace admin reads this workspace; anyone else is refused.

```bash
curl -H "Authorization: Bearer $VOCION_TOKEN" \
  "https://<your-host>/api/v1/spend?group_by=model&period=30d&agent=revenue-lead"
```

The API is scoped to the token's workspace and needs `manage_sources`, like the budget rows. Money is in micro-cents.

**On the page**: Observability → Spend. Pick a period and a grouping; each row drills in (an agent opens its features, a person their agents, a workspace its agents; a mission run, browser run or eval opens its record). The view is in the URL, so it can be kept or sent.

## Not yet

- **Retention.** Rows are kept indefinitely. A busy workspace writes a row per model call, so a retention window (or a daily rollup past it) is the next change once volume says so.
- **The message.** `message_id` is in the table and not yet filled: the assistant message is written after the turn's calls.
- **The AWS-managed harness** (`runsOn: aws-managed-harness`) reports no usage, so it is neither charged nor in the ledger. No workspace runs on it today.
- **Eval run ids.** An eval's row is written after its cases run, so eval calls are keyed by dataset slug (`eval_run:<dataset>`), not by the run's id.
