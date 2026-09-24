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
| decided | PM recommends; **a person decides** from the card | `state: in_scope` or an honest answer; a mockup (Design) when it changes what people see |
| planned | PM | an `architecture_plan` when the work needs one, approved by a person; then the `engineering_task` contract |
| building | Eng, as an external worker in its own checkout | a `factory/` branch, a pull request, verification artifacts |
| QA | QA reads the contract, the diff and the evidence, never the conversation | approve / changes / reject, keyed to the contract; the merge is a person's |
| released | whatever deployed writes the `release`; PM tells the asker | a `release` with `healthAfter`; the asker told on their channel |

A person can view and progress any of it from chat: the PM surfaces the ask
as a card, the approval renders inline, and "what should I do right now" is
answered from the records with links.

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

Three missions: **close-the-gap** (no request waits more than a week — PM),
**tell-the-requester** (every asker hears back — PM), **prove-the-contract**
(every criterion proven or named unproven — QA). Eight automations wake them:
a request arrives, the weekday planning pass, a failed check on a factory
branch, work finished, the two-hourly reply pass, and QA's three red-team reads
(the proposal at triage, the diff at PR open, the evidence when checks pass).

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
