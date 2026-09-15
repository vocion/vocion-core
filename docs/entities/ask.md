# Ask

An **ask** is one question waiting on a **person**. A ruling the team is blocked on, an approval
for something it wants to do, a credential or an input it needs from you, a pull request ready for
a human to merge, a change the team recommends to itself, a gate before a run may continue.

Unlike an [action](./trust.md) in the review queue, nothing executes when an ask is answered.
The answer *is* the outcome: whoever filed the ask — an agent, an external worker, a sync script —
reads it back over the API and acts on it. Asks are runtime objects, not authored files; they are
filed by code and answered on the **Needs you** page (`/dashboard/inbox`), which is where
everything waiting on a person is listed together: asks, review-queue items, paused runs, and
suggested rules.

## The reference: answering from a phone

The model follows how Claude Code's remote control asks its operator a question, because that is
the situation an ask is for — someone away from their desk, with a minute, who needs to give a
clear answer without reading a report.

- **One question per screen.** The title is the question; the body is two to four lines of why
  and what happens next. The long form lives behind `contextUrl` (the approval file, the PR, the
  run) and an optional collapsed **Details** section (`contextMd`). Short body first, evidence
  underneath — hide complexity, never hide truth.
- **Options are tall, touchable rows** with a label and a one-line description. At most one is
  `recommended`: it is pre-selected, drawn as the one obvious primary action, and carries a
  *Recommended* chip. Everything else is secondary. An ask with no options offers Approve /
  Reject / Mark done.
- **"Other" is always there.** Every ask accepts a free-text answer; the note *is* the answer. On a
  ruling, approval or recommendation an "other" answer sets `followUp`, because the asker has to
  read it and may need to ask again.
- **A decision sheet** is several asks sharing a `groupKey`: answered as a stepper — one question
  per screen, *Next →*, then a receipt listing every Question → Answer with an *Edit* per row and
  one *Submit all*. Each submit is one decide call, so a sheet that half-fails stays editable.
- **The list row is minimal**: title, kind chip, who asked, how long it has waited, risk. Nothing
  else — the question is read on its own screen.
- **Every answer makes the system smarter.** A `reject` or an `other` with a note is queued for
  the feedback classifier the same way a review-queue rejection is, so a correction given three
  times becomes a rule rather than three notes.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `kind` | `approval` \| `input` \| `ruling` \| `credential` \| `merge` \| `recommendation` \| `gate` | What sort of thing is waiting. Groups the inbox. |
| `title` | string | The question, as a person would ask it. |
| `body` | markdown, short | Why, and what happens on each answer. |
| `options` | `{ id, label, description?, recommended? }[]` | Named answers. Bare strings are accepted on POST and get `id = slug(label)`. At most one `recommended`. |
| `sourceRef` | string, unique per org | Idempotency key for asks filed from outside — `workforce:approvals/003-…`. Re-filing updates the open row; it never reopens a decided one. |
| `agentSlug`, `teamSlug` | slugs | Who is asking. |
| `risk` | `low` \| `medium` \| `high` | Shown as a chip on the row. |
| `groupKey`, `groupTitle` | strings | Several asks under one key form one decision sheet. |
| `contextUrl` | URL | The long form — the approval file, the PR, the run. `url` is accepted as an alias on POST. |
| `url` | URL, read-only | Where a person decides this ask: `/w/<workspace>/dashboard/inbox/<id>`, absolute when `NEXT_PUBLIC_APP_URL` is set. Present on every API response; paste this into Slack or an approval file, not a bare `/dashboard/inbox` path. |
| `contextMd` | markdown | Optional collapsed **Details**. |
| `dueAt` | timestamp | Informational. |
| `notifyAt`, `notified` | timestamp, boolean | Earliest time a notifier may ping about this ask, and whether one has. `AskService.pendingNotifications()` lists what is owed; nothing in core sends yet. |
| `status` | `open` \| `approved` \| `rejected` \| `done` \| `superseded` | `done` covers an option chosen, an "other" answer, and *Mark done*. |
| `decision` | string | `approve`, `reject`, `done`, `other`, or an option id. |
| `decisionNote` | string | Required with `other`; optional otherwise. |
| `followUp` | boolean | An "other" answer on a ruling / approval / recommendation — the asker owes a read. |
| `decidedBy`, `decidedAt` | | Who answered, when. |

## API

All calls take a tenant API token (`Bearer vcn_live_…`) or a dashboard session, scoped to that org.

| Call | What it does |
|---|---|
| `POST /api/v1/asks` `{ kind, title, body?, sourceRef?, agentSlug?, teamSlug?, risk?, options?, groupKey?, groupTitle?, contextUrl?, contextMd?, dueAt?, notifyAt?, projectId? }` | File a question. **201** `{ ask, created: true }` for a new one; **200** `{ ask, created: false }` when `sourceRef` matched an existing row (fields updated, status untouched). |
| `GET /api/v1/asks?status=open\|decided\|all&source=<prefix>&agentSlug=&kind=&groupKey=&limit=&offset=` | `{ items, total, limit, offset }`, newest first. `status` defaults to `open`; `decided` is every answered status; an exact status is accepted too. `source` is a prefix match on `sourceRef`. |
| `GET /api/v1/asks/:id` | `{ ask }`. Cross-org and missing ids both 404. |
| `POST /api/v1/asks/:id/decide` `{ decision, note? }` | Record the answer. `decision` is `approve` \| `reject` \| `done` \| `other` \| an option id; `other` requires `note`. **409** when the ask is not open. Requires the `approve` capability. |

A filer that mirrors an external queue polls `GET …?status=decided&source=<its prefix>` and acts
on `decision`, `decisionNote` and `followUp`.

## Example

`POST /api/v1/asks`

```json
{
  "kind": "ruling",
  "title": "One Slack app per workspace, or one per agent?",
  "body": "The Slack surface needs an identity model before #253 can ship. The company recommends one app per Slack-workspace × Vocion-project, with per-agent identity via chat:write.customize.",
  "sourceRef": "workforce:approvals/032-slack-app-granularity",
  "agentSlug": "ceo",
  "teamSlug": "executive",
  "risk": "medium",
  "groupKey": "workforce:2026-09-15-close-out",
  "groupTitle": "Close-out decisions",
  "contextUrl": "https://github.com/vocion/vocion-workforce/blob/main/company/approvals/pending/032-slack-app-granularity.md",
  "options": [
    { "id": "per-workspace", "label": "One app per workspace × project", "description": "Per-agent identity via chat:write.customize; a dedicated app only when an agent must be addressable.", "recommended": true },
    { "id": "per-agent", "label": "One app per agent", "description": "Each agent is its own Slack app and bot user." }
  ]
}
```

## Where it lives

- **Table:** `ask`, migration `0091`. Indexed by `(org_id, status)`, `(org_id, agent_slug)`,
  `(org_id, group_key)`; unique on `(org_id, source_ref)` where present.
- **Service:** `services/AskService.ts` (file, list, decide, supersede, notifications);
  `services/InboxService.ts` aggregates everything waiting on a person.
- **UI:** `/dashboard/inbox`, `/dashboard/inbox/:id`, `/dashboard/inbox/g/:groupKey`.
- **Adoption stream:** every answer lands as `ask.decided` with the kind and the resulting status.
- **Learning:** `services/feedback/askFeedbackQueue.ts` queues corrections for the classifier.
