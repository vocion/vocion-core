# Projects (the `data-rooms` plugin)

One project per client or engagement. The project is **the collection around
it**: every transcript, thread and shared document
filed to it with a weight, every artifact written from it, the rules the agent
reads first, the notes it keeps, a dated timeline, the highlights worth keeping
for the case study, and the open items a person works from Review.

Projects themselves are core: the Projects page, its row in every app's
sidebar and the project tools are in every workspace, plugin or not. The
plugin slug keeps its old name (projects were "data rooms" until 2026-10-27),
as does the record type, `data_room`.

**What turning it on adds**

- The full `data_room` (Project) type: its schema, `publishTargets` and the
  classification prompt. Without the plugin a minimal type is created on first use.
- The `data-rooms` skill: how to file, weight, log a decision, keep status and
  open items, and read a project before writing from it.
- The **Project keeper** agent and its standing mission: once a day it reads what
  landed, files what the collector left as a question, refreshes each active
  project's status and timeline, and files highlights.
- The collector that runs after every sync: a clear match files with its score (undo on the project), a plausible one
  asks, a deal reaching Proposal stage opens its own project.
- The `data-rooms` team, graded on projects opened and sources filed.

**Customise it** in the workspace, never by editing the plugin: patch the keeper
with `agents/room-keeper.yaml` + `extends: core`, replace the skill whole-file at
`skills/data-rooms/SKILL.md`, add rules to a project from chat ("always file
Bellwater's calls here"), or tell the keeper what a good status reads like — it
becomes a learning.

Documents are written from projects; the **proposals** plugin depends on this one.
