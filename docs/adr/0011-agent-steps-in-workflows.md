# ADR 0011 — Agents as workflow steps: a bounded task, not a chosen skill

Status: accepted, 2026-10-29. Additive: no existing workflow changes meaning.
(ADR 0010 is taken by the agent evals change, #1502.)

## Context

Some work that needs agents has a fixed shape. An SEO page is the clearest:
research Google's top results, write a brief, draft the page, have the editor
review it (at most three rounds), get a person's sign-off, publish. Today that
procedure lives in a mission's prompt and a set of automations that hand the
work on. The procedure exists, but only as prose:

- **It is not visible.** A person sees "a mission check is running", not
  "SB-512 · page 2 of 3 · Editor review, round 2 of 3". The order of steps,
  the round count and the stopping rule are read by the model, not shown.
- **It is not enforced.** "At most three editor rounds" is a sentence. A
  model that loses count runs a fourth, or stops after one.
- **Results are words.** The editor's verdict reaches the next step as text
  that a prompt asks the next agent to read correctly.
- **It is expensive to move.** A planner or a lead turn spends model calls
  deciding what comes next when the answer never changes.

ADR 0003 deleted the `skill` workflow step, which ran an operation (a typed
LLM call) deterministically, and decided that skills are read by an agent on
its own judgement. It kept the workflow engine as the place a proven mission
graduates to a fixed sequence (`promoteMissionToWorkflow`). With only
`approve`, `ask`, `action` and `sync` steps, nothing that needs an agent could
graduate. A v1.54 `agent` step had existed and was withdrawn in v1.55 ("open-
ended agent work belongs in missions"), so its rows still ran but no workflow
could be authored with it.

## Decision

**A workflow step can be an agent doing one bounded task.** An `agent` step
names an agent and a `task` (an interpolated instruction). The agent runs one
turn on its own tools and skills and ends with a result.

- **The step bounds the task; it does not choose the method.** It names no
  skill and mounts nothing. The agent reads whichever of its skills fit, on
  its own judgement, exactly as ADR 0003 has it. Where a skill must be used
  every time, the task names it, the same rule ADR 0003 gives a mission
  prompt. So 0003 stands: there is still no `skill` step, and a skill is
  still never invoked by the engine.
- **The result is typed.** An optional `output` JSON Schema is the shape the
  turn must end with. It is read from the reply, validated, and on a wrong
  shape the agent gets one corrective turn that names the exact problem. A
  second wrong shape fails the step with that reason. This is structural:
  later steps and conditions read fields (`{{steps.review.output.verdict}}`),
  not prose.
- **The turn has its own envelope.** `effort` (`quick`, `standard`, `deep`,
  `auto`) sets the model, thinking and the turn's time and spend ceilings, as
  for a chat turn. `tools` may narrow the agent to named tools. The turn is
  charged to the workflow run, and the step keeps the model, effort, cost,
  traces and every try.
- **It is durable through the run.** The workflow run is already a durable
  run. Every finished step is now written before the next one starts, so a
  restart re-runs only the step it interrupted, and says so. A step
  interrupted three times fails rather than loops.

**A bounded repeat, not a loop language.** A `repeat` step runs a group of
`agent`, `action` and `sync` steps again until `until` holds (checked after
each of its steps), at most `max` rounds (required, 1 to 10), then
`onExhausted: continue | fail`. No nesting, no gates inside, no counters
beyond `{{repeat.round}}`.

**Conditions are one comparison.** A step's `when` and a group's `until` are
`{{a}} == 'x'`, `{{a}} != 'x'`, or `{{a}}` alone. Anything else fails at
`workspace:check`.

**People's gates are Decisions.** An `approve` step files one `approval` ask
(`source_ref workflow-run:<run>:<step>`), decided on its card, by a chip or in
words like every other Decision (#1504). Approving resumes the run; rejecting
or skipping stops it.

**Runs are named.** A workflow's `runLabel` names each run from its input; each
step has a `label`. Both show in the workflows pages, Activity, Needs you and
the chat's running-work line.

**Fan-out is an action.** `action: workflow.start` starts one child run per
item, each named and decided on its own. Waiting for children is not part of
this decision.

## Missions and workflows after this

| | Mission | Workflow |
|---|---|---|
| Holds | A goal, success criteria, autonomy | The steps, in order |
| Who decides what happens next | The agent, every time | The definition |
| Agents | Plan and act open-endedly | Do one bounded task per step |
| Use when | You can write down the goal, not the steps | You can write down the steps |

A mission that runs the same steps in the same order every time has become a
procedure: it graduates to a workflow, and the mission keeps the goal (or is
retired). An open-ended responsibility stays a mission. Inside a workflow
step, the agent still decides how to do its task. The workflow decides only
which task comes next.

## Consequences

- Fixed agent procedures become checkable: each step's result, the round it
  was in, and what it cost are on the run, in one move from where the work is
  listed.
- A procedure's rules ("three rounds, then a person") hold in code, not in a
  prompt.
- An agent step costs one turn (two on a corrective retry), not a planner plus
  a lead turn deciding the next move.
- The SEO plugin still runs as missions and automations. Converting it to a
  workflow is a separate change.
- `action` steps other than `workflow.start` and `routine.run` still record
  intent. Running a registered action under its trust rule from a step is the
  next change; until then a workflow's publish is a recorded intent.
- A step's turn runs in-process when it names `tools`, since the catalog is
  built there, as a turn with a model override does.
