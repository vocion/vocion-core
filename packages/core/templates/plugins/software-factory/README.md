# Software factory

A request becomes work, work becomes a release, and a person runs the loop
from a phone. Three pages, five seats, one loop.

## The three pages

| Page | The question it answers | For whom |
|---|---|---|
| **Products** | How are my products doing? Stage, health, price beside the incumbent, last release, open work. | The person accountable for the portfolio |
| **Work** | What is running, what is proposed, what just landed — and what is waiting on me? Three tabs; a row is one outcome. | The person deciding what to build |
| **Releases** | What reached people, what it carried, what the post-deploy check said, who has been told? | The person who owns the announcement |

Opening a row on Work opens the **work item** — one request end to end:
the ask in the asker's words, the decision and who made it, the plan, the
mockup, the contract, every run with its checks and cost, the pull request, QA's
verdict, the release, and the after-shot. Every stage that did not happen says
so. The page is hidden from the nav (`pages/feature.yaml`) because it is the
row, not a place.

The filter every page and element passed: *can a product exec make a decision
or get value from this?* Factory, Factory log, Performance and Guide did not,
so they are gone. Reporting returns when use demands it.

## The loop

    asked → decided → planned → building → QA → released
                 ↘ answered (it will not be built, and the asker is told why)

| Stage | Who | What exists at the end of it |
|---|---|---|
| asked | anyone, on any channel; an ask in chat becomes a card | a `request`, in the asker's words, with `why` |
| decided | PM prepares the commitment — draft contract, main risk, expected result, how we check, the mockup — then **the product owner decides** from ONE card: Approve build · Request changes · Defer | `state: in_scope` with `acceptanceFrozenAt`; or `deferred` with a reason and a revisit date; or an honest answer proposed as a reply. Answers and duplicates never enter the build path |
| planned | PM, before the card; an `architecture_plan` only when the work needs one, as an explicit exception | the `engineering_task` contract, drafted before approval and frozen by it |
| building | Eng, as an external worker in its own checkout | a `factory/` branch, a pull request, verification artifacts. Waits have names — awaiting dispatch, awaiting QA, ready to merge; **Blocked** only when `request.blocker` names an obstacle, its owner and the next move. Three failed attempts escalate with a revised recommendation |
| QA | QA reads the contract, the diff and the evidence, never the conversation | `record_verdict` on the task, bound to the head it was read at, which files the merge card; then **the engineering owner merges** from a card carrying the commit, the verdict, the risk class and the rollback |
| released | whatever deployed writes the `release`; PM tells the asker on their channel and writes `told` on the request | a `release` with `healthAfter`; `told.status: sent`; and after `checkAfter`, `result`: helped / did not help / not enough evidence |

A person can view and progress any of it from chat: the PM surfaces the ask
as a card, the build decision is one card with a defined minimum (outcome, who
asked, recommendation, change, done when, spend and review minutes, main risk,
expected result), the approval gate renders inline, and "what should I do
right now" is answered from the records with links. Two people, two decisions:
the product owner commits, the engineering owner merges; a routine completion
reply can go out under a policy the product owner turns on.

## The five seats

| Seat | Agent | Owns | Never |
|---|---|---|---|
| PM | `product-manager` (lead) | triage, in scope or not, the plan, the contract, the backlog, telling the asker | merges, writes code |
| Design | `designer` | the mockup before a decision, the after-shot before a close | builds, decides |
| Eng | `task-engineer` (`runsOn: external-worker`) | the change the outcome needs (starting in `allowedPaths`), the checks with artifacts, the pull request | merges, deploys, touches a credential |
| QA | `change-reviewer` | the verdict against the contract and the evidence | merges, sees the engineer's conversation |
| Release | `release-engineer` | why a CI or a deploy is red and the move that answers it, the pipeline's own fixes, a down environment brought back (re-run, redeploy, roll back), environments | writes product code |

## Where the seats read and write (2.43.0)

The factory talks to three kinds of system, named for what they are: the
**code host** (`repo`), the **issue tracker** (`tracker`) and the **chat**
(`chat`). GitHub, Jira and Slack are the first provider of each; the source a
workspace connected decides which one answers, and no tool, skill or trust
rule names a vendor. Every read is a direct tool present when the agent has a
source of that family; every write is an action through `propose_action`,
with an Undo, at the rung `trust.yaml` gives it.

| Seat | Reads | Writes (actions) | Skills |
|---|---|---|---|
| every seat | `repo_read_pull`, `repo_read_diff`, `repo_read_file`, `tracker_read_issue`, `tracker_search_issues`, `chat_read_thread`, `lookup_person` | — | — |
| PM | the above, `describe_setup` | `tracker.create_issue`, `tracker.transition_issue`, `tracker.update_issue`, `tracker.comment` (a person sends), `chat.reply_in_thread` (a person sends), `chat.add_reaction`, `chat.post_message` (a person sends) | `set-up-the-factory`, `intake-from-chat`, `intake-from-the-tracker`, `mirror-the-tracker`, `tell-the-requester` |
| Design | `chat_read_file`, `tracker_read_attachment` | `tracker.attach_file`, `tracker.comment`, `chat.post_message` | `draw-from-the-ask`, `close-with-the-after-shot` |
| Eng | `repo_read_check_logs` (granted) | `repo.comment_pull` | `read-the-ask-whole`, `report-on-the-pull` |
| QA | `repo_read_check_logs` (granted); no chat, on purpose | `repo.submit_review` (filed by `record_verdict` as the verdict's mirror) | `review-on-the-pull`, `judge-the-checks` |
| Release | `repo_read_check_logs`, `repo_read_pipeline_runs`, `repo_read_tree` (granted); `draw_architecture` (granted, files the product's map) | `repo.rerun_failed_checks`, `repo.open_pull`, `repo.dispatch_pipeline`, `repo.revert_pull`, `repo.cancel_pipeline_run`, `repo.comment_pull`, `chat.post_message` (a person sends) | `explain-a-red-check`, `incident-update`, `map-the-codebase` |

The four GitHub actions and `slack.post_message` kept their former ids as
aliases (`Action.aliases`): a run recorded, a rule a workspace wrote or a
grant it gave under `github.open_pull` or `slack.post_message` still resolves
to `repo.open_pull` and `chat.post_message`.

## The nouns

`request` (the work item — one intake noun for a bug, a review, an email, an
incident, an ask), `architecture_plan`, `engineering_task` (the contract, the
durable record; `worker_run` beneath it is the lease), `release`, `product`,
`repo`, `environment` (where a product runs and how a change gets there —
the URL, the account and resource ids, the pipeline step, the health check, the
rollback — kept current by the deploy itself). Core ships the storage, the worker control plane, the review queue and
the trust ladder; this plugin ships what the fields mean.

## The request flow (backlog 054)

In a workspace with `durable: [factory]`, one durable run owns each request from its first Build to live. What that run does is this plugin's `workflows/request.yaml`, a declarative flow: plan or use the approved plan, attempt, retry on the kept branch up to three automatic attempts, stop and ask a person, merge on its trust rule or wait, deploy, release, and a live check that is done only when a result is recorded. Core runs it with the generic flow engine (`libs/durable/flow.ts`) and knows no factory names. What the factory knows about its world is in the actions the flow calls: `factory.dispatch_task`, `factory.read_attempt`, `factory.stop_request`, `factory.read_release_live` and `factory.check_live_again`. A run snapshots the file when it starts, so an edit changes new runs only.

## Missions and automations

Four missions: **close-the-gap** (no request waits more than a week, and
every shipped one carries a result — PM), **tell-the-requester** (every asker
hears back — PM), **prove-the-contract** (every criterion proven or named
unproven, every verdict bound to a commit — QA), **keep-the-pipeline-answered**
(no verified change waits on CI, a deploy or a worker without a next step —
Release). Nine automations wake them: a
request arrives, a build decision lands, the weekday planning pass, a failed
check on a factory branch, work finished, the two-hourly reply pass, the
weekday result pass, and QA's two reads (the proposal at triage, and one review per
pull request head when its checks pass, which must end in `record_verdict`).

The factory also carries a request through on its own (backlog 038), as plain
code on typed events rather than an agent choosing to press something. A
request filed in chat as a fix starts its build (`factory-request-filed` on
`object.created`); anything else ready to build gets the Build card. A contract
the plan rule gates plans first (`factory-plan-request`), the plan's approval
goes on the trust bar (`factory-plan-filed`), and the approved plan builds
itself (`factory-plan-approved`). A failed run is classified and recovered
(`factory-run-failed`) — plan first, send it again with what the checks said,
once more after the infrastructure failed, again only if the contract changed —
within three automatic attempts per request since a person last acted, then one
ask (`factory-recovery-answered` takes the answer). `factory-recover-stuck`
carries on, hourly, requests that were already stuck. The feature page and the
Work row say Planning, Recovering (attempt N of 3) or Stopped, each with what
happens next; every step is a line on the feature's Activity and on the run.

## Setting up, and the map (3.31.0)

A factory that is on but not set up says so before anything else. The plugin
declares what set up means (`plugin.yaml` `setup:`: GitHub connected, a
product and a repository on record); while any of it is undone the
workspace's chat leads with "Set up your software factory", and the PM's
`set-up-the-factory` skill walks the person through it — `describe_setup` for
the steps, one link per remaining step (the GitHub login is the approval),
nothing asked that a connection would answer. When GitHub connects
(`source.connected`), `finish-setup` has the PM read the grant with
`describe_sources` and propose the product and one repository record per
granted repository, for a person to accept.

Then the map. A repository record landing (`map-codebase`, on
`object.created`) has the Release seat read every repository on the product in
one call each (`repo_read_tree`: layout, manifests, workflows) and file the
product's architecture with `draw_architecture` — a typed graph of the
components and relationships the trees actually show, which the platform lays
out into an SVG and files on the product as a versioned artifact beside a
written summary. The product page shows both; `map-codebase-sweep` redraws,
once a day, the products whose repositories moved on. Nothing is painted by a
model, and no diagram lives in a code fence nothing renders.

## Trust

`trust.yaml` covers the eight actions core registers. A branch push is the
worker's own; a merge, a reply to an asker, an announcement, a deploy, a
provision, a cloud mutation and a credential write are a person's until the
workspace's ledger says otherwise. Every rule but the push ships disabled: the
workspace names who owns a merge. The exceptions are the factory's own starts —
`factory.dispatch_task.from_request`, `.recovery`, `.from_plan` and
`factory.approve_plan` — which run within the bar with Undo until a worker
claims the run, because each follows a decision a person already made.

## What this deliberately does not include

Performance and reporting pages, per-run activity logs, board counters, the
incumbent price check, dependency currency, the nightly e2e mission, tag audits,
batches of ten. Each was built; each was removed on 2026-09-24 because it
explained the machine rather than helping a person decide. What use demands
comes back as use demands it.

## The pipeline has an owner (2.25.0, backlog 049)

Webhooks first, a reconciler behind them. A red CI on a factory pull request
(`factory-ci-failure` on `pr.checks_completed`) is read by a typed model read
over GitHub's own evidence — the failing checks, their annotations, the failing
step's log tail, the files changed, and whether the base branch is red — and
routed in code (`services/factory/ciFailed.ts`):

| Cause | The move |
|---|---|
| `change_broke_it` | back to the engineer, the failing test named |
| `flaky` | the failed jobs re-run once (`repo.rerun_failed_checks`, done for you); a second failure is the change's |
| `main_broken` | one fix request on the default branch listing every pull request it blocks; each is brought up to date and checked again once the branch is green |
| `infra` | one ask to the Release engineer with the evidence, a re-run as its answer |

Every five minutes `factory-reconcile` reads open factory pull requests back
from GitHub and raises any `pr.*` event whose webhook never arrived (same
dedupe keys, so the same handler runs once), restarts a review that never
started, and asks about a run no worker picked up. A failed run on the deploy
branch (`deploy-run-failed`) is the Release engineer's incident. Every ten
minutes `environment-health` reads each environment's health check; one down
twice is recovered one step a pass (re-run, redeploy, roll back), and a person
is asked once only when the steps run out.
