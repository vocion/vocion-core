# Data rooms

One room per entity — a deal, a project, an engagement. The room is **the
collection around that entity**: every transcript, thread and shared document
filed to it with a weight, every artifact written from it, the rules the agent
reads first, the notes it keeps, a dated timeline, the highlights worth keeping
for the case study, and the open items a person works from Review.

**What turning it on adds**

- The `data_room` object type with its schema and classification prompt.
- The `data-rooms` skill: how to file, weight, log a decision, keep status and
  open items, and read a room before writing from it.
- The **Room keeper** agent and its standing mission: once a day it reads what
  landed, files what the collector left as a question, refreshes each active
  room's status and timeline, and files highlights.
- The **Data rooms** row in the sidebar and the collector that runs after every
  sync: a clear match files with its score (undo on the room), a plausible one
  asks, a deal reaching Proposal stage opens its own room.
- The `data-rooms` team, graded on rooms opened and sources filed.

**Customise it** in the workspace, never by editing the plugin: patch the keeper
with `agents/room-keeper.yaml` + `extends: core`, replace the skill whole-file at
`skills/data-rooms/SKILL.md`, add rules to a room from chat ("always file
Bellwater's calls here"), or tell the keeper what a good status reads like — it
becomes a learning.

Documents are written from rooms; the **proposals** plugin depends on this one.
