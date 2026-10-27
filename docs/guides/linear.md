# Linear

The `linear` source puts the issues of the Linear teams it lists into the
knowledge index, and makes Linear the workspace's **issue tracker**: the same
tracker tools and actions Jira answers ([jira.md](jira.md)) answer for Linear,
and an agent's skills change not a word.

## What it syncs

One document per issue — identifier, title, status, description — keyed by
Linear's immutable id (the identifier changes when an issue moves teams).
Incremental: issues updated since the last run, less five minutes. Full:
every open issue plus finished ones updated inside `doneWindowDays`, so
long-closed issues age out, as on Jira.

```yaml
kind: linear
config:
  projectKeys: [ENG, OPS] # team keys: ENG in ENG-123; issue keys route here by them
  doneWindowDays: 90
  includeDescription: true
```

## What agents can do

The tracker family (`services/tracker/provider.ts`):

| | |
|---|---|
| `tracker_read_issue` | An issue whole: status and its category, priority, labels, assignee, creator, comments, attachments, relations, and the team's other workflow states as its transitions. |
| `tracker_search_issues` | Plain words matched against title and description, inside the listed teams. |
| `tracker_read_attachment` | An uploaded file (from `uploads.linear.app`); a link attachment is named, not fetched. |
| `tracker.create_issue` | Files an issue on the team its key names; labels by name; a "type" that is also a team label (Bug) is added as that label; Highest/High/Medium/Low map to Linear's priorities. Undo deletes it (Linear keeps it in the trash 30 days). |
| `tracker.transition_issue` | Moves an issue to one of its team's states. Undo moves it back. |
| `tracker.update_issue` | Priority, labels, and a link attachment; Undo restores them and removes the link. Linear has **no fix versions**, so an update naming one is refused, saying so. |
| `tracker.comment`, `tracker.attach_file` | A comment, or a file uploaded and attached. Undo deletes either. |

## Auth

A **personal API key** (Settings → Account → Security & access), sent bare in
`Authorization` as Linear documents (an OAuth token goes as Bearer). It reads
every team its owner can see; the source narrows by team key. Test
connection names the account and checks each team key. No OAuth app is
needed.
