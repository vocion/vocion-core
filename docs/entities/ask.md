# Ask

An **ask** is one question waiting on a **person**. A ruling the team is blocked on, an approval
for something it wants to do, a credential or an input it needs from you, a pull request ready for
a human to merge, a change the team recommends to itself, a gate before a run may continue.

Unlike a [proposal](./trust.md) (an agent-proposed action), nothing executes when an ask is
answered. The answer *is* the outcome: whoever filed the ask — an agent, an external worker, a sync
script — reads it back (over the API, or from the `ask.decided` event) and acts on it. Asks are
runtime objects, not authored files; they are filed by code — an agent's `file_ask` tool or
`POST /api/v1/asks` — and answered on **Needs you** (`/dashboard/inbox`), the [one decision
surface](../guides/needs-you.md) where everything waiting on a person is listed together: proposals,
asks, stopped runs and suggested rules, each tagged with its kind. An ask's `kind` is its inbox
kind; the kind chips filter the list to it, and its detail screen wears the same chrome as a
proposal's — breadcrumb › kind › record, the meta row with the asker's alignment, the sticky bar.

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
  per screen. *Next* submits that question's answer (one decide call), holds a visible pending
  state until the server answers (never less than ~400 ms), and only then advances; a failure keeps
  the question on screen with the selection intact. The receipt at the end lists every Question →
  Answer with its outcome and a *Fix* on anything that failed, so a sheet that half-fails stays
  editable. Each answer is confirmed by a toast naming the choice and what happens next.
- **The list row is minimal**: title, kind chip, who asked, how long it has waited, risk. Nothing
  else — the question is read on its own screen.
- **Every answer makes the system smarter.** A `reject` or an `other` with a note is queued for
  the feedback classifier the same way a review-queue rejection is, so a correction given three
  times becomes a rule rather than three notes. Every answer also lands in the alignment ledger
  (`decision_alignment`): did the person choose the option the team recommended? That is the
  *agrees with you* score on the sheet, and the evidence the [autonomy ladder](../guides/earned-autonomy.md)
  reads.

## Writing a good ask

The screen clamps whatever arrives — a two-line title, two sentences of body, two lines per option
— and folds the rest under **Details**, so a verbose ask still reads. But a filer that writes short
gets a better answer, faster. The limits the server hints at in its log (a warning, never a
refusal): **title ≤ 80 characters, body ≤ 400**. Put the long form in `contextMd`, the source in
`contextUrl`, and let an option's `description` say what the body does not — a description that
repeats the body's first paragraph is hidden as a duplicate.

Before — three lines of title, nine of body, options that restate it:

```json
{
  "title": "Decision needed on Slack app granularity for the Vocion Slack surface (item 032): should each Vocion project map to a single Slack app, or should every agent be its own Slack app and bot user?",
  "body": "The Slack surface needs an identity model before #253 can ship. The company recommends one app per Slack-workspace × Vocion-project, with per-agent identity via chat:write.customize. A dedicated app would only be needed when an agent must be addressable directly. This has been open since cycle 52 and blocks the manifest reinstall in 035. The board reviewed three alternatives … (five more sentences)",
  "options": [
    { "id": "per-workspace", "label": "One app per workspace", "description": "The Slack surface needs an identity model before #253 can ship. The company recommends one app per Slack-workspace × Vocion-project …", "recommended": true },
    { "id": "per-agent", "label": "One app per agent", "description": "Every agent is its own Slack app and bot user, which the company considered and …" }
  ]
}
```

After — the question, why it matters, and what each answer means; everything else behind Details:

```json
{
  "title": "One Slack app per workspace, or one per agent?",
  "body": "The Slack surface needs an identity model before #253 ships. It has blocked the manifest reinstall (035) since cycle 52.",
  "options": [
    { "id": "per-workspace", "label": "One app per workspace × project", "description": "Per-agent identity via chat:write.customize; a dedicated app only when an agent must be addressable.", "recommended": true },
    { "id": "per-agent", "label": "One app per agent", "description": "Each agent is its own Slack app and bot user; more installs, cleaner addressing." }
  ],
  "contextUrl": "https://github.com/vocion/vocion-workforce/blob/main/company/approvals/pending/032-slack-app-granularity.md",
  "contextMd": "## The three alternatives the board considered\n\n…"
}
```

The `title` is the question a person would ask aloud. The `body` is the two sentences they need
before choosing. An option's `description` is the consequence of picking it. The recommended option
carries a *Recommended* chip and nothing more.

## Filed by an agent

An agent inside the app files an ask with the **`file_ask`** tool and takes one back with
**`withdraw_ask`** ([agent tools](../guides/agent-tools.md)). Neither calls the service directly:
both are actions on the [trust ladder](./trust.md) — `ask.file` and `ask.withdraw` — because whether
an agent may interrupt a person unasked is a trust question. Both are internal, `low` risk and
reversible, so the default is *done for you*: a filing with confidence at or above 0.8 lands on
Needs you at once and shows on the Review queue's Decided tab with **Undo**, which withdraws the
question while it is still open. Below the bar, or in a workspace whose `trust.yaml` parks
`ask.file` at `execute-with-approval`, a person first sees the proposal to ask — the question, its
options, what it is about — and approving it is what files it.

What the tool stamps that the model never types: `agentSlug` (the asking agent), `sourceRef`
(`action_run:<id>`, the run that asked — a retried execution updates the ask it already filed
rather than asking twice), and `contextUrl` when the caller gave none — the mission run the question
came up in, so a person opening the ask reaches the work that raised it in one move. The receipt the
agent reads back carries the ask's id and its URL on Needs you.

An ask filed this way should say **what it is about**: `objectRefs` names the records, and they
ride the `ask.decided` event beside the agent slug and the kind, so an automation filtered on
`{ agentSlug: product-manager, kind: recommendation }` can write the person's answer back onto the
request the recommendation was about. `groupKey` gathers a batch of asks into one decision sheet;
`decisionCost` says how many minutes of attention each takes, which is what a batch is metered by.
Undo never unwrites an answer: undoing the filing of an ask a person already decided leaves the
decision as it is and says so on the run.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `kind` | `approval` \| `input` \| `ruling` \| `credential` \| `merge` \| `recommendation` \| `gate` | What sort of thing is waiting. The inbox kind — the chips on Needs you filter by it. |
| `title` | string | The question, as a person would ask it. |
| `body` | markdown, short | Why, and what happens on each answer. |
| `options` | `{ id, label, description?, recommended?, confidence? }[]` | Named answers. Bare strings are accepted on POST and get `id = slug(label)`. At most one `recommended`. `confidence` (0–1) is how sure the asker is of that option — meant for the recommended one, so the sheet shows *Recommended with 72% confidence · agrees with you 92% (n=48)* the way a review card does. Advisory only. |
| `sourceRef` | string, unique per org | Idempotency key for asks filed from outside — `workforce:approvals/003-…`; `action_run:<id>` on one an agent filed. Re-filing updates the open row; it never reopens a decided one. |
| `agentSlug`, `teamSlug` | slugs | Who is asking. Stamped from the run when an agent files it. |
| `objectRefs` | `{ type, id }[]` | The records the question is about — an object type slug and the object's id (a string; a number is accepted). At most 20. Carried on `ask.decided`, so the answer can be written back onto them. |
| `decisionCost` | integer, minutes | How much of a person's attention the decision is estimated to take. Said by the asker; a batch of asks is metered by the sum. |
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
| `POST /api/v1/asks` `{ kind, title, body?, sourceRef?, agentSlug?, teamSlug?, risk?, options?, objectRefs?, decisionCost?, groupKey?, groupTitle?, contextUrl?, contextMd?, dueAt?, notifyAt?, projectId? }` | File a question. **201** `{ ask, created: true }` for a new one; **200** `{ ask, created: false }` when `sourceRef` matched an existing row (fields updated, status untouched). |
| `GET /api/v1/asks?status=open\|decided\|all&source=<prefix>&agentSlug=&kind=&groupKey=&limit=&offset=` | `{ items, total, limit, offset }`, newest first. `status` defaults to `open`; `decided` is every answered status; an exact status is accepted too. `source` is a prefix match on `sourceRef`. |
| `GET /api/v1/asks/:id` | `{ ask }`. Cross-org and missing ids both 404. |
| `POST /api/v1/asks/:id/decide` `{ decision, note? }` | Record the answer. `decision` is `approve` \| `reject` \| `done` \| `other` \| an option id; `other` requires `note`. **409** when the ask is not open. Requires the `approve` capability. |

A filer that mirrors an external queue polls `GET …?status=decided&source=<its prefix>` and acts
on `decision`, `decisionNote` and `followUp`. An agent inside the app files with `file_ask` instead
of the API — see [Filed by an agent](#filed-by-an-agent).

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

- **Table:** `ask`, migration `0091`; `object_refs` and `decision_cost` in `0129`. Indexed by
  `(org_id, status)`, `(org_id, agent_slug)`, `(org_id, group_key)`; unique on `(org_id, source_ref)`
  where present.
- **Service:** `services/AskService.ts` (file, list, decide, supersede, reopen, notifications);
  `services/InboxService.ts` aggregates everything waiting on a person.
- **Actions:** `libs/actions/ask-file.ts` (`ask.file`) and `libs/actions/ask-withdraw.ts`
  (`ask.withdraw`) — how an agent files and withdraws through the trust ladder; the tools are
  `services/agents/tools/fileAsk.ts`.
- **UI:** `/dashboard/inbox` (filter with `?kind=<ask kind>`), `/dashboard/inbox/:id`, `/dashboard/inbox/g/:groupKey` — see [Needs you](../guides/needs-you.md).
- **Adoption stream:** every answer lands as `ask.decided` with the kind, the resulting status, the
  asking agent and the `objectRefs` it was about.
- **Learning:** `services/feedback/askFeedbackQueue.ts` queues corrections for the classifier;
  `services/alignment/AlignmentService.ts` records every answer as alignment evidence.
