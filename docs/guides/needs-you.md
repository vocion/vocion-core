# Needs you — the one decision surface

> "Review and Needs you feel like they're two things trying to do the same
> thing — what gives?" — product owner, 2026-09-15

They were. Both asked a person to do one job: read the evidence, decide, and
let the system learn from the decision. Only the *thing being decided*
differed — an agent-proposed action on Review, a question from the team on
Needs you. Two doors to one job is a choice a person has to make before they
have made any decision at all, so as of this guide there is one door.

**Needs you** (`/dashboard/inbox`) is where everything waiting on a person
lands, whatever it is. `/dashboard/review` forwards there permanently.

## What lands here

Every row has a **kind**. The kind says what you are deciding and picks the
screen you decide it on.

| Kind | What it is | Where it comes from | Opens at |
|---|---|---|---|
| **Proposal** | An action an agent wants to take with an outside effect — a CRM update, an email, an enrollment — or a change to the team the weekly [org review](./org-review.md) found (`org.change`: retire, re-scope, hire, adopt a standing rule), with its evidence. Approving executes it. A **hand-off** proposal (a merge, a deploy, a credential) is approved the same way, but approving hands it to a person to do rather than running it; see [Hand-off actions](#hand-off-actions). | `propose_action` → `action_run` (the former review queue) | `/dashboard/inbox/proposal-:id`; several about one record: `/dashboard/inbox/r/:recordKey` |
| **Ruling** | A decision only you can make; the team is blocked on it. | [`ask`](../entities/ask.md) with `kind: ruling` — filed by an agent's `file_ask` or over `POST /api/v1/asks` | `/dashboard/inbox/:id`; several under one group: `/dashboard/inbox/g/:groupKey` |
| **Approval** | Permission for something the team wants to do (nothing executes on answer). | `ask` · `approval` | as above |
| **Merge** | A pull request ready for a human to merge. | `ask` · `merge` | as above |
| **Input** | A fact, a file, an answer the team needs. | `ask` · `input` | as above |
| **Credential** | A key or a login the team needs to keep going. | `ask` · `credential` | as above |
| **Gate** | A run waiting for you to say go. | `ask` · `gate` | as above |
| **Recommendation** | A change the team proposes to itself — roles, models, budget. | `ask` · `recommendation` | as above |
| **Run** | A mission or workflow run that paused or is awaiting review; a worker run that paused, is awaiting review, failed or was lost in the last 24 hours. | `mission_run`, `workflow_run`, `worker_run` | `/dashboard/inbox/mission-:id` · `workflow-:id` · `worker-:id` |
| **Suggested rule** | A rule the feedback loop proposed from your corrections, waiting to be adopted — or a tidy-up of the rulebook: a **merge** of rules that say the same thing (the merged rule keeps their counts) or a **retirement** of rules nobody reads or a newer rule contradicts, with each rule's evidence. Keeping things as they are needs no reason. | `learning_candidate` | `/dashboard/inbox/learning-:id` |

A bare number in the URL is an ask — the shape every mailed and Slacked link,
and the API's `url` field, have always used. Every other kind spells itself
out (`services/inbox/inboxRef.ts`).

## The list

One flat queue, **oldest first** by default — a queue, not a feed. The header
is one line under the headline — *136 decisions, oldest waiting 53d.* — and
nothing else (Chris, 2026-09-15: "probably the only context we need"). What
changed is said by the toast that follows each decision; what happens next
is in that toast's second line.

- **Kind chips** with counts filter the list (`?kind=proposal,ruling`). The
  counts stay put while a chip is active so you can see what else waits.
- Under them, **action-kind** chips (`?actionKind=hubspot.update`) and
  **agent** chips (`?agents=deal-desk`) narrow proposals further.
- Each chip row is **one line**. `ChipRow` measures the real width of every
  chip and of the "+N more" control, shows as many as fit
  (`fitChips`), and folds the rest into a "+N more" menu where each is still
  a checkbox that toggles the same filter. Pinned ("All") first, active
  chips next, so a chip you turned on is never the one that hides. A
  ResizeObserver re-decides on every width change; nothing hard-codes a
  count.
- **Search** (`?q=`) matches what you see on the row; **sort** (`?sort=`) is
  oldest · newest · highest value · highest confidence.
- **Tabs**: *Open* · *Decided* (every kind that can be decided — proposals,
  asks, rules — newest first, with who decided, when and the note) · *Snoozed*
  (proposals snoozed into the future; asks do not snooze).
- Every control writes to the URL and nothing else, so a view can be
  bookmarked or pasted into a chat.

Rows follow the List archetype: a human title, a breadcrumb subline that
starts with the kind (`Proposal › Northwind › CRM update › proposed by
deal-desk`), right-aligned confidence · amount · age, and the kind's quick
verbs on hover. Several proposals about one record collapse into one sheet
row ("Northwind — 4 proposals"); several asks under one `groupKey` collapse
into one decision sheet.

### Deadlines and defaults

Every ask and every agent proposal on the list runs on a clock, so a queue nobody gets to does not
simply sit (the zero-person company stopped with 24 approvals nobody touched). Its row says when it
is due and what happens then — *due in 5h · then Approve* — and, once its deadline has passed
without the default applying, *past due · waits for you*, with the reason on hover.

| Moment | What happens |
|---|---|
| Opened | The sweep (`needs-you.sweep`, every five minutes) gives it a deadline — the ask's `dueAt`, else a day / three days / a week by risk — and a default: the ask's recommended option, or the proposal's own suggested decision (Approve or Decline). A decision older than its window is given a full notice from now, never defaulted on sight. |
| Before the deadline | Its accountable owner is told: the asking team's accountable human, else the workspace's `accountableUser`, else its owner, else its admins. One notification per person per sweep — *3 decisions need you: 3 due soon* — on the core kind **Decisions due**, with the channels the person chose for it. |
| At the deadline | The default **applies**, as a recorded decision by `by-default`, when the trust ladder would let that kind run without a person, or the default can be undone and is not high-risk — or it runs nothing at all (a proposal the agent itself advised declining, unless the installation lists its kind in `VOCION_HOLD_DECLINES`). It reads *applied by default* on the Decided tab, with Undo where the kind has one. |
| Otherwise | It is **held**: it stays here, says why (*it cannot be undone, and the trust ladder keeps it for a person*), and its owner is told again a day later. A kind the platform holds (`neverAuto`), a kind a person parked, a record that holds itself, no default, a workspace that is paused — all held, never run. |

Applying a default is never alignment evidence and never trains an agent: no person decided. An
Undo of a released proposal counts like the undo of anything the ladder released, and can demote
its kind; an Undo of an answered ask reopens it, and its default never applies again.

### Accept in one move

Above the list, the decisions in view whose recommendation reads the same are gathered — *12
recommend "Approve" · 9 approvals · 3 recommendations* — with **Accept all 12**. The items are one
click away under the line. Accepting decides each one as recommended, as you, through the same
service its own screen uses, so each is a decision in the alignment ledger and the learning loop
exactly as if you had clicked it. Anything decided or changed since you saw it is skipped and named
in the toast; a failure on one never stops the rest. Batches follow the filters, so *Approvals ·
ops-lead* batches only those. A decision sheet is already one move and is left to its own screen.

### Runs that wait on you

A run with nothing to do but wait no longer keeps spending. A worker run, a mission run or a
scheduled automation whose remaining work is all blocked on asks **parks**: it files ONE gate ask —
*Nothing ops-lead can do until the pricing tier for Northwind is answered* — and stops: a worker
run is paused and gives up its lease, a mission run stops before its next task, an automation's
scheduled checks are skipped (logged as `waiting_on_ask`). Answering what it waits on resumes it on
its own; the gate's **Resume now** resumes it as things stand, **Stop** cancels it (or pauses the
automation, in your name). A parked run shows here once, as its gate — never also as a paused run.
How a run parks: `POST /api/v1/worker-runs/:id/park` for a worker, the `wait_for_answers` tool for
an agent ([agent tools](./agent-tools.md#waiting-on-answers--wait_for_answers)).

### Across your workspaces

*All workspaces* (`?scope=all`) is the same open queue gathered from every
workspace you can switch to — your personal workspace included, nobody else's
— each row tagged with its workspace and linking to it there
(`/w/<slug>/dashboard/inbox/…?org=<org>`). Your own rows come first:
anything in your personal workspace, a proposal assigned to you, an ask your
own turn raised. Then the oldest. One chip per workspace narrows it
(`?workspace=<id>`); the counts stay whole.

A row from another workspace opens there and is never decided from this list,
because the decide endpoints act in the workspace the request runs in. Each
workspace's queue is read a few at a time and capped at 50 rows (yours kept
first); a capped workspace says so, and a workspace that could not be read is
named with its reason rather than left out. `inbox.mine` and `inbox.mineCount`
are the RPC forms of the list and its badge.

"Your day" (`briefings.personal`) is built on it: the queue, then each
workspace's latest brief by its headline, kept as a brief in your personal
workspace (`services/briefings/personal.ts`).

## The detail, by kind

Every detail screen wears the same chrome so the eye lands in the same place
whatever the kind: a breadcrumb **Workspace › Needs you › kind › record**,
the item as the H1, **one meta row** — system · status · who proposed or
asked · the confidence meter · *agrees with you N% (n=…)* from the alignment
ledger · the agent's own suggestion · your position in the queue — and a
**sticky action bar** at the bottom of the content column carrying the
kind's verbs. What sits between them is the kind's own detail.

| Kind | Detail | Verbs in the bar | Keys |
|---|---|---|---|
| Proposal | The action's card: drafts and sends (editable in place), the CRM diff, the research, the rationale, the evidence. Edits travel with Approve. Regenerate when the action supports it, driven by the one feedback field. | **Approve** · Decline · Snooze · Save for later · Skip | `a` approve · `d` decline · `s` snooze · `j` next · `k` back · `?` help |
| Ask (any ask kind) | The question, the short body, the options as tall touchable rows with the recommended one pre-selected, **Other** with a free-text answer, Details folded underneath. A group is a stepper: Next submits each answer in turn; a receipt closes the sheet. | **Submit** / **Next** (the chosen option is the verb) · Back | — |
| Run | A compact status page: why it stopped, a few facts, a link to the full run. | **Resume** · Cancel run (missions and workflows; a worker run only opens) | `a` resume · `d` cancel |
| Suggested rule | The rule, editable in place; which step it lands in; whether it says "keep doing" or "change"; how many times it was asked for. | **Adopt as rule** · Reject (a reason is required) | `a` adopt · `d` reject |

The verbs, their labels, their keys and which appear on a list row all come
from one table — `features/dashboard/inbox/decisionVerbs.ts` — so the sticky
bar, the hover verbs and the keyboard never disagree.

**Every submit is visibly pending.** Approve, Decline, Snooze, Resume, Adopt,
a row's quick verbs, the sheet's Submit and Next: the control disables and
shows a small spinner while the mutation is in flight, holds that state for
at least ~400 ms (`withMinimumPending`, `MIN_PENDING_MS`) so a fast server
does not flash, and exactly as long as the server takes when that is longer.
Nothing advances optimistically; the option list is disabled meanwhile so a
second click cannot double-submit; the keyboard respects the pending state.
On an ask sheet, **Next submits** — the question's answer is written before
the sheet advances, and a failure keeps the question on screen with the
selection intact.

**Every decision says what it did.** When a decision resolves, a toast
(`@/components/ui/toast`) names what was decided and what happens next —
*Approved · Update Northwind — Executing now.*; *Declined · … — Nothing runs;
the agent learns from it.*; *Snoozed · … — Back on Needs you Thursday.*;
*Resumed · … — The run continues.*; *Adopted · … — Agents read it on their
next run.* A failure is `toast.error` with the server's message, and the
screen stays where it was.

**Up next** on a proposal walks the *filtered inbox list*, not a separate
queue: the filters in the URL when you opened the proposal ride along on
every neighbour's address, so `j`/`k` from a proposal opened from
"Proposals · deal-desk" move through exactly those. Deciding moves to the
next proposal; when there is none, back to the list.

## Hand-off actions

Some of the work an agent asks for is done by a person, or by a system this
app does not host: merge this branch, run this deploy, paste this credential,
announce this release. Those are **hand-off actions** — registered actions
like any other (`propose_action` accepts them, `trust.yaml` gates them, the
autonomy page lists them), whose last step is performed outside this process.

The trail lands on the same `action_run` every other kind writes, so a merge
a person performed reads back beside a CRM update an agent performed:

| Step | Who | What the run says |
|---|---|---|
| Propose | the agent, with a confidence, a rationale and the shared hand-off input | `pending` — on Needs you under **Approvals**, with **Approve** as the verb |
| Approve | a person (or the trust ladder, for a kind that has earned it) | `awaiting_execution` — **approved, waiting to be done**: decided, not done. `result.handoff` names who approved it and when (the field is still spelled `releasedBy`). Nothing runs here. |
| Mark done | whoever did the work — the approver, or an API caller with the `approve` capability | `done` — `result.executed` carries who, when, their note and the result URL; `executedAt` is stamped |
| Could not be done | the same | `rejected`, with the reason — the same rejection as before approval |

The input is the same for every hand-off, because the person reading the
card — often on a phone — needs the same things whatever the system:

| Field | What it is |
|---|---|
| `title` | One line naming the thing. |
| `headline` | One plain sentence (≤ 140 chars) saying what approving does. Optional; the first sentence of `summary` stands in. |
| `summary` | Why, in a few sentences a person can check against the sources. |
| `steps` | The recipe, structured: `[{ say, run?, url? }]`, in order, at most 30. `say` is the step in words, `run` the exact command (its own monospace block with a copy button), `url` where the step happens. |
| `recipe` | The steps as one text block, whitespace kept — the fallback when `steps` is absent. One of `steps` or `recipe` is required. |
| `cost` | `{ amount, currency: 'USD', period?: 'once' \| 'month' \| 'year' }` — what approving commits to, when it costs anything. |
| `target` | Which account or environment it touches — "AWS account acme-prod (123456789012)". |
| `sources` | `[{ label, url }]` — named sources, rendered first as links. |
| `evidence` | Bare URLs or record refs, kept for callers that predate `sources`; URLs render as links after the named ones, refs as rows. |
| `externalRef` | `{ system, id, url? }` naming the record in the performing system. |

A specific kind may add a field — a merge carries a `riskClass` — and none
removes one.

The card leads with the decision header: the headline, then badges for the
system (Deploy, Git, AWS), **Irreversible** or Reversible (from the kind's
`manual.reversible`), the cost, and the target; under them, the
recommendation said once — *send-lead suggests approving · 90% confident*.
The **Recipe** tab shows the steps numbered, each command in its own block;
**Why** is one section, the agent's reasoning with its suggestion inline;
**Evidence** carries the named sources as links and, under *Run details*,
**Who runs it** (the assignee, else *Anyone with the account; mark done when
finished*) and the lifecycle — Approve → A person runs the steps → Mark done —
with the current step marked. Once done, that strip says who marked it done,
when, and where the result is.

The decision bar reads **Approve · Reject · Snooze** on a pending hand-off,
with the words beside the icons on a phone too. After approval the primary
reads **Mark done** and the note field is where the result goes (a PR link, a
deployment URL); the secondary is *Could not be done*, and Snooze goes. The
row on the list says *Approved — waiting to be done by hand* and opens the
detail rather than offering a quick Approve. A finished hand-off opens as its
card, read-only, so the trail can be read where the decision was made.

Over the API, the same three steps are `POST /api/v1/reviews/propose` (any
registered hand-off id), `POST /api/v1/reviews/decide` with `action:
"approve"`, and `POST /api/v1/reviews/decide` with `action: "done"`, a
`reason` (the note) and an optional `resultUrl`. `GET /api/v1/reviews/action/:id`
returns the run in any state, so a worker can poll for its approval. `done` on a
run that was never approved, or on a kind that runs in-process, is a 409.

**What ships as hand-offs.** The software factory's writes, registered in
core under one group (`libs/actions/factory.ts`) because a plugin cannot
register an action yet: `git.push_branch` (the only reversible one),
`git.merge` (with `riskClass`), `deploy.release`, `deploy.provision`,
`aws.mutate`, `credentials.write`, `release.announce`, `notify.requester`.
The factory plugin's `trust.yaml` rules bind to these ids. A merge is one
action id and ten ledgers: the trust rule, the risk tier and the alignment
evidence key on `git.merge.<riskClass>` (`Action.policyKeyFor`,
`libs/actions/policyKey.ts`), so docs can earn its way to running within
bounds while schema never does. Adding a hand-off is a descriptor passed to
`manualAction()` in `libs/actions/manual.ts` — nothing there knows about git.

## How a decision feeds learning and autonomy

Every decision, from every kind's screen and from the row's quick verbs,
goes through the same service the API uses — `ReviewService.decide` for a
proposal, `AskService.decideAsk` for an ask, `LearningCandidateService
.decideCandidate` for a rule — and so:

- **The alignment ledger** (`decision_alignment`) gets a row for every
  proposal and ask decision: what was recommended, what you chose, whether
  they agreed, whether a note came with it. That row is the *agrees with you*
  reading in the meta row, and the evidence the
  [autonomy ladder](./earned-autonomy.md) needs before it lets an action kind
  run without you. Skip, save, snooze and regenerate decide nothing and are
  not evidence.
- **The feedback classifier** gets your note. A decline or an *Other* with a
  reason is queued the same way a rejection from the old review queue was; a
  correction given three times becomes a suggested rule — which lands back on
  this list as its own kind, closing the loop (Manifesto #6).
- **Adoption** records each decision (`review.decided`, `ask.decided`,
  `learning.candidate_decided`).

## Where it lives

- **Service:** `services/InboxService.ts` — `listInbox` (tabs, kinds, search,
  sort, facets), `listProposalQueue` (Up-next order), `needsYouCount` (the
  sidebar badge). Read-only aggregation; nothing here decides anything.
- **Across workspaces:** `services/inbox/acrossWorkspaces.ts` —
  `listInboxForUser`, `needsYouCountForUser`, over `needsYouItems` per workspace.
- **Refs:** `services/inbox/inboxRef.ts`; **one proposal for its screen:**
  `services/inbox/pendingAction.ts`.
- **Clocks, defaults, batches, resume gates:** `services/needsYou/` —
  `DecisionClockService.ts` (the sweep, `undoAskDefault`), `owner.ts`, `batches.ts`,
  `ResumeGateService.ts`; the policy in `libs/needsYou/deadlines.ts`; tables `decision_deadline`
  (`0184`) and `resume_gate` (`0185`); RPC `inbox.acceptBatch`, `inbox.undoDefault`; UI
  `features/dashboard/inbox/RecommendationBatches.tsx`.
- **UI:** `app/[locale]/(auth)/dashboard/inbox/` (list, `[id]`, `g/`, `r/`);
  `features/dashboard/inbox/` (rows, controls, `AskSheet`, `RunDecision`,
  `LearningDecision`, `decisionVerbs`); `features/dashboard/ReviewFocus.tsx`
  (the proposal container) over `features/review/ReviewFocusView.tsx`.
- **Redirect:** `app/[locale]/(auth)/dashboard/review/page.tsx` → 308 to
  `/dashboard/inbox?kind=proposal`, `?type=` → `?actionKind=`.
- **Nav:** the route registry (`features/navigation/dashboardNav.ts`) carries no
  `/dashboard/review` row at all. The alias that keeps the old muscle memory —
  *Needs you · Proposals* → `/dashboard/inbox?kind=proposal` — is marked
  `paletteOnly`, so it answers ⌘K and never becomes a second sidebar door.
- **API:** unchanged — `/api/v1/reviews/*` for proposals,
  `/api/v1/asks/*` for asks, `/api/v1/learning-candidates/*` for rules. The
  surface changed; the decide paths did not.
