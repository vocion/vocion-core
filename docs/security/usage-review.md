# The daily usage review: data handling

The [daily usage review](../guides/usage-review.md) reads how people used each
shared workspace, so that using the platform makes it better. This document
covers what it reads, who sees the results, where they go, and the switches
that govern it. It describes the code in this repository. An operator's own
deployment choices (the model provider, mail) are named where they apply.

## 1. The two modes

| | Content and metadata | Metadata only |
|---|---|---|
| Read by code | Messages, turn statuses, costs, ratings, model and effort per turn, tool calls and their errors, decisions on proposals and asks | The same rows |
| Read by a model | Each judged thread's messages, cut to fit (1,200 characters a message, 14,000 a thread), with code's facts | **Nothing** |
| In the workspace's own report | Thread titles, the judge's words (intent, outcome, what would have been better), links | Numbers and theme counts. A thread is named by number and agent only |
| In the operator's roll-up | Per workspace: numbers, themes, and the threads most worth a look, missing connectors and skills, and effort mismatches | Numbers and theme counts only |

In metadata mode, re-asks are found by comparing a person's own messages in
code (trigram overlap). The text is read in memory for that comparison and
goes nowhere else: no model, no report, no log.

## 2. Which mode applies

Decided in one place, `services/usageReview/privacy.ts`, strongest first:

1. **The operator's override.** `VOCION_USAGE_REVIEW_CONTENT_ORGS` lists Org
   ids or slugs that are read with content. It is meant for the operator's
   own Orgs.
2. **The Org admin's choice.** The "Help improve Vocion: let the daily review
   read chat content" switch on the Members page
   (`tenant_account.usage_review_content`).
3. **The deployment's default.** `VOCION_USAGE_REVIEW_DEFAULT=on` is set in
   Vocion Cloud's app environment. Unset means off. It is never inferred from
   a hostname.

**On Vocion Cloud this is on by default, and an Org admin can switch it off.
Self-hosted installs start with it off.**

An admin's choice is stored as given, so changing the deployment's default
later never overrides it. An Org that cannot be read is read as metadata:
content is never the fallback. Every report states its mode and the reason.

Some threads are always metadata only:

- a thread opened from a record page, which belongs to one person;
- a thread that read a person's own connection (mail, calendar, files, DMs,
  GitHub). See [Google API data handling §9](google-api-data-handling.md#9-the-daily-usage-review).

Personal workspaces are never reviewed.

## 3. Who sees the results

| Who | What |
|---|---|
| The workspace's members | The report on the workspace's Briefings. Shared-workspace threads are already open to them, and a link opens a thread only for someone who could open it anyway |
| The workspace's admins | The same report, plus Manage → Insights → Usage review, and the fixes on Needs you |
| The deployment's operator | The daily roll-up, only where an extension names an operator (`usageReview` in `libs/extensions.ts`). Core alone names no one, and nothing crosses workspaces |
| The model provider the Org configured | Judged threads' text, sent with the workspace's own key when it has one (`buildChatModelForOrg('classifier', …)`), under the provider's no-training API terms. The call is charged to the workspace (`platform:usage.review`) and traced under `feature:usage.review` |

The roll-up never leaves the deployment it was built on. Each Org is rolled
up in the stricter of its report's mode and the mode it allows now.

## 4. What is stored

The report is the only artifact: a `briefing` row in the workspace, plus the
operator's copy in their Personal. Fixes are `action_run` rows (`org.change`)
carrying their evidence: thread links and the judge's one line.

Nothing is written onto a conversation, a message or a decision. A report is
deleted with its workspace, and a thread deleted later stays deleted: the
report holds a link and a title, not the messages.

## 5. Controls

- **Spend cap per workspace per day:** `VOCION_USAGE_REVIEW_DAILY_CENTS`,
  default 50 cents, and at most 60 items judged.
- **Unused days cost nothing.** The morning check is a code read with no
  model.
- **Turning it off:** turn off the `workspace-manager` plugin in a workspace,
  or switch the Org setting off to stop content reading Org-wide.
- **Tests:**
  - `services/usageReview/privacy.test.ts`: the defaults, the switch-off and
    the override;
  - `services/usageReview/UsageReviewService.test.ts`: no content to the
    judge or the report in metadata mode, personal-connection threads, the
    cap, skipping unused days;
  - `services/usageReview/rollup.test.ts`: no roll-up without an operator,
    content only from content Orgs, and the stricter mode wins.
