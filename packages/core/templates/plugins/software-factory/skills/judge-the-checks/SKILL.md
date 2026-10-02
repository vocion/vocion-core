---
slug: judge-the-checks
name: Judging the checks from their logs
description: >-
  How the reviewer reads a pull request's checks from the code host rather
  than from the engineer's report: the failing step and its log, which of
  the four causes it is (the change, a flaky test, a red default branch, the
  pipeline), and the rule that a criterion no check covered is written as
  unproven, never as passed. Read before judging any `requiredChecks` line of
  a contract.
playbooks: [verify-against-reality]
version: 1
---

# Judging the checks from their logs

The report says the checks passed. The host knows whether they did.
`repo_read_check_logs` on the pull request reads each failing check with its
annotations, the failing step and the tail of its log, the files the pull
request changes, and whether the same checks are red on the branch it
targets. Read it before the `checks` line of any verdict.

## The four causes, and what each means for the verdict

| What the log says | Cause | In the verdict |
|---|---|---|
| the failure is in or caused by a file the pull request changes | the change broke it | a `block` finding against `check`, with the test or step named; the verdict is `changes` |
| unrelated to the change, and the same check is green on the base branch | flaky | not the change's; say so in the finding as `note`, and leave the re-run to the pipeline's owner |
| the same checks fail on the branch the pull request targets | the default branch is broken | not the change's; `note`, and the criterion the check proves stays `unproven` until the branch is green |
| a runner, a secret, a service, minutes, disk | the pipeline could not run | not the change's; `note`, and the criterion stays `unproven` |

Quote the line of the log or the annotation that settles it. A check's name
is not evidence, and a green badge is not a log.

## Unproven is a status, not a failure

A criterion the checks did not cover — no test ran for it, the run that would
have proved it did not finish, the check is red for a reason that is not the
change's — is **`unproven`**, with the reason. It is never `proven` because
the engineer said so, and it is never a `block` finding when the change did
nothing wrong. An approve with an unproven criterion is refused by
`record_verdict`; a `changes` verdict names what would prove it.

## The runs behind a deploy

When the contract's checks include a deploy or a smoke run on the deploy
branch, `repo_read_pipeline_runs` lists the runs with their jobs and the step
that failed. Judge the run that corresponds to the pull request's head, by
sha, never the newest run.
