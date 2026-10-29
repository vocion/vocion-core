# The daily usage review: did each chat get people where they wanted?

> Someone asks for a renewal quote and gets a summary of the account instead.
> They ask again, and the second answer comes back without the pricing,
> because the pricing lives in a CRM nobody connected. Nothing failed, and
> nobody filed a bug. The person just stopped asking.

Using the platform should make the platform better. Every day a workspace
was used, the **Workspace manager** reads how it went: what each chat was
trying to do, whether the person got there, where they had to ask again, and
what was missing. It writes the day up as a report, and files each fix the
evidence supports as a proposal a person decides.

## Where it lives

- **The plugin.** `workspace-manager` is on by default in every shared
  workspace and sits in the Workforce app (`defaultOn` in its `plugin.yaml`;
  see [plugins.md](../plugins.md)). Turning it off on the Plugins page sticks.
- **The report.** Each report is a briefing on the workspace's Briefings,
  filed under the Workspace manager's own team, so it never takes the place of
  the workspace's main brief. Admins reach every day's report from
  Manage → Insights → **Usage review**, which is the Briefings archive
  filtered to the manager's team, not a second page.
- **The fixes.** Each fix is an `org.change` proposal on Needs you, filed on
  the same path the [org review](org-review.md) uses.
- **Across workspaces.** The operator's daily roll-up gathers every
  workspace's report (see [The operator roll-up](#the-operator-roll-up)).

## When it runs

1. `usage-review-check` runs at 06:00 in each workspace's own time zone
   (`timezone: workspace`). It is a code check with no model: was there a
   person's message, or a decision on an agent's proposal or ask, in the last
   24 hours? If not, nothing else happens and the day costs nothing.
2. When the workspace was used, the check raises `usage.review_due`, at most
   once per workspace day (the event's dedupe key is the date). The
   `usage-review` automation answers by starting the `daily-usage-review`
   mission.
3. The Workspace manager calls `run_usage_review` once. That tool runs the
   service (`services/usageReview/UsageReviewService.ts`), which reads the
   day, publishes the report and files the fixes. The agent replies with the
   outcome in three lines.

A paused workspace and a personal workspace are never reviewed.

## What it reads

The review reads rows the platform already writes. It adds nothing to a
thread, a message or a decision. **The report is the only artifact**, and its
judgements are made fresh each day.

| Read | From |
|---|---|
| Each chat thread a person wrote in, with that day's messages | `conversation`, `conversation_message` (status, cost, rating, turn ledger) |
| The model and effort level each turn ran at | `model_call` (`model`, `effort_level`, by `message_id`) |
| Tool calls and failures, matched to a turn by time | `tool_call` (`error`) |
| Each decision on a proposal or ask | `decision_alignment`, with `action_run` and `ask` for when it was raised and why |

**Facts are computed in code** (`facts.ts`):

- turns, time per turn, and spend;
- the effort level, model and thinking behind each turn;
- failed turns and failed tool calls;
- re-asks, with the turn that shows each one. A re-ask is a person's message
  that:
  - repeats one of their earlier messages (trigram overlap ≥ 0.45, compared
    in code);
  - follows a turn that failed; or
  - follows a turn they marked down.
- effort signals:
  - a Quick turn followed by a re-ask (it needed Standard);
  - a turn that ran into its time or spend ceiling;
  - a turn far over its time target;
  - a light request run at Deep.

**A model judges only where the Org allows it** (`judge.ts`). It reads each
thread with its facts and answers through one forced tool call. It returns:

- intent and goal;
- outcome (reached / partial / not reached / unclear);
- why the person had to ask again;
- whether the time and spend fit;
- whether the effort level fit, and the level the request needed;
- whether the thinking fit;
- any connector, skill or tool that was missing, named;
- output quality, with its reason;
- the one thing that would have been better;
- optionally, a standing rule that would have prevented the friction.

The judge interprets but never counts. The report prints code's numbers.
Decided approvals that were not raised in a thread read that day are judged
the same way, as items of their own.

The judge is the workspace's `classifier` model. A workspace's review may
spend at most `VOCION_USAGE_REVIEW_DAILY_CENTS` (default 50 cents) on it a
day, and at most 60 items. When there is more than that, it judges the
items with the most friction first and then a spread of the rest. The other
items are read from structure, and the report says how many were judged and
why.

## What a person reads

The report leads with the outcome:

- **Today:**
  - threads read;
  - the share of readable outcomes that got there;
  - the share of threads where people had to ask again;
  - approvals decided, and how often they matched the recommendation.
- **Risks:** the top three friction themes, each with its count and links to
  the threads that showed it.
- **Detail:**
  - the three threads most worth a look, each with what would have been
    better;
  - effort mismatches;
  - missing connectors and skills;
  - approvals people overruled;
  - the fixes filed;
  - how the review read the workspace.

Every row starts with a link to its thread.

## The fixes it files

Code chooses which fixes to file and the judge writes the words. At most
three are filed a day, through the org review's own path: `org.change`,
signal `usage`, under the Workspace manager's seat, each with its evidence
linked thread by thread.

| Fix | When | Approving it |
|---|---|---|
| `request_capability` (connector, skill or tool) | The judge named something the agents needed and did not have | Records the request. The approved run is what the operator's roll-up lists, and an extension may file it where the platform is built. For a connector, connecting is one sign-in on Connectors. Undo withdraws it. |
| `adopt_rule` | A thread that did not get there, where the judge wrote a standing rule that would have prevented it | Adopts the rule through the feedback loop's pipeline. Undo un-adopts it. |

A declined fix is not filed again for 30 days, and an open one is refreshed
in place rather than filed twice. Both behaviours come from the action's dedup.

## Privacy: content or metadata only

What the review reads is decided per Org, in one place
(`services/usageReview/privacy.ts`).

**On Vocion Cloud this is on by default, and an Org admin can switch it off.
Self-hosted installs start with it off.**

Org admins find the setting on the Members page: **Help improve Vocion: let
the daily review read chat content**. The line under the switch says what it
reads, who sees the results, and which default this deployment starts from.

| Mode | What is read | What leaves the Org's own report |
|---|---|---|
| **Content and metadata** | The judge reads each thread's messages with its facts | The operator's roll-up carries the threads most worth a look (title, link, what would have been better), the missing connectors and skills, and the effort mismatches |
| **Metadata only** | No model reads anything. Code works out counts, timings, spend, failures, re-asks (by comparing a person's own messages) and outcomes from structure (how the thread ended, how it was rated) | Numbers and friction-theme counts only. No thread is named, and nothing a person wrote appears. |

Which mode applies, strongest first:

1. **The operator's override.** `VOCION_USAGE_REVIEW_CONTENT_ORGS` takes a
   comma list of Org ids or slugs. Those Orgs are read with content whatever
   their setting. It is meant for the operator's own Orgs.
2. **The Org's own choice**, once an admin has made one
   (`tenant_account.usage_review_content`).
3. **The deployment's default.** `VOCION_USAGE_REVIEW_DEFAULT=on` is set in
   Vocion Cloud's app environment. Unset means off. It is never inferred from
   a hostname.

Every report says which mode it was read in and why.

Some threads are always read as metadata only, whatever the setting:

- a thread opened from a record page, which belongs to one person;
- a thread that read a person's own connection (their mail, calendar, files,
  DMs or GitHub, `PERSONAL_CONNECTIONS` in `libs/personal/connections.ts`).
  See [Google API data handling](../security/google-api-data-handling.md#9-the-daily-usage-review).

In the workspace's own report, a thread read as metadata is named by number
and agent ("Thread 412 with Deal desk"), never by its title.

## The operator roll-up

Core has no operator. Each workspace's report belongs to that workspace, and
nothing crosses workspaces until an extension names the deployment's operator
(`usageReview.operators()` in `libs/extensions.ts`; see
[extensions.md](extensions.md)). With an operator named:

- at 15:00 UTC, the `usage-review-rollup` job reads the last day's report from
  every workspace (`services/usageReview/rollup.ts`);
- it publishes **Usage across workspaces** to each operator's own Briefings
  (in their Personal);
- it mails the roll-up when mail is on (`VOCION_MAIL_ENABLED=1`);
- it hands the roll-up to any `onRollup` observer, such as an operator console.

It never leaves the deployment it was built on. A self-hosted install's
roll-up goes to that install's own operator.

Each Org is rolled up in the stricter of two modes: the mode its report was
read in, and the mode it allows now. An Org that switched content off after
yesterday's report contributes numbers only.

## Run it by hand

- **In chat:** ask the Workspace manager ("How did people use this workspace
  yesterday?"). It runs the review and answers with the link.
- **Agents:** an agent granted `run_usage_review` (`harness.grantTools`) can
  call the tool.
- **Over RPC:** `usageReview.run`.

## Code map

| Piece | File |
|---|---|
| Facts, re-asks, effort signals | `services/usageReview/facts.ts` |
| Reading the day | `services/usageReview/reader.ts` |
| The judge | `services/usageReview/judge.ts` |
| Privacy modes | `services/usageReview/privacy.ts` |
| The report | `services/usageReview/report.ts` |
| The run, sampling, the cap, the fixes | `services/usageReview/UsageReviewService.ts` |
| The operator roll-up | `services/usageReview/rollup.ts` |
| The morning check | `services/jobs/usageReviewCheck.ts` |
| The plugin | `packages/core/templates/plugins/workspace-manager/` |
| Default-on plugins | `services/plugins/defaultPlugins.ts` |
