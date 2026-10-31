# Automations

An automation is a repeatable process a specialist taught once, that Vocion runs,
escalates and improves over time. Every automation has a human expert responsible
for its exceptions.

The specialist records the work in Slate on the real system, saying why each
step happens. Vocion turns the recording into an automation. Its expert answers
what one example cannot settle and approves it. From then on Vocion runs it for
every row it is given, many at once, each in a browser of its own. A run holds
before anything the approved spec does not allow, and asks the expert when a
rule says so. It reads back every change it made.

Turn it on with the `routines` plugin (`plugins: [routines]`, or **Apps →
Automations**). It needs browser runs ([Browser runs](./browser-runs.md)) and,
to teach from a recording, a Slate connection on **Connections**.

Recordings are teaching inputs; Runs are executions of an approved automation.
Use **Teach a task** to start teaching. **Schedules** is a separate workspace
control surface for recurring schedules and event-trigger rules.

## The lifecycle

| | What happens | Where |
|---|---|---|
| **Teach** | Share a Slate link in chat ("Teach a task from this recording"), or press **Teach a task** on `/dashboard/automations`. The second opens the site in a new tab; record it with Slate (⌥⇧R on that tab), and Vocion picks up the finished recording on its own. | `routine_teach`, `routines.teach` |
| **Draft** | The Automation analyst reads the transcript, what was on screen, and frames at the moments that matter. It drafts the steps (each linked to its moment), the rules, where to escalate, what is prohibited, the inputs (which every row shares, which identify a row), the outputs to read back, the buttons that save, and how to check the whole list. It ends with questions for the expert. | `services/routines/teaching.ts` |
| **Approve** | The expert answers the open questions and approves the version. Runs are pinned to a version. A later correction is a new draft version, never an edit of the live one. | `routine_update`, the automation page |
| **Trust** | **Drafted**: every consequential click waits for a person. **Approved**: the writes the spec names (for example "Add user", "Enroll") run unattended; anything else still waits. **Autonomous** is earned after 20 verified runs of the version. The engine enforces it, not a prompt. | `browserLoop` `hold` |
| **Run** | Hand it a list. One browser run per row, up to 10 at once per workspace (`VOCION_ROUTINE_CONCURRENCY`), the rest queued. Shared inputs (the sign-in, the campaign) are given once. | `routine_run`, the automation page's **Run it** |
| **Escalate** | A run that meets an escalation point stops and asks the expert. The question carries the page as evidence and its answers, the recommended one first. It is a Decision docked in the conversation the batch was asked from, and on Needs you. The answer goes back to the run, which carries on. | `escalate` tool in the loop |
| **Receipt** | Each output the spec says must match an input is read back after the write and checked. A run that stopped after a write it cannot confirm is an **unknown outcome**: it is never replayed, and the expert checks it by hand. | `receiptFor` |
| **Reconcile** | After the rows, when the automation adds records to a list, one read-only run lists the system's records. Records that are not among the rows become a finding: deactivate them, delete them, or leave them. The expert's answer runs as its own batch under the automation, and only that change is allowed. | `findingFromReconcile` |
| **Report** | Results verified by read-back, escalations and how each was answered, human minutes against the manual baseline from the recording, run cost, and the findings. Filed as an artifact. | `routine_report` |

## The queue

`/dashboard/automations/batches/<id>` is a batch: a tile per run with its live
picture, the step it is on and why, and what it waits on, with the answers as
buttons. A done tile shows its receipt. The batch opens in the preview pane
when it is started from chat, with a chip under the answer that says where it
stands ("17 of 20 done · 2 escalated").

## Guarantees

- **Nothing is done twice.** The dedupe ledger keys each row by the automation's
  key inputs (an email, an account). A row this automation already did is skipped
  and says where it was done.
- **Every run has its own browser.** Cookies and storage are not shared
  between rows, and the browser closes when the run ends.
- **Approvals stay with people.** At Approved trust only the spec's named
  writes go ahead; a delete, a deactivate or a send still waits unless the
  expert's answer to a finding approved exactly that.
- **Restarts are pauses.** An automation run is a browser run, so it is picked up
  from its checkpoint after a deploy. An answer given meanwhile is kept and
  delivered when it waits again.
- **Secrets stay sealed.** A batch's password is sealed under the workspace's
  key, reaches each run as `{{password}}`, and is never shown to the model.

## Workflows

Each version also has a `workflow.yaml` a workspace can keep, with one
`routine.run` action step. `routine.run` is an action that runs: a workflow step
with `action: routine.run` and `input: {routine, rows, shared}` starts a batch.

## Practice

`/dashboard/automations` → **Try the practice automation** files "Add a user and
enroll them (practice)", taught and approved on the practice training console
(`services/browser/practiceConsole.ts`, fictional data, served inside the
browser). **Run it for the practice roster** runs it for 20 people. Two of
them escalate: a possible duplicate (same name, different email) and someone
already enrolled. The session expires once mid-task. The reconciliation finds
three users who are not on the roster.

## Code

- `libs/routines/types.ts`: the shapes every surface reads
- `services/routines/RoutineService.ts`: teach, approve, trust, batches,
  escalations, receipts, reconciliation, report, the keeper
- `services/routines/teaching.ts`: the Automation analyst
- `services/routines/routineReads.ts`: the light reads pages use
- `libs/slate/recording.ts`, `libs/slate/watch.ts`: reading a recording over
  Slate's MCP server, and finding a new one after a launch
- `services/agents/tools/routineTools.ts`: the chat tools
- `features/routines/`: the pages and the pane
- `templates/plugins/routines`: the plugin (the Automation analyst, the skill,
  the team graded on verified runs)
- migration `0211_routines.sql`
