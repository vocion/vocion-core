# Team threads

A team thread is one question a lead puts to its specialists **together**. They
post in rounds, read each other's posts and answer them by name; the thread ends
on a settle rule; the lead writes the outcome. The whole thread is one run, with
its cost, owned by the lead and the team's accountable human.

It is the other shape beside delegation. `task` hands one specialist one piece of
work and returns its answer: a tree, and no specialist ever sees another's reply.
A thread is for a question the team has to argue out — the analyst's number
against the coordinator's read of the account, corrected in the open.

| | `task` (delegation) | Team thread |
|---|---|---|
| Who answers | one specialist | the lead's team (up to 6) |
| Who reads whom | the lead reads one reply | everyone reads every post |
| Ends when | the specialist answers | a settle rule holds |
| Recorded as | part of the lead's turn | its own run, with its own cost |

## How one runs

1. **Opened** for one question — by a lead's `open_team_thread` tool (in chat, or
   in a mission step the lead owns), or by an automation's `team-thread` job.
2. **Round by round**, every member who has not marked complete posts.
   `parallel` (the default): everyone at once, each having read the thread as it
   stood when the round began. `sequential`: one after another, each reading the
   posts before theirs in the same round too.
3. **After each round** the lead either settles it — writing the outcome — or
   steers the next round, by name. The steer is a post everyone reads.
4. **It ends** on the first settle rule that holds, and the lead writes the
   outcome if its own word was not what ended it.

## The settle rule

Whichever holds first, in this order — the reason recorded is the most
meaningful one that is true:

| Rule | Holds when |
|---|---|
| `cancelled` | A person cancelled the run (`POST /api/v1/mission-runs/:id/cancel`, or the run page). No outcome is written: nobody is waiting for one. |
| `lead` | The lead's review declared the thread settled. That review **is** the outcome. |
| `all_complete` | Every assigned member said their part is complete. A member who marks complete sits out every later round. |
| `budget_cap` | The thread has spent its cap — every turn and every read in it. A sequential round stops mid-round when the cap is reached. |
| `round_cap` | The rounds are used up. |

Whether a member marked complete and whether the lead settled it are **read by a
model**, never matched: a small model reads each post and returns a typed field
(`services/teams/threadRead.ts`), and the loop routes on the field. A read that
fails says "no" — the thread runs on to its next rule, and every thread has its
caps.

The caps default to **3 rounds** and **$3.00**; an opener may set 1–6 rounds
and up to $50.00. A thread assigns at most 6 members.

The lead always writes the outcome. When the lead's own word settled the thread,
its review is the outcome; otherwise it gets one more turn, told which rule held,
to write it — the cap stops new rounds, never the outcome. A thread that settles
and still has no outcome (the lead's turn failed) ends **failed**, saying why.

## Who is in it

The members come from the registry, never from a list the model typed: the same
roster the lead delegates to (`agents/delegationRoster.ts`) — a team lead's own
team and registered children; the workspace's lead's team leads. The opener may
name members to narrow it; a name the lead cannot reach is returned as
`notAssigned`, never silently dropped. A lead with no one to ask is refused in
words.

Every turn runs as the person behind the thread, under their source ACL, so a
member never reads more than they could. A thread is refused while the workspace
is paused, and a turn already inside a thread cannot open another.

## One run

A thread is a `mission_run` — the agent-run record every mission and automation
check already writes — so it shows up where runs show up, with nothing beside it:

- **Its posts are the run's steps** (`plan.tasks`): `Round 1 · pipeline-analyst`,
  `Round 1 review · revenue-lead`, `Outcome · revenue-lead`. Each step carries
  the tool calls its turn made, because every turn carries the thread's
  `missionRunId`.
- **Its cost is the run's cost.** The thread runs inside one cost scope
  (`services/budget/runCost.ts`), so every member turn, every lead turn and
  every read is counted once, on the run. A chat turn that opened the thread
  does not count it again.
- **Its owner** is the run's lead (`team.lead`) and the team's accountable human
  (else the workspace's), resolved when the thread opened.
- **What only a thread has** — the question, the members, the caps, who marked
  complete, which rule settled it and the outcome — is the run's `thread` column
  (migration `0188`).
- **A thread a restart leaves behind** is reaped like any agent run: every post
  writes the run, so a live thread stays fresh, and one with no activity for the
  mission-run reaper's window (30 minutes by default) is marked `failed`.

Read it at `/dashboard/missions/runs/<id>`: the outcome first, then how it
settled and what it cost against its cap, then every post by round. The runs log
(`/dashboard/p/runs/agent-<id>`) draws the posts as steps with the outcome as the
summary. Over the API, `GET /api/v1/mission-runs/:id` returns the posts as
`plan.tasks`.

## Opening one

**From a lead** — the lead calls `open_team_thread` with the question (and
optionally `members`, `max_rounds`, `cap_cents`, `turn_order`). The run is linked
under the lead's answer and each post shows on the call as it lands. In a
mission step the lead owns, the thread names the mission run it came from.

**From an automation** — the `team-thread` built-in job:

```yaml
slug: forecast-thread
name: Monday forecast thread
agent: revenue-lead
when:
  schedule: '0 14 * * 1'
do:
  job: team-thread
  input:
    team: revenue-ops # or lead: revenue-lead
    question: Where will the quarter land, and what moves it most?
    maxRounds: 2
    capCents: 200
```

The job waits for the outcome and returns `{ runId, status, settledBy, rounds,
cents, outcome }`, which the automation's own run keeps as its result.

## On both loops

Every turn goes through `runAgentDeep`, the seam a chat turn and a mission task
go through, so each member answers wherever its own `harness.runsOn` says — in
this process or on the agentcore container — with the same event contract.

The tool call itself is where the two loops differ. In this process
`open_team_thread` waits for the outcome. On the container a tool call is one
HTTP round trip under the artifact's `VOCION_TOOL_TIMEOUT_MS` (120s by default),
so the call waits until 20 seconds before that and, if the thread is still going,
says so and returns; the thread keeps running in core and its outcome lands on
its run. Either way the run is announced with a `record_created` event and the
posts as `step_progress` notes on the call.

## Related

[Team](../entities/team.md) · [Mission](../entities/mission.md) · [Automation](../entities/automation.md) · [Where an agent turn runs](../agent-execution.md) · [Budgets](./budgets.md)
