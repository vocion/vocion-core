# ADR 0008 — When lives in automations; why and where-it-goes live on the mission

Status: accepted, 2026-10-24. Shipped in 8.0.0 (breaking).

## Context

The Marketing app (core #1453) runs paid search with one mission and two
timed automations: the check at 13:30 UTC, then a second automation at
13:50 UTC that mails "the latest marketing briefing". Building it surfaced
how missions and automations behave together. A red-team pass over the
real code found the following, most severe first.

| # | Finding | Evidence | Failure it causes |
|---|---|---|---|
| 1 | **The same check fired twice per tick.** A mission with `schedule:` **and** an automation that checks it on the same cron, in 17 of core's own plugins and templates and in every Metacto workspace that used them. | `software-factory/missions/tell-the-requester.yaml` `schedule: '0 */2 * * *'` + `automations/tell-the-requester-check.yaml`; `data-rooms` `rooms-current` + `rooms-daily-check` (`0 14 * * 1-5`); `finance` `books-coded` + `weekly-expense-coding` (`0 16 * * 1`) | Two reply passes every two hours, two room sweeps every weekday, two coding passes every Monday: double spend, and two agents racing over the same records. |
| 2 | **A mission's own `schedule:` skipped every guard an automation has.** It ran `mission.check` straight from the durable engine. | `services/background/startMissionRun.ts` (no row, no guard) vs `services/background/fireAutomation.ts` (`scheduleFireInFlight`, `waitingOn`, pause) | Invisible on /dashboard/automation (no `automation_run` row). Overlapped itself when a pass ran long. Kept spending while everything it had left waited on asks. Ignored a person's pause. No retry on a provider hiccup. |
| 3 | **Mail chained on a timer sent stale updates as new.** The email automation fires 20 minutes after the check *starts*, and the report job's briefing selector had no lower bound. | `services/reports/dailyTeamReport.ts` `fetchBriefing` (only `created_at < until`) | A check that failed or ran long mailed the previous briefing under its own title: Friday's update on Monday, as Monday's. The same pattern runs Revenue's `morning-briefing-email` and Workforce's `daily-team-report-email`. |
| 4 | **Every schedule was UTC.** The durable engine already takes a time zone; nothing passed one. | `libs/durable/jobs.ts` `ScheduleSpec.timezone`, `dbos.ts` `cronTimezone`; schema said "5-field cron, UTC" | "6:30am Pacific" is 5:30am from November to March. Health and next-run math were UTC-only too. |
| 5 | **Two dials did nothing.** `autonomyPolicy.level` gates only planner tasks of type `action`. A check is one task of type `analysis`, so no scheduled or automation check is ever gated by it. `agentType` is stored and read by nothing. | `MissionService.ts` (check task `type: 'analysis'`), `missions/autonomy.ts`, `applier.ts` (`agentType` written only) | Authors believe `level: 2` holds a check's actions; the trust ladder (`trust.yaml`, `approvalRequired`) is what does. |
| 6 | **"When" had three homes.** `automation.when`, `mission.schedule` and `workflow.trigger` (schedule or event, matched directly by `EventService.emitEvent`). | `WorkflowScheduleService.ts`; `EventService.ts` workflow matching | Workflow event triggers bypass the automation rate limit, coalescing and run log. |
| 7 | **No event fired for anything in an ad account.** | Event types emitted in core: none `ads.*` | Nothing between mornings could notice a disapproved ad or a runaway budget. |

Kept on purpose: **planner runs and check runs** are different jobs. A check
is one lead turn on a standing charter, cheap and frequent. A planned run
decomposes a one-off brief. Merging them would make every check pay for a
planner.

## Decision

**One concept owns when; one concept owns why and where the result goes.**
Shipped as **8.0.0**, a major release.

- **Automation = when.** A schedule or an event. Every schedule is read on a
  named clock: `when.timezone` is an IANA zone, or `workspace` for the
  workspace's `defaults.timezone`. When a schedule names none, it is read in
  the workspace's zone, so "30 6 * * 1-5" is 6:30am local all year. Every
  fire is logged, guarded against overlap, held while it waits on asks,
  pausable, retried once on a provider hiccup, and shown with its last and
  next run.
- **Mission = why, and where it goes.** It holds the goal, success criteria
  and autonomy, and `deliver:`, which says where a check's result goes when
  that check **finishes**:
  - a briefing it published is mailed;
  - nothing published sends nothing;
  - a failure sends a short note with the reason and the run, never an older
    briefing.

  A mission has no `schedule:`.
- **Events are how one thing wakes another.** The Marketing guard is a job
  (three reads, no model) that raises `ads.*` events with once-only dedupe
  keys, and an automation answers them with a check.

### What breaks, and the deprecation window

`workspace.yaml` `version: 2` is the 8.0 format.

- **Version-1 workspaces still load in 8.x,** with warnings. This is cheap:
  one rule in the loader.
  - Their own schedules are read in UTC, as before.
  - A mission's `schedule:` runs as the automation `<mission>-check` (UTC).
  - It is dropped when an active automation already checks that mission on
    a schedule, which is the double fire.
- **In version 2, a mission's `schedule:` is an error.** Version 1 is removed
  in 9.0.
- **Plugin automations follow the 8.0 rule in every workspace.** Core's own
  were rewritten with explicit `timezone: UTC` by the codemod, so they fire
  exactly as before. The Marketing plugin's say `timezone: workspace`.

### Migration

- **Database, migration 0220.** Adds `mission.deliver`. Backs up, to
  `migration_0220_backup`, every unzoned schedule and every mission cron. Pins
  those schedules to `timezone: UTC`, which is what they meant. Moves each
  mission cron that no active automation keeps to the automation
  `<mission>-check`. Safe to replay: `migrate.sh` runs every file on every
  deploy.
- **Manifests, `npm run migrate:automations -- <workspace>`.** A dry-run diff
  by default; `--write` applies it; it is idempotent.
  - Sets `version: 2`.
  - Pins every unzoned schedule to `timezone: UTC`. `--localize` instead
    rewrites a simple cron onto the workspace's clock.
  - Turns each mission `schedule:` into `automations/<slug>-check.yaml`, or
    removes it when an automation already keeps it.
  - Turns a `daily-team-report` mail timed after a check into that mission's
    `deliver:`.

  It ran on core's own templates in the same change, and found the 17
  double fires.

The upgrade, rollback and per-environment steps are in
`docs/deployment/v8.0.0-when-lives-in-automations.md`.

### Marketing, before and after

Before: three manifests, UTC, and mail on a timer.

```yaml
# automations/marketing-daily-update.yaml
when: {schedule: '30 13 * * 1-5'} # 13:30 UTC is 6:30 PT for half the year
do: {checkMission: daily-marketing-update}
```

```yaml
# automations/marketing-update-email.yaml
when: {schedule: '50 13 * * 1-5'} # 20 minutes later, finished or not
do: {job: daily-team-report, input: {hours: 24, briefing: {agentSlug: marketing-lead}}}
```

After: the workspace's clock, delivery on completion, a weekend read, and alerts.

```yaml
# missions/daily-marketing-update.yaml
deliver: {email: true} # sent when each check finishes
```

```yaml
# automations/marketing-daily-update.yaml
when: {schedule: '30 6 * * 1-5', timezone: workspace}
do: {checkMission: daily-marketing-update}
```

```yaml
# automations/marketing-weekend-summary.yaml
when: {schedule: '0 9 * * 6', timezone: workspace}
do: {checkMission: daily-marketing-update, prompt: Weekend summary …}
```

```yaml
# automations/marketing-guard.yaml — three reads, no model
when: {schedule: '15 */4 * * *', timezone: workspace}
do: {job: ads-guard}
```

```yaml
# automations/marketing-alert.yaml
when: {event: [ads.ad_limited, ads.pacing_off, ads.first_conversion]}
do: {checkMission: daily-marketing-update, prompt: Something changed …}
```

## Deprecated

- **`workspace.yaml` `version: 1`:** loads with warnings in 8.x and is removed
  in 9.0. That covers a mission's `schedule:`, refused in version 2.
- **A `daily-team-report` mail timed after a check:** use the mission's
  `deliver:`. The timed form still works, and now says when its briefing is
  not new.
- **Workflow `trigger: {type: schedule}`:** already warned on apply; unchanged.
- **`agentType`:** informational only; it drives nothing.

## Deferred

- **Workflow event triggers** (finding 6) still bypass the automation guards.
  Routing them through automations is the next step.
- **`autonomyPolicy.level`** (finding 5) is documented as planner-only.
  Folding it into the trust ladder needs its own decision.
- **Goal steering:** a cost-per-signup goal on the Goals and sprints system
  for Marketing, once a week of conversions exists to set it against.
- **Trust promotion:** routine negatives could climb the trust ladder.
  Spend changes stay approval-only.
