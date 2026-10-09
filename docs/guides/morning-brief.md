# Morning brief and evening wrap

Every person's own assistant writes them two messages a day, in their Personal
workspace, at their own local times:

- a **morning brief** at about 07:30;
- an **evening wrap** at about 17:30.

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
4. **Up to three suggested actions**, as one Decision card under the message,
   recommended first. Choosing one answers the Decision, which starts the
   assistant's turn on it. "Something else" takes the person's own words.

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
  a live read (`services/personal/rhythm/facts.ts`, `compose.ts`).
- **From the model:** the classifier writes the context line under each
  meeting and the suggested actions, answering through a typed tool call. Its
  input is only the gathered facts. The call is charged to the person's
  Personal workspace (`personal.brief`).

If the model cannot answer, the brief still goes out. Each meeting's first
piece of evidence becomes its context line, and the oldest decisions become
the actions.

## Limits

Briefs are on by default, and each one costs a model call. These limits keep
that spend to the people who want it (`services/personal/rhythm/guard.ts`):

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

Each delivery is its own conversation in the person's Personal workspace,
titled for its day ("Morning brief · Fri, Oct 9, 2026"), holding one assistant
message.

- **The Decision card follows the message.** It is raised only after the
  message is written, so it never docks on an empty chat (the warm-chat rule,
  `emptyChat.mayDockCard`).
- **The opening hint points to it.** Until the person opens it, the opening
  hint in Personal says **"Your morning brief is ready →"** (or "Your evening
  wrap is ready →") and opens that conversation. That is the hint ranker's
  `next` candidate, given an `href`.

## Push

The morning brief can also push to a Slack DM, a text or an email, with a link straight to it, along with urgent items. See [Push to you](push-to-you.md).

## When it goes out

- **The sweep.** `personal.rhythm-sweep` runs every five minutes on the durable
  executor, as a deployment schedule
  (`services/personal/rhythm/schedule.ts`). On each run it does three things:
  1. It gives every Personal workspace a `personal_rhythm` row if it has none.
  2. It starts each due delivery as a `personal.rhythm` job. The job's id names
     the person, the kind and their local day, and the same id never runs
     twice.
  3. It moves the row's next time to the following day.
- **Once a day.** A delivery also finds its own day's conversation by its
  scope (`personal-rhythm:<kind>:<day>`) before writing anything. A delivery
  started twice therefore lands once.
- **Late ones are skipped.** A delivery more than two hours late, because the
  server was down, is skipped rather than sent. A morning brief at two in the
  afternoon is not one.
- **The person's own zone.** Times are wall-clock times there, so 07:30 stays
  07:30 across daylight saving. The first time the settings section opens, the
  browser's zone becomes the person's zone. Until then, rows use
  `VOCION_TIMEZONE`, then UTC.

Migration `0203_personal_rhythm` adds the `personal_rhythm` table: one row per
person per Org, holding their times, switches, zone, next and last deliveries.

## Pieces

| | |
|---|---|
| Clock arithmetic | `libs/personal/rhythm.ts` |
| Sweep, settings | `services/personal/rhythm/schedule.ts` |
| Facts | `services/personal/rhythm/facts.ts` |
| Words | `services/personal/rhythm/compose.ts` |
| Delivery | `services/personal/rhythm/deliver.ts` |
| Jobs | `personal.rhythm-sweep`, `personal.rhythm` (`services/background/catalog.ts`) |
| RPC | `personal.rhythm`, `personal.setRhythm` (`routers/Personal.ts`) |
| Settings | `features/personal/RhythmSettings.tsx`, on Notification settings |
| Opening hint | `services/chat/openingHints.ts` (`next` with `href`) |
| Tests | `libs/personal/rhythm.test.ts`, `services/personal/rhythm/rhythm.test.ts` |
