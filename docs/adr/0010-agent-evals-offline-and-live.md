# ADR 0010 — Agent evals, offline and live, on the same dimensions

Status: accepted, 2026-10-29. Ships the measurement only: nothing is
switched on in any workspace by this change. The nightly judge runs when a
workspace adds its automation; the offline eval runs nightly when a
deployment adds the CI workflow in `docs/guides/agent-evals.md`; AgentCore
online evaluation stays as `online.ts` left it, off until someone with AWS
access turns it on.

## Context

ADR 0009 added the `agent-behaviour` eval: twelve made-up cases, one run per
mode and level. Two runs of it a day apart disagreed by more than the
differences being judged (`core` at Standard: 91% then 100% awareness, one
false refusal then none). Twelve cases once is a coin toss. Its first
Standard calls were also never cache hits — the eval's system prompt had no
cache breakpoint, production's has one on every call — so its cost line
compared cold turns with cold turns and said nothing about the warm cost a
person pays.

It also measures made-up turns only. What the live agents actually do —
does the analyst still refuse a write, does an agent say "noted" and save
nothing — was not measured anywhere. The two live-traffic paths that exist
do not answer it:

- **AgentCore online evaluation** (`services/evals/online.ts`,
  `providers/agentcoreOnline.ts`) samples live sessions from the runtime's
  spans and runs AWS's judges (`Builtin.Correctness` by default). It is
  built, created switched off, and on in no workspace. Its results go to
  CloudWatch metrics in the customer's account; nothing in Vocion reads
  them back. Its built-in evaluators judge helpfulness and correctness in
  general, not the failures that hit us: a refusal with the action there, a
  claimed save, a wrong id passed on.
- **Langfuse traces** carry each turn's tool counts since ADR 0009
  (`metadata.tools`), but nobody reads them by agent and level.

## Decision

Measure the same dimensions offline and live, with the same code where the
check is a pattern, and a judge where it needs one.

| Dimension | Offline (`agent-behaviour`, made-up data) | Live, every turn (`turnSignals.ts`) | Live, nightly sample (`judge.ts`) |
|---|---|---|---|
| Tool awareness: the tool the request needs is called | graded per case | — | `completed` |
| False refusal | `isRefusal` without the work | `refusedWithAction`: refusal, action path there, not taken | `unjustifiedRefusal` |
| Made-up save | `claimsSave` without a save call | `claimedSave` | — (the signal is exact enough) |
| Grounding: the record, not the guess | `mustSay` / `mustNotSay` per case | — | `grounded` |
| Argument correctness | per-case predicate on the call | — | `argsCorrect` |
| Tool errors | per call | `toolFailures`: ≥ 3 failed calls in a turn | — |

### Offline: wider, repeated, warm

- **46 cases** over the three fictional agents (ADR 0009), seven kinds:
  write, connector, long tail, refusal probe, grounding, save, arguments.
  Each grounding case's message carries a guess the made-up record
  contradicts (the analyst "is the biggest deal Northwind?" when it is
  Summit; "Cobalt was qualified, right?" when the call was disqualified).
  Each argument case names a value the call must carry — a date from the
  message, the company id an earlier search returned.
- **Repeats.** `--repeat N` runs every case N times; the report gives each
  figure's mean, standard deviation and range over repetitions, a 95%
  Wilson interval on pooled awareness, and the cases that passed only
  sometimes. The gate (ADR 0009) is read on the pooled figures.
- **Warm.** The system prompt carries the same prefix breakpoint as a live
  turn (`systemWithPrefixBreakpoint`, mirroring deepagents'
  `createCacheBreakpointMiddleware`), so a case after the first in its group
  reads the agent's prefix from the cache, as a conversation does.

### Live, every turn: signals, no model call

`AgentService` scores each finished turn after `done`, best-effort, into
`agent_turn_signal`: counts and flags, the level, the tool-loading mode, the
model, the trace and conversation ids. No conversation text. Three flags,
each a failure a person has hit:

- `toolFailures` — three or more failed calls in the turn;
- `refusedWithAction` — the answer declines for want of the ability while
  `recommend_action`, `propose_action` or `file_ask` was reachable (loaded or
  deferred), and none was called;
- `claimedSave` — "noted", "I've saved", "I'll remember", "I'll keep that in
  mind", with no successful call to a tool that keeps something.

They are text heuristics. A flag marks a turn worth reading, not a verdict.
The offline cases pin the patterns down: the same functions grade both.

### Live, nightly: a judged sample

The `agent-evals-nightly` job (an automation's `do: { job: ... }`) picks up
to `sample` (default 20, at most 200) of the last day's unjudged turns,
round-robin across agents and levels so a busy agent does not crowd out a
quiet one. For each it reads the person's message, the turn's tool calls
with their results and the answer (from `conversation_message`, joined on
the trace id) and asks the classifier model for `grounded`, `argsCorrect`,
`unjustifiedRefusal` and `completed`, each null where it does not apply,
plus a one-line note. The verdict lands on the turn's row (`judge`). Cost:
one classifier call per judged turn, charged to the workspace under
`eval.judge`.

Like AgentCore's online evaluators it judges a turn against itself. It has
no expected answer, so it is a health signal and a pointer to turns worth
reading, not a pass rate to gate a release on. The offline eval is the
gate.

### The scoreboard

`/dashboard/evals/live`, linked from Evals: every agent at every level over
7, 30 or 90 days, in the Engines page's frame (ADR 0005) — turns, flagged,
each signal as a count and share, errors per call, searches per turn,
judged, grounded and args right as passed over applicable, and the
tool-loading modes in use. Below it, the turns worth reading, newest first:
any flag, or a judged problem with the judge's note, each linked to its
conversation.

### AgentCore online evaluation

Unchanged, and still off. It stays the path for an alarm in the customer's
own account ("page someone when correctness drops"), which the scoreboard
cannot give. The scoreboard says whether it is set up and on. Two
extensions are left for when someone turns it on:

1. Read its per-session results back from
   `/aws/bedrock-agentcore/evaluations/results/<config-id>` into
   `agent_turn_signal.judge` by session id, so the scoreboard shows them.
2. Register the nightly judge's four criteria as AgentCore custom
   (LLM-as-judge) evaluators and add them to the online configuration, so
   the same dimensions are judged in AWS too.

Both need AWS access in a real account to build and test, and neither is
needed for the scoreboard to work.

### Nightly in CI

`npm run eval:agent-behaviour -w @vocion/core` runs the offline eval with
`--markdown` for a CI run summary and `--out` for the JSON. Core schedules
nothing that spends money: a deployment adds the workflow in
`docs/guides/agent-evals.md`, against the core it pins, with its own key.

## Consequences

- One table, two indexes, one row per turn. At a few thousand turns a day
  that is small; nothing deletes rows yet.
- A turn costs one insert after `done`. A failed insert is logged and the
  turn is unaffected.
- The nightly judge costs one small call per sampled turn, opt-in per
  workspace by its automation.
- The offline eval at `--repeat 3` across three modes and two levels is
  about 830 runs and about $60; the nightly CI caller should narrow it.

## Not in scope

Model routing; switching `core` loading on (ADR 0009's gate decides);
reading AgentCore's online results back (above); deleting old signal rows.
