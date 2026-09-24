# Software factory

A request becomes work, work becomes a release, and a person runs the loop
from a phone. Three pages, four seats, one loop.

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
| QA | QA reads the contract, the diff and the evidence, never the conversation | `verdict` on the task, bound to the commit it was read at; then **the engineering owner merges** from a card carrying the commit, the verdict, the risk class and the rollback |
| released | whatever deployed writes the `release`; PM tells the asker on their channel and writes `told` on the request | a `release` with `healthAfter`; `told.status: sent`; and after `checkAfter`, `result`: helped / did not help / not enough evidence |

A person can view and progress any of it from chat: the PM surfaces the ask
as a card, the build decision is one card with a defined minimum (outcome, who
asked, recommendation, change, done when, spend and review minutes, main risk,
expected result), the approval gate renders inline, and "what should I do
right now" is answered from the records with links. Two people, two decisions:
the product owner commits, the engineering owner merges; a routine completion
reply can go out under a policy the product owner turns on.

## The four seats

| Seat | Agent | Owns | Never |
|---|---|---|---|
| PM | `product-manager` (lead) | triage, in scope or not, the plan, the contract, the backlog, telling the asker | merges, writes code |
| Design | `designer` | the mockup before a decision, the after-shot before a close | builds, decides |
| Eng | `task-engineer` (`runsOn: external-worker`) | the change inside `allowedPaths`, the checks with artifacts, the pull request | merges, deploys, touches a credential |
| QA | `change-reviewer` | the verdict against the contract and the evidence | merges, sees the engineer's conversation |

## The nouns

`request` (the work item — one intake noun for a bug, a review, an email, an
incident, an ask), `architecture_plan`, `engineering_task` (the contract, the
durable record; `worker_run` beneath it is the lease), `release`, `product`,
`repo`. Core ships the storage, the worker control plane, the review queue and
the trust ladder; this plugin ships what the fields mean.

## Missions and automations

Three missions: **close-the-gap** (no request waits more than a week, and
every shipped one carries a result — PM), **tell-the-requester** (every asker
hears back — PM), **prove-the-contract** (every criterion proven or named
unproven, every verdict bound to a commit — QA). Ten automations wake them: a
request arrives, a build decision lands, the weekday planning pass, a failed
check on a factory branch, work finished, the two-hourly reply pass, the
weekday result pass, and QA's three red-team reads (the proposal at triage,
the diff at PR open, the evidence when checks pass).

## Trust

`trust.yaml` covers the eight actions core registers. A branch push is the
worker's own; a merge, a reply to an asker, an announcement, a deploy, a
provision, a cloud mutation and a credential write are a person's until the
workspace's ledger says otherwise. Every rule but the push ships disabled: the
workspace names who owns a merge.

## What this deliberately does not include

Performance and reporting pages, per-run activity logs, board counters, the
incumbent price check, dependency currency, the nightly e2e mission, tag audits,
batches of ten. Each was built; each was removed on 2026-09-24 because it
explained the machine rather than helping a person decide. What use demands
comes back as use demands it.
