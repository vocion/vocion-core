# Push to you

Your morning brief and anything urgent can also reach you outside the app, as a
Slack DM, a text or an email. Each message:

- carries a deep link that opens the app on that exact item;
- ends with a one-tap **stop these** for that channel.

Everything still lands in the app as a notification in your Personal
workspace, whatever you choose here.

## What you choose

These settings sit under **Notification settings → Your day → Push to you**.

| Setting | What it does | Default |
|---|---|---|
| Slack DM, Text message, Email | Where pushes go beyond the app. A channel this server cannot send on, or one you cannot receive (no mobile number on your profile), says why beside its switch. | none: in the app only |
| Brief and urgent | When on, your morning brief pushes as well as urgent items. When off, only urgent items push. | on |
| Quiet hours | Nothing leaves the app between these times, in your zone. Urgent items that arrive meanwhile are pushed when the quiet hours end. | none |

## What is urgent

| | When | Opens |
|---|---|---|
| **An approval blocking a run** | A decision waiting on you whose kind is an approval. It holds its run until you decide. | The row in its workspace |
| **A broken connection** | One of your own connections stopped working: the grant was revoked or expired, so only reconnecting fixes it. This is told once a day per connection. | Personal connectors |

**Finding new approvals.**

- The rhythm sweep runs every five minutes. It reads your queue across your
  workspaces and pushes approvals that arrived since it last looked, at most
  three a sweep. The rest are in the app.
- When you first turn a channel on, what was already waiting is not pushed.
- The sweep only does this for people with a channel on.

**Spotting a broken connection.**

- It is read from the failure's type and the vendor's code, never its wording
  (`libs/personal/broken.ts`):
  - a Google refresh refusal that waiting cannot fix;
  - a 401 from Google or GitHub;
  - Slack's `invalid_auth`, `token_revoked` and similar codes.
- It is reported by whichever read found out: an assistant tool, or the
  brief's calendar read.

## Guardrails

- **Once.** Every push is first written as an in-app notification under a
  once-only key: `approval:<workspace>:<row>`, `broken:<connector>:<day>`, or
  the brief's own day. A key already said is not pushed again on any channel.
- **Rate limit.** Six pushes an hour per person (`personal-push:user` in
  `libs/rateLimit/policies.ts`, counted in Postgres). Past it, an item stays in
  the app only.
- **One-tap stop.** Every message carries
  `/api/personal/push/stop?t=<token>`.
  - The token is signed with `AUTH_SECRET`. It names you, your Org and the
    channel, and can do nothing but turn that one channel off.
  - It works without signing in, so it works from a phone's mail app.
  - Emails also carry `List-Unsubscribe` and `List-Unsubscribe-Post`
    (RFC 8058), so a mail client's own Unsubscribe does the same. The stop
    route accepts that POST.
  - A token this server did not sign changes nothing.
- **Existing senders.**
  - Slack DMs go through `sendSlack` with `SLACK_BOT_TOKEN`, finding you by
    email.
  - Texts go through `sendSmsNotification` (Twilio), from the Org's texting
    number to the number on your profile.
  - Email goes through `sendMail` (Resend), when `VOCION_MAIL_ENABLED=1`.

Migration `0204_personal_push` adds these columns to `personal_rhythm`:
`push_channels`, `push_mode`, `quiet_start`, `quiet_end`, `urgent_seen_at`.

## Pieces

| | |
|---|---|
| Push, the stop, which channels can reach you | `services/personal/push.ts` |
| What is urgent | `services/personal/urgent.ts` (sweep and broken connections) |
| Broken or passing | `libs/personal/broken.ts` |
| Stop links | `libs/personal/stopLink.ts`, `app/api/personal/push/stop/route.ts` |
| Brief push | `services/briefings/personalDelivery.ts` |
| Settings | `features/personal/RhythmSettings.tsx` (Push to you) |
| Tests | `services/personal/push.test.ts` |
