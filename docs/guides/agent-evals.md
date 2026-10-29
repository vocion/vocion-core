# Agent evals: the `agent-behaviour` set, live signals and the scoreboard

Three ways to see whether agents find and use their tools, answer from the
records and never claim work they did not do. Same dimensions in all three
(ADR 0010):

| | What it scores | Costs | Where to read it |
|---|---|---|---|
| **`agent-behaviour` eval** | 46 made-up cases, real model, every tool-loading mode and level | ~$20 per repetition of everything | Terminal, or a deployment's nightly CI summary |
| **Live signals** | Every finished turn: ≥3 failed calls, a refusal with the action there, a claimed save | One row insert per turn | Evals → Live agents |
| **Nightly judge** | A sample of the last day's turns: grounded, arguments right, unjustified refusal, done | One classifier call per sampled turn | Evals → Live agents |

## The `agent-behaviour` eval

Three fictional agents with real catalogs and made-up data
(`services/evals/agentBehaviour/`). Nothing reaches a database, connector or
AWS; it needs `ANTHROPIC_API_KEY` (the direct API, where tool search runs).

```bash
cd packages/core
# Everything once: 46 cases × history, core, all × quick, standard.
NODE_ENV=development DATABASE_URL=postgres://unused@localhost/unused \
  npm run eval:agent-behaviour

# Three repetitions, with spread, a markdown table and the full JSON.
… npm run eval:agent-behaviour -- --repeat 3 --out results.json --markdown results.md

# A slice.
… npm run eval:agent-behaviour -- --modes core --levels standard --cases pa-write-deal,rl-ground-cobalt
```

What each column means:

| Column | Graded as |
|---|---|
| Awareness | The case's tool was called without an error (a write naming the expected action). 95% Wilson interval in brackets. |
| False refusals | "I can't…" with the work not done. Per repetition. |
| Args correct | Of the calls to the expected tool, at least one carried the value the message gave or a result returned. |
| Grounded | The answer says what the made-up record says, and does not repeat the message's guess as fact. |
| Made-up saves | "Noted", "I'll remember" with no call that saves. Per repetition. |
| Errors per call | Failed calls over all calls. |
| ≥3 failed calls | Turns with three or more failed calls. |
| Warm ¢/turn | Cost of turns whose first call read the prefix from the cache. |

With `--repeat N`, each figure is `mean ±sd (min–max)` over repetitions,
and the cases that passed only sometimes are listed under the table. The
`core` gate (ADR 0009) is read on the pooled figures.

Adding a case: put it in `dataset.ts` under its agent, with `expectTools`
and, where it applies, `args` or `grounding`; give `stubs.ts` the record it
needs. `dataset.test.ts` checks every grounding case is backed by its record.
Every name in it is from the fixture cast — no client names.

### Nightly in CI

Core schedules nothing that spends money. A deployment that wants the eval
nightly runs it against the core it pins, with its own key. In a deployment
repository that carries core as the `vocion-core` submodule, add an
`ANTHROPIC_API_KEY` secret and this workflow:

```yaml
# .github/workflows/agent-behaviour-nightly.yml (in the deployment repository)
name: Agent behaviour nightly
on:
  schedule:
    - cron: '0 13 * * *' # 06:00 PT
  workflow_dispatch:
permissions:
  contents: read
jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true # the core this deployment pins
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install core
        working-directory: vocion-core
        run: npm ci --no-audit --no-fund --include=dev
      - name: Run the eval
        working-directory: vocion-core
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          NODE_ENV: development
          DATABASE_URL: postgres://unused@localhost:5432/unused # never opened
        run: |
          npm run eval:agent-behaviour -w @vocion/core -- \
            --modes history,core --levels quick,standard --repeat 1 \
            --out "$RUNNER_TEMP/agent-behaviour.json" --markdown "$RUNNER_TEMP/agent-behaviour.md"
      - name: Results in the run summary
        if: always()
        run: cat "$RUNNER_TEMP/agent-behaviour.md" >> "$GITHUB_STEP_SUMMARY" || echo "The eval did not finish." >> "$GITHUB_STEP_SUMMARY"
      - name: Keep the full results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: agent-behaviour-${{ github.run_id }}
          path: ${{ runner.temp }}/agent-behaviour.*
          retention-days: 30
          if-no-files-found: ignore
```

`history,core` × both levels × one repetition is about $8 a night. To fail
the run when `core` misses its gate, add a step that exits non-zero when any
entry of `gate` in the JSON has `pass: false`.

## Live signals

Every finished agent turn writes one `agent_turn_signal` row after the
answer is sent: tool calls, failed calls, searches, the level, the
tool-loading mode, the model, the trace and conversation ids, and its
flags. No text from the conversation. The flags, from
`services/evals/live/turnSignals.ts`:

- **≥3 failed calls** (`toolFailures`): three or more tool calls failed in
  the turn.
- **Refused with action** (`refusedWithAction`): the answer says it cannot,
  `recommend_action`, `propose_action` or `file_ask` was reachable, and none
  was called.
- **Claimed save** (`claimedSave`): "noted", "I've saved", "I'll remember",
  "I'll keep that in mind" with no successful `remember_preference`,
  `add_learning`, wiki or playbook write.

A flag is a heuristic over the answer's words: it marks a turn to read.

## The nightly judge

Opt in per workspace with an automation:

```yaml
# automations/agent-evals-nightly.yaml
slug: agent-evals-nightly
when: {schedule: '0 7 * * *'}
do: {job: agent-evals-nightly, input: {sample: 20}}
```

Each night it takes up to `sample` unjudged turns from the last `days`
(default 1), round-robin across agents and levels, and asks the classifier
model whether every specific in the answer is in a tool result or the
person's message (`grounded`), whether the calls carried the right values
(`argsCorrect`), whether it declined something it looked able to do
(`unjustifiedRefusal`) and whether it did what was asked (`completed`).
Each verdict, with a one-line note, is written onto the turn's row. A turn
it cannot read stays unjudged and is tried again while it is in the window.

It judges a turn against itself, with no expected answer: a pointer to
turns worth reading, not a pass rate.

## The Live agents page

Evals → **Live agents** (`/dashboard/evals/live`): each agent at each level
over 7, 30 or 90 days — turns, flagged, each signal as a count and share,
errors per call, searches per turn, judged turns, grounded and args right
as passed over applicable, and the tool-loading modes in use. Below it,
the turns worth reading, newest first, each linked to its conversation,
with the judge's note where it read one. A line at the top says whether
AgentCore online evaluation is set up and judging a sample too.

## AgentCore online evaluation

Separate, and off unless someone turns it on: see
[agentcore-evals.md](agentcore-evals.md#online-evaluation-scoring-live-traffic-continuously).
Its results stay in CloudWatch, where they can carry an alarm; the Live
agents page does not read them yet (ADR 0010).

## Related

- ADR 0009 — which tools a turn loads, and the gate for `core`.
- ADR 0010 — this design.
- [agent-tools.md](agent-tools.md#which-tools-a-turn-loads)
