# Goals and sprints

A **goal** is an outcome a person owns past one conversation: "Follow up with every Northwind Expo contact by November 30", "Activate the referral partners this quarter". It has a title, a horizon (a date or a quarter), an owner, one home workspace, and a measure. It lists under **Goals**, shows in the morning brief, and the lead is told about it at the top of every turn. Code: `libs/objectives/goal.ts` (pure), `services/objectives/GoalService.ts`, the agent tools in `services/agents/tools/goals.ts`, and the page at `/dashboard/goals/<id>`.

A goal is never made silently. The agent drafts it with `goal_create` as a Decision card (`goal.create`); the person approves it, edits it on the card first, or declines. Undo removes it.

## Three ways to measure a goal

A goal is measured one way, and never by a tick:

| Measure | What it is | How it moves |
|---|---|---|
| **View** | A saved view, plus what counts as done in it (`{"reply_state": "replied"}`) or a target count | Counted live from the index each time it is read: "12 of 40 contacted" |
| **Milestones** | 3 to 7 steps the agent proposes, each optionally linked to the work that completes it | A linked step is done when its work is (a record closed, an artifact or wiki page written, a view emptied); the agent may mark one done with evidence |
| **Sprint** | 2 to 10 weekly targets from a start date to the horizon | Logged a week at a time on a scorecard |

In every case the person's own hand wins. A milestone they tick or untick, or a number they write on a scorecard, is locked: no check and no agent moves it again.

## Sprints

A sprint is for a plan that runs on a weekly rhythm: "Sprint 2, Oct 26 to Jan 23: 3 discovery calls, 5 partner touches and 1 proposal a week". The goal's horizon is the sprint's last day; `starts` is its first. Its weeks are known by their Monday and read in the workspace's time zone (in a chat turn, the person's).

**The scorecard.** Rows are the weekly targets ("Discovery calls · 3 a week"), columns the latest six weeks up to this one, each cell the number logged that week: met in the pass tone, missed in amber, a dash where nobody logged it. A week nobody logged is a gap, never a miss. The owner writes a number by clicking its cell (`goals.setSprintValue`); an empty entry clears it.

**Progress** is the weekly targets met of those logged, with where the sprint is: "Week 3 of 13 · 7 of 10 weekly targets met". The next steps it proposes are "Log this week's numbers" while this week has gaps, and "What would move <the target missed most>?".

**What the agent does.** The agent logs a week with `goal_progress`: one number per target, each with the evidence it was counted from (the records, the view, the messages), plus an optional one-line note on the week. It never moves a number the person wrote, and asks the person for what it cannot count rather than guessing. A week that has not started, or one outside the sprint, is refused by name. When one entry is refused, the rest are still logged.

**Re-planning** the targets (`goal_update` with `targets`) keeps each kept label's key, so its logged weeks stay where they were.

### Tool shapes

Drafting a sprint:

```json
{
  "title": "Sprint 2: partner pipeline",
  "horizon": "2027-01-23",
  "weekly_review": true,
  "measure": {
    "kind": "sprint",
    "starts": "2026-10-26",
    "targets": [
      { "label": "Discovery calls", "per_week": 3 },
      { "label": "Partner touches", "per_week": 5, "unit": "touches" }
    ]
  }
}
```

Logging a week:

```json
{
  "goal": "GOAL-12",
  "week": "2026-11-02",
  "values": [
    { "target": "Discovery calls", "value": 2, "evidence": "2 discovery meetings on the calendar, Nov 3 and Nov 5" },
    { "target": "t2", "value": 6, "evidence": "6 partner threads with a reply this week" }
  ],
  "note": "Two partners out at a conference."
}
```

`week` is any day of the week and defaults to this one; `target` is a key (`t2`) or a label.

## The rules a goal keeps

- Every read is scoped to the goal's home workspace; every write also to its owner. Nobody moves another person's goal.
- Progress is never stored as the truth. The row keeps the last reading and when it last moved, so a line can be said without measuring again and a goal that has gone quiet for 7 days reads as stalled.
- From a Personal workspace, "Your goals" lists the person's goals across every workspace it reaches, each labelled with where it lives. An Org that keeps its items out of Personal shows only a count and a link.
