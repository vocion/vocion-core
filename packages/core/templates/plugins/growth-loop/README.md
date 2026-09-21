# Growth loop

**A brief becomes work, the work gets measured, and what gets briefed next is
decided by the measurements.** Turning this on gives a workspace the loop a
small go-to-market team actually runs — with the two steps most teams skip made
structural: the list of what a piece may *not* say, and the reading taken after
it is live.

## What turning it on adds

| | |
|---|---|
| **One object type** | `growth_brief` — the unit of work, and the only new noun |
| **Five agents, one team** | Demand, Production, Quality, Measurement, Growth. Design declared empty |
| **Six skills, three playbooks** | Briefing, producing, checking, reading, ranking, extending the team |
| **Four missions on a schedule** | What gets briefed · Every brief measured · Nothing public unchecked · The team inside its budget |
| **Five automations** | Every way an agent acts, readable and pausable on `/dashboard/automation` |
| **Four pages** | Briefs · Measure · Cost and return · Team report |
| **A trust file** | Where each of the loop's action kinds starts, and why |

## Is a brief a different noun from a task contract?

The `software-factory` plugin already ships "a named request becomes a contract,
a worker executes it, a check decides, a person merges". Marketing work looks
like the same loop with different checks, and shipping a second task system
would be exactly the defect principle 6 warns about. So the question was asked
first, and the answer is **the same contract, a different noun** — for one
reason, which is worth being precise about.

**A task contract is decided at acceptance. A brief is decided after
publication.**

`engineering_task.requiredChecks` are commands: *"Deterministic and repeatable:
a check no one can run again is not a check."* They run against the commit, and
when they pass the work is accepted and finished. A brief cannot work that way.
Everything checkable at acceptance — does it say what the brief asked, does it
avoid what the brief forbade, is every claim sourced — is a **quality gate**,
and passing it proves only that the piece is fit to publish. Whether making it
was worth doing is a **reading against a baseline, taken days or weeks later**,
and that reading comes back flat on plenty of work whose gate was spotless.

Two verdicts, at two times, of which only the second answers the question the
work was done for. That is not one noun with an extra field: it is a second
lifecycle. `accepted` ends a task; it is a brief's halfway point.

Three more differences fall out of that one:

- **The blast radius is claims, not paths.** `allowedPaths` is the task
  contract's fence — *"a diff that touches anything outside this list is a
  contract violation"*. A blog post touches no paths. Its fence is
  `doNotClaim`, and everything that goes publicly wrong goes wrong on a sentence
  nobody forbade. `allowedPaths` cannot express it.
- **The checker is a judgement, not an exit code.** The gate returns a verdict
  with quoted unsupported claims and at most three fixes. `requiredChecks`
  explicitly excludes that kind of check.
- **Half of `engineering_task` is git.** `repoSlug`, `baseSha`, `branch`,
  `commitSha`, `prUrl`, `filesChanged`, and a `riskClass` enum that is a
  software blast-radius taxonomy. A brief fills none of them.

### What is deliberately NOT duplicated

The argument only holds if the shared half is genuinely shared, so it is spelled
identically rather than paraphrased:

| Shared, same name, same job | Why |
|---|---|
| `objective` | an outcome, not a list of steps, in both |
| `acceptanceContract` | what has to be true, checkable, decided against and nothing else |
| `decisionCost` | minutes of a person's attention, same units, summed against the same daily budget |
| `estimateCents` / `actualCents` / `varianceCents` / `costUpdatedAt` | core writes the actual from the worker runs; no second cost system |

And four things this plugin does **not** ship, on purpose:

- **No second intake noun.** `request` is the software factory's — *"the single
  intake noun… one object arriving on different channels"* — and it already
  covers a customer asking for a comparison page. A brief carries an optional
  `requestId` pointing at one; with only this plugin on, briefs come from the
  demand map and the field is empty.
- **No second worker control plane.** `worker_run` is core's.
- **No second cost pair, and no rollups of its own.** A brief is a leaf; core
  writes its actual when a run naming it ends.
- **No second scorecard noun.** The 90-day scorecard people usually build as a
  table is a **team's `measures:`**, with core's four dimensions and its
  provenance chips — `teams/growth-loop.yaml`.

## The loop, step by step

**1 · Demand → brief.** The strategist writes one brief per claim per audience:
the objective as a movement in a number, the audience *and what they already
believe*, the single claim with the evidence under it, what it may not say, what
is out of scope, the acceptance contract, the claim class, and the measure —
key, baseline, source, attribution model — fixed before anything is made.

**2 · Brief → deliverable.** The producer makes exactly what the brief asks for,
as a core artifact, and returns two lists every time: what it had to assume, and
what it could not establish. Less evidence produces a *smaller* piece, not a
longer apology.

**3 · Deliverable → gate.** The editor reads against the brief and nothing else,
in the cheap order: do-not-claim first (one hit ends the read), then every
acceptance line, then every claim against the evidence the brief named, then the
staleness pin. Three verdicts, at most three fixes, unsupported claims quoted,
and the **round** recorded — because a piece that passed on the third read is a
brief that was unclear.

**4 · A person publishes.** The loop proposes; a person releases. See *The
claim gate* below.

**5 · Published → reading.** `readAfterDays` from `publishedAt`, the analyst
takes the reading from the source the brief named, under the attribution model
the brief named, and writes a verdict — `worked`, `no_effect`, `hurt` or
`unmeasurable` — with the baseline, the window and the model beside it.

**6 · Readings → what gets briefed next.** The lead ranks on three inputs and
nothing else: the demand, *what the closest closed briefs returned*, and the
expected cost. A theme whose briefs came back `no_effect` twice is dropped and
named. **This step is what makes it a loop rather than a queue**, and it is the
one most teams never build.

## Two sharp edges, handled structurally

### Budget, and a team that extends itself

"The team extends itself, within a budget" is the part that can run away, so
none of it is left to a prompt.

- **The hire is a registered core action** — `team.hire_agent`
  (`libs/actions/team-hire-agent.ts`), with `execute`, `undo` and a rule in this
  plugin's `trust.yaml` like every other kind. It proposes through
  `propose_action`; a person decides on a card; Undo is one move away.
- **It can only hire what already exists.** The input is a **catalog slug**, so
  the definition being installed was authored and reviewed by whoever ships the
  catalog. An agent picks a teammate; it never writes one.
- **It cannot hire without an allowance.** `dailyCentsLimit` is required and
  becomes the new agent's soft and hard daily cap in `agent_budget` the moment
  the hire lands. Capability and its cost arrive together.
- **It refuses when the money is not there.** The precheck sums every agent
  budget that declares a cents limit and refuses to open a card at all when the
  period's spend has reached the committed total, or when the allowance asked
  for exceeds what is unspent. A promoted rung would still be refused by both —
  these bounds are in the action, not in the ladder.
- **Undo removes all three**: the agent row, the budget row, and the team row if
  the hire created it.
- **It is not on the learning-eagerness dial.** That dial
  (`defaults.learningEagerness`) is calibrated for *"an agent read a sentence
  nobody meant"*. Hiring changes what the system can **do**, so it keeps a bar
  of its own, at `medium` — which means the ladder's ceiling is
  execute-within-bounds and autonomous is never offered for a hire on any
  ledger.
- **A workspace with no budgets has no ceiling.** Budgets are opt-in in core, so
  the gate has nothing to hold against, and the card says so in those words
  rather than implying a limit that does not exist. Set one on
  `/dashboard/budgets` before turning a loop loose.

The mission `the-team-inside-its-budget` carries the evidential bar: a gap is
named work that waited **with no owner for two weeks**, diagnosed as a ranking
problem first, and a rejected hire is not re-proposed inside thirty days on the
same evidence.

### The claim gate

`claimClass` says what is on the other side of a claim being wrong —
`descriptive`, `instructional`, `comparative`, `performance`, `regulated` — and
the `publish-what-holds` playbook says what each needs behind it.

Core registers no `growth.publish` action today, so the decision to release a
deliverable is an **ask a person answers**, and the `growth.publish.<claimClass>`
rules in `trust.yaml` bind to nothing yet. They are written anyway, exactly as
`software-factory` writes its `product.authorize.*` rules ahead of the
mechanism: the bar is a decision this plugin has made, the autonomy page shows
it, and the day core registers `growth.publish` with a
`policyKeyFor(claimClass)` — on the model of `git.merge.<riskClass>` — nothing
here changes. **That is the named core follow-up.**

Where a deliverable goes out as copy under the company's name, core's registered
`release.announce` is the kind, and this plugin holds it at approval.

## Customising it

Everything below is a same-slug file in your workspace; see
[`docs/plugins.md`](../../../../../docs/plugins.md).

- **`playbooks/publish-what-holds/SKILL.md` is a stub and is meant to be
  replaced whole.** The five classes hold for anybody; the thresholds, the named
  authority per class and your regulated categories are yours.
- **The measures.** `teams/growth-loop.yaml` with `extends: core` — the targets
  and baselines shipped here are a starting shape, not your numbers. Every
  measure declares the *weakest provenance that is true*: the outcome is
  `agent-reported` because the analyst is counting verdicts it wrote itself, and
  the report says so.
- **The decision budget and the WIP limit.** In `missions/what-gets-briefed.yaml`.
- **The channels, claim classes and states.** In
  `objects/growth_brief/type.yaml`.
- **The pages.** Replace by slug to change the cut.
- **The bars.** A rule for the same action in your own `trust.yaml` replaces
  this one.

## What this plugin does not do

It does not publish anything. It does not connect to a CMS, an analytics tool or
an ad platform — the brief names the source a reading comes from in words, and
taking it is the analyst's work with whatever the workspace has connected. It
does not write your voice: `one-claim-per-piece` is a structural rule, not a
style guide, and the house voice belongs in the `wiki` plugin or in a workspace
playbook. And it does not decide what you sell, who you sell it to, or what is
true about your product — those are concretions, and they stay in the workspace.
