# Email — reports out, and a mailbox per workspace

Vocion can mail a person. Today one thing uses it: the **daily team report**, a
trailing-24-hour read on what the workforce did — runs, spend and token weight
per team and per member, board-level and red-team runs called out, the count of
items waiting on a human, and the latest workspace briefing — delivered to the
workspace's accountable human every morning.

The mail follows the [Product Design Manifesto](../MANIFESTO.md): it answers,
in this order, **What changed? What needs me? Are we on track? What happens
next?** Outcomes and the needs-you count lead; the per-team table follows;
tokens, cents and run counts come last, as evidence for what was said above
them — no metric without the outcome it serves. It is meant to read in one
screen on a phone, calmly.

Two more properties are deliberate:

- **It ships dark.** Nothing is sent unless `VOCION_MAIL_ENABLED=1`. With the
  flag off, the report is still generated and stored as a workspace briefing,
  so `/dashboard/briefings` shows it and nothing half-sends.
- **The schedule lives in the workspace, not the server.** A workspace opts in
  with one automation file. A deployment with three workspaces mails three
  reports, or one, or none — each workspace decides.

## What you need

- A [Resend](https://resend.com) account (free tier is enough for daily mail).
- A domain you control, to send from. Resend will not deliver from a domain it
  has not verified.

## 1. Verify a sending domain in Resend (human step — DNS)

In Resend: **Domains → Add Domain**, enter the domain you will send from (for
example `metacto.com`, or a subdomain such as `mail.metacto.com` to keep the
root domain's records untouched). Resend shows three DNS records:

| Record | Purpose |
|---|---|
| `TXT` on `resend._domainkey.<domain>` | DKIM signing key |
| `MX` on `send.<domain>` (or the subdomain) | bounce handling |
| `TXT` SPF on the same host | `v=spf1 include:amazonses.com ~all` |

Add them at your DNS provider and wait for Resend to show **Verified**
(minutes to an hour). Until then a send returns `403` and the job records
`PROVIDER: Resend rejected the message (403): …` in its result — the briefing
still lands in-app.

## 2. Create an API key

**API Keys → Create**, scope *Sending access*, restricted to the domain above.
Copy it once.

## 3. Configure the server

On the app **and** the Temporal worker (the job runs in the worker):

```bash
VOCION_MAIL_ENABLED=1
RESEND_API_KEY=re_…
VOCION_MAIL_FROM="Vocion <reports@metacto.com>"     # on the verified domain
NEXT_PUBLIC_APP_URL=https://agents.metacto.com     # links in the mail
```

Links in the mail are workspace-aware: `https://agents.metacto.com/w/<workspace-slug>/dashboard/inbox`
opens the workspace the report is about, whichever one the reader last had active
(see [routing](../routing.md)).

`VOCION_MAIL_FROM` is the default sender for every message; a caller may
override it per message. All three are declared in `libs/Env.ts` and documented
in `.env.example`.

## 4. Schedule the report in the workspace

```yaml
# automations/daily-team-report.yaml
slug: daily-team-report
name: Daily team report
description: Every morning, the accountable human gets a read on what the team did and what is waiting on them.
agent: ceo # the workspace lead — the schedule rolls up to a visible owner
when:
  schedule: '0 13 * * *' # 13:00 UTC ≈ 8–9am ET
do:
  job: daily-team-report
  input:
    hours: 24 # window length (default 24)
    # to: [chris@example.com]  # optional — defaults to the workspace accountableUser
```

Apply the workspace (`npm run workspace:apply -- <path> --project <id>`) and
the Temporal schedule is reconciled like every other automation. Fire it once by
hand from `/dashboard/automation` to see the first report.

### Mailing a team's own briefing

By default the mail carries an excerpt of the **workspace rollup**. A workspace
whose lead publishes a team briefing — the revenue workspace's
"Revenue Briefing — <date>" from `revenue-lead` on team `revops` — can mail that
instead: `input.briefing` selects the latest briefing for a team and/or agent,
renders it **in full**, and makes its title the subject. The four questions and
the team table still lead.

```yaml
# automations/morning-briefing-email.yaml  (metacto-revenue)
slug: morning-briefing-email
name: Email the morning revenue briefing
agent: revenue-lead
when:
  schedule: '15 12 * * 1-5' # 15 minutes after morning-briefing publishes
do:
  job: daily-team-report
  input:
    briefing:
      teamSlug: revops # and/or agentSlug: revenue-lead
```

If no briefing matches, the job falls back to the workspace rollup and the
default subject.

### Job input

| Field | Type | Default | Effect |
|---|---|---|---|
| `to` | string or list | workspace `accountableUser` | Recipient(s). A comma-separated string is accepted. |
| `hours` | number | `24` | Length of the trailing window. |
| `mail` | boolean | `true` | `false` stores the briefing and sends nothing, even with the flag on. |
| `publish` | boolean | `true` | `false` skips the briefing row (mail only). |
| `briefing` | `{ teamSlug?, agentSlug? }` | — (workspace rollup) | Carry the latest matching team/agent briefing in full; its title becomes the subject. |

### What the job returns

The `automation_run.result` carries the receipt:

```json
{
  "subject": "Team report — Vocion Workforce — Tuesday, Sep 15",
  "window": { "since": "…", "until": "…" },
  "runs": 41,
  "cents": 14000,
  "needsYou": 13,
  "briefingId": 88,
  "recipients": ["chris@metacto.com"],
  "mail": { "sent": true, "id": "msg_…" }
}
```

`mail.sent: false` always carries a `reason` — the flag being off, no
recipient, or the provider's rejection text.

## Run it by hand

```bash
npm run report:daily -- --org vocion-workforce                   # store + mail if enabled
npm run report:daily -- --org vocion-workforce --no-mail          # in-app only
npm run report:daily -- --org vocion-workforce --to me@example.com --hours 48
npm run report:daily -- --org vocion-workforce --html /tmp/report.html   # eyeball the HTML
```

## What is in the report, and where it comes from

| Section | Answers | Source |
|---|---|---|
| What changed | outcomes: runs completed and by whom, board-level reviews and red-team grades, failures | `worker_run` rows created in the window; `worker_run.kind` when the column exists |
| What needs me | the count and the lines behind it | pending `action_run`; mission / workflow / worker runs `awaiting_review` or `paused`; pending `learning_candidate`; open `ask` rows when that table exists |
| Are we on track | a verdict (on track / watch / off track) with the signals: failure rate, stalled runs, members near a hard budget cap, one role carrying most of the spend | `worker_run`, `agent_budget`. KPI targets join this section once a team declares `kpis:` |
| What happens next | what unblocks the team, when the next report lands | the needs-you count, the window length |
| From the workspace briefing | the lead's own narrative, excerpted (≈1,200 chars) with a link to the rest — or a selected team briefing in full (`input.briefing`) | newest `briefing` with `team_slug` NULL (or matching the selector) that is not itself a previous daily report |
| Teams and members | per team: % weight of spend, runs; per member: done/runs, failed, weight, board/red-team flags | `worker_run` grouped by `agent.team_slug`; inactive agents omitted, silent active ones shown with zeros |
| Evidence | runs, completed, failed/lost, spend, tokens, board runs, red-team runs, needs-you — the numbers the sections above are derived from | the same rows |

Only `worker_run` carries per-run cost, so in-app chat turns that never became
a worker run show up in the budget column, not the runs column. That is a
property of the data model (ADR 0004), not of this report.

## A mailbox per workspace

Every workspace can have an address of its own — `revenue@agents.example.com`
— and whoever runs the workspace in chat answers it in mail: the **workspace
lead**. Same conversation model, same review queue, one more surface
(`libs/surfaces/email.ts`, `services/EmailSurfaceService.ts`), the way Slack
was the first.

**How a mail is handled**

1. Resend receives the mail for the domain (MX record) and POSTs an
   `email.received` webhook to `/api/webhooks/resend`. The webhook is verified
   (Svix signature, `RESEND_WEBHOOK_SECRET`) before it is parsed; an unsigned
   request is a 401. The webhook carries metadata only, so the body is fetched
   from Resend's receiving API.
2. The **recipient** address resolves the workspace (`project.mailbox_address`).
   The sender's address authorises nothing — it decides one thing: whether an
   agent turn runs. A member of the workspace's account, or its accountable
   human, gets an answer. Anyone else gets a short acknowledgement and the
   mail is filed as an `ask` (kind `input`) in the "Needs you" inbox — a person
   decides whether to reply, let the lead answer, or ignore.
3. Threading: a reply that names one of our Message-IDs (`In-Reply-To` /
   `References`) continues that conversation; failing that, the same sender on
   the same subject within seven days does; otherwise a new conversation opens,
   titled with the subject, with `conversation.surface = 'email'`. Every mail in
   or out is recorded in `email_thread`, which is also what drops a redelivered
   webhook.
4. The lead runs one turn with the body (quoted history and signature
   stripped, attachments listed by name — not read) and replies **by email**
   from the workspace address, `Re:` subject, `In-Reply-To` and `References`
   set, plain text and simple HTML. Anything the agent proposes lands in the
   review queue, exactly as it would from chat.

The mailbox is not a second inbox in the app: the conversations it opens sit
in the lead's history like any other (an envelope chip marks them). Decisions
stay in "Needs you". One obvious place per job.

**Turn it on**

```bash
VOCION_EMAIL_SURFACE=1
VOCION_MAIL_DOMAIN=agents.example.com     # workspaces may only claim addresses here
RESEND_WEBHOOK_SECRET=whsec_…             # from the webhook you create below
```

In Resend: the domain must have **receiving enabled** (the MX record it shows
you); then *Webhooks → Add* → event `email.received` → URL
`https://<your host>/api/webhooks/resend`, and copy the signing secret into
`RESEND_WEBHOOK_SECRET`. In the workspace:

```yaml
# workspace.yaml
mailbox:
  enabled: true # → <slug>@VOCION_MAIL_DOMAIN
  # address: revenue@agents.example.com   # optional, must be on that domain
```

`workspace:apply` refuses an address off the deployment's domain, and errors if
`mailbox.enabled` is set with no `VOCION_MAIL_DOMAIN`.

**Outbound identity.** Once a workspace has a mailbox, the mail it sends —
the daily team report, ask notifications — comes *from* that address
(`Revenue Team <revenue@agents.example.com>`, `services/mail/workspaceFrom.ts`),
so a reply threads back into the workspace rather than a no-reply sender.

### Ask notifications by mail — `notify-asks`

```yaml
# automations/notify-asks.yaml
slug: notify-asks
name: Needs-you notifications
when:
  schedule: '*/15 * * * *'
do:
  job: notify-asks
  input:
  # to: [ops@example.com]     # default = the workspace accountableUser
  # minIntervalMinutes: 15    # never more than one mail per interval per org
```

One grouped mail per run listing every ask that opened since the last one,
each with a deep link into `/dashboard/inbox/<id>`; asks are marked notified
so they are mailed once. With mail off the job reports what it would have sent.

## Using `sendMail` elsewhere

```ts
import { sendMail } from '@/libs/mail';

const res = await sendMail({ to: 'a@example.com', subject: '…', html: '…', text: '…' });
if (res.skipped) { /* flag off — decide whether that is fine */ }
```

- Throws `MailError('MISCONFIGURED')` when the flag is on but a key is missing,
  and `MailError('PROVIDER', …, 502)` when Resend rejects the message.
- Always pass `text` — some clients render nothing else.
- `headers` carries `In-Reply-To` / `References` / `Message-ID` for threading; `from` overrides the deployment sender for one message.
- HTML for mail: one column, table layout, inline styles, no external assets.
  `services/reports/renderDailyTeamReport.ts` is the reference.

## Related

[Automation](../entities/automation.md) · [Briefings](../object-model.md) · [Observability](./observability.md)
