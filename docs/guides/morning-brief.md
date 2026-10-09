# Morning brief and evening wrap

Every person gets their own brief twice a day, at their own local times:

- a **morning brief** ("Your day") at about 07:30;
- an **evening wrap** ("Your wrap") at about 17:30.

Both are **briefings**: one noun, one composer, one budget. Each is stored in
the person's Personal workspace and listed with its history on that
workspace's **Briefings** page, beside the "your day" they can ask for at any
time. Asking for it and the schedule produce the same brief. There is one per
person, kind and local day, so asking at 07:00 and the schedule at 07:30 give
one row, refreshed, not two. The schedule also posts one short message in
Personal chat that says the brief's lead line and links to it.

Nobody has to switch them on: every Personal workspace gets them, at those
times, the day it exists. Each person can change the times, or turn either
one off, under **Notification settings → Your day**.

## What the brief says

1. **Today's meetings.** Each meeting is read live from the person's own Google
   Calendar ([personal connections](personal-connections.md)), with one line
   of context under it. That line is written from evidence gathered for the
   meeting:
   - the person's recent mail with the people outside the Org who are in it,
     read through their own Gmail;
   - what their workspaces' records say about its subject, from a keyword
     search of each shared workspace they reach. This covers the CRM,
     transcripts and anything else synced there, within the person's own
     source access.

   With no calendar connected, the brief says so and where to connect it. It
   never claims an empty day it did not check.
2. **Waiting on you, in the order to take it.** This is `waiting_on_me` across
   every workspace the person reaches: their decisions, oldest first, then
   follow-ups they owe. Each item is linked and dated.
3. **Since you last looked.** For each shared workspace where something moved
   since the person's last brief or wrap, it lists:
   - decisions others took;
   - runs that finished;
   - briefs that were published.

   A workspace where nothing moved is left out.
4. **Your workspaces.** Each workspace's latest brief, by its headline, dated
   and linked. A workspace with no brief and nothing waiting is left out.
5. **Up to three suggested actions.** They are pills under the chat message
   (`libs/chat/suggestions.ts`), never a Decision card: a suggestion asks for
   no consent. The brief itself only says where they are and does not list
   them a second time. Tapping one sends its words as the person's next
   message, which starts the assistant's turn on it; anything else is typed.

## What the wrap says

- **Done today:** what the person decided today, and runs that finished in
  their workspaces.
- **Still open:** what is waiting on them.
- **First tomorrow:** tomorrow's first meeting and the decision that has waited
  longest.

The wrap's suggested actions are things to set up for tomorrow.

## How it is written

Facts are rendered in code, and a small model writes only the words code
cannot:

- **In code:** every meeting, decision, link and date comes from a record or
  a live read (`services/briefings/personalFacts.ts`), rendered by the one
  composer (`services/briefings/personal.ts`).
- **From the model:** the classifier writes the context line under each
  meeting and the suggested actions, answering through a typed tool call. Its
  input is only the gathered facts. The call is charged to the person's
  Personal workspace (`personal.brief`).

If the model cannot answer, the brief still goes out. Each meeting's first
piece of evidence becomes its context line, and the oldest decisions become
the actions. The same applies when the brief budget says no to a brief the
person asked for: it is composed from the facts alone, with no model call.

## Limits

Briefs are on by default, and each one costs a model call. These limits keep
that spend to the people who want it. They are the money half of the brief
budget (`services/briefings/budgetGate.ts`). The attention half,
`services/briefings/budget.ts`, stays free of the database because the
Briefings page imports it in the browser.

- **The Org's switch.** **Daily briefs for your Org**, under Notification
  settings → Your day, is admin-only and on by default
  (`tenant_account.daily_briefs`). When it is off, nobody in the Org gets one.
  Each person's own times and switches sit under it.
- **Only people who are here.** A person who has not signed in or used the app
  in the last seven days gets none (`account_membership.last_active_at` /
  `last_login_at`). Their next time still moves on, so nothing piles up.
- **Nothing to say, nothing sent.** The cheap read runs first: records and one
  calendar call. If there are no meetings, nothing waiting, no team activity
  and, for the wrap, nothing done, there is no model call and no message.
  Meeting evidence (mail and record searches) is gathered only for a brief
  that will be written.
- **The budget.** The writer's call charges through the ordinary spend path
  (`chargeModelCall`, feature `personal.brief`), against the person's Personal
  workspace. Two checks run before every brief:
  - a hard cap on that workspace refuses the brief (`preflightCheck`);
  - across the Org, today's brief spend is held to the Org's daily cap. The
    admin sets it beside the switch (`brief_daily_cents`), or it falls back to
    the deployment's `VOCION_BRIEF_DAILY_CENTS`.

  Past either check, briefs stop for the day, and the Org's admins get one
  in-app notice ("Daily briefs paused for today").

**Expected cost.** One classifier call (Claude Haiku 4.5 at $1 in and $5 out
per million tokens) per brief or wrap. That is about 1.5–3k input tokens of
facts and about 300 output tokens, or roughly $0.003–0.005 each. A person who
gets both every working day costs about $0.20 a month. An empty day costs
nothing.

## Where it arrives

The brief is a briefing in the person's Personal workspace, titled for its day
("Your day — Fri, Oct 9, 2026"), with the edition `brief:2026-10-09`. It is on
the Briefings page with the rest of its history.

The schedule also tells the person in chat. Each delivery is its own
conversation in Personal, titled like the brief, holding one short assistant
message: the brief's lead line and a link to the stored brief.

- **The Decision card follows the message.** It is raised only after the
  message is written, so it never docks on an empty chat (the warm-chat rule,
  `emptyChat.mayDockCard`).
- **The opening hint points to it.** Until the person opens it, the opening
  hint in Personal says **"Your morning brief is ready →"** (or "Your evening
  wrap is ready →") and opens the stored brief. That is the hint ranker's
  `next` candidate, given an `href`. "Opened" means the delivery conversation
  has had a turn, or the person dismissed the hint.

## Push

The morning brief can also push to a Slack DM, a text or an email, with a link straight to the stored brief, along with urgent items. See [Push to you](push-to-you.md).

## When it goes out

- **The sweep.** `personal.rhythm-sweep` runs every five minutes on the durable
  executor, as a deployment schedule
  (`services/personal/rhythm/schedule.ts`). It is only the scheduler: the
  delivery it starts publishes through the briefings composer. On each run it
  does three things:
  1. It gives every Personal workspace a `personal_rhythm` row if it has none.
  2. It starts each due delivery as a `personal.rhythm` job. The job's id names
     the person, the kind and their local day, and the same id never runs
     twice.
  3. It moves the row's next time to the following day.
- **Once a day.** A delivery also finds its own day's conversation by its
  scope (`personal-rhythm:<kind>:<day>`) before writing anything, and the
  brief is upserted by its edition (`briefing.edition`, `<kind>:<day>`). A
  delivery started twice therefore lands once, and a person who asked for
  their day first still has one brief for it.
- **No other path.** Nothing else writes a personal brief. Workspace YAML
  schedules and `gen-team-brief` publish workspace and team briefs, and the
  deployment schedules have no other brief job.
- **Late ones are skipped.** A delivery more than two hours late, because the
  server was down, is skipped rather than sent. A morning brief at two in the
  afternoon is not one.
- **The person's own zone.** Times are wall-clock times there, so 07:30 stays
  07:30 across daylight saving. The first time the settings section opens, the
  browser's zone becomes the person's zone. Until then, rows use
  `VOCION_TIMEZONE`, then UTC.

Migration `0203_personal_rhythm` adds the `personal_rhythm` table: one row per
person per Org, holding their times, switches, zone, next and last deliveries.
It also adds the Org's switch and cap (`tenant_account.daily_briefs`,
`brief_daily_cents`). Migration `0205_briefing_edition` adds
`briefing.edition`, the once-only key of a personal brief.

## Pieces

| | |
|---|---|
| Clock arithmetic | `libs/personal/rhythm.ts` |
| Sweep, settings | `services/personal/rhythm/schedule.ts` |
| Composer, store (one per person, kind and day) | `services/briefings/personal.ts` |
| Facts | `services/briefings/personalFacts.ts` |
| The model call | `services/briefings/personalWriter.ts` |
| Budget | `services/briefings/budgetGate.ts` (money), `services/briefings/budget.ts` (attention) |
| Delivery (chat message, Decision, push) | `services/briefings/personalDelivery.ts` |
| Ask for it now | `briefings.personal` (`routers/Briefings.ts`) |
| Jobs | `personal.rhythm-sweep`, `personal.rhythm` (`services/background/catalog.ts`) |
| RPC | `personal.rhythm`, `personal.setRhythm` (`routers/Personal.ts`) |
| Settings | `features/personal/RhythmSettings.tsx`, on Notification settings |
| Opening hint | `services/chat/openingHints.ts` (`next` with `href`) |
| Tests | `libs/personal/rhythm.test.ts`, `services/briefings/personal.test.ts`, `services/briefings/personalDelivery.test.ts` |
