# Automations

Teach Vocion repeatable work once, from a narrated Slate recording, and run it
for every row you give it.

- **Teach** — share a Slate recording in chat ("Teach a task from this
  recording"), or press **Teach a task** on `/dashboard/automations`: the site
  opens in a new tab, you record it with Slate (⌥⇧R), and Vocion picks up the
  finished recording on its own. The Automation analyst drafts the steps (each
  linked to its moment), rules, escalation points and questions for the
  automation's expert.
- **Approve** — the expert answers the questions, approves the version and
  sets trust: Drafted (every save waits), Approved (the spec's saves run
  unattended), Autonomous (earned on verified runs).
- **Run** — hand it a list: one browser run per row, in parallel, watched as
  one queue. Escalations go to the expert as decisions in chat and on Needs
  you. Every change is read back and receipted; nothing is done twice.
- **Reconcile and report** — after the rows, it checks the system's list
  against yours and asks what to do with records that are not on it; the
  report says what was done, what it cost, and the time it saved.

Adds: the Automation analyst (`agents/routine-analyst.yaml`), the
`teach-a-routine` skill, the Automations team graded on verified runs, and the
Automations page (pinned in Workspace). Connect Slate on Connections first.

Customise by slug in your workspace: override the analyst with `extends:
core`, replace the skill, or change the team's targets.

The app opens at `/dashboard/automations`: **Recordings** are teaching inputs,
**Runs** are executions, and **Teach a task** starts teaching. **Schedules**
(`/dashboard/schedules`) controls time-based and event-triggered work separately.
Internal plugin, team and tool identifiers remain `routines` and `routine_*`.
