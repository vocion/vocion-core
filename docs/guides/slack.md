# Agents in Slack

Mention an agent in a channel, or message it directly, and it answers in the thread. This is the
**phase-1 slice** of the Slack surface (decision 025): mention in, reply out, one bound channel per
agent, and deliberately **no Approve / Reject buttons in Slack**. Anything the agent proposes lands
in the review queue for a person to approve in Vocion, where the identity is already known.

The Slack user who asked is recorded on the conversation as an external actor (`slack:U…`). It
authorises nothing.

## What you need

- A Vocion deployment with `VOCION_SLACK_EVENTS=1`.
- A Slack app you own. Vocion never creates it and never holds the signing secret outside the
  server's environment.

## 1. Create the Slack app

At https://api.slack.com/apps, **Create New App → From scratch**, in your workspace.

**OAuth & Permissions → Bot Token Scopes:**

| Scope | Why |
|---|---|
| `app_mentions:read` | receive `@agent …` in channels it is in |
| `chat:write` | reply in the thread |
| `im:history` | receive direct messages |
| `im:read`, `im:write` | open and read the DM channel |
| `chat:write.customize` | optional — reply under a persona name and avatar (see below) |
| `channels:read`, `groups:read` | receive `member_joined_channel` — the invite that triggers the introduction; also names the channel in thread context (public / private channels) |
| `channels:history`, `groups:history` | read the thread a mention sits in — the message it replies to, and the replies so far |
| `files:write` | upload screenshots into the channel as files |

Vocion asks the live app which of these it holds (`auth.test`'s `x-oauth-scopes`)
rather than trusting a list in the environment, and degrades per scope:

| Missing | What still works | What you lose |
|---|---|---|
| `channels:read` / `groups:read` | everything else | the channel is named by its id, not `#releases` |
| `channels:history` / `groups:history` | a thread that starts with **Vocion's own post**, which is read from `slack_post`, not from Slack | the text of a message somebody ELSE wrote. The reply says so, naming the scope |
| `files:write` | screenshots still appear **inline**, as Block Kit image blocks Slack fetches itself | images on a URL that needs a Vocion sign-in. Those are named in the reply as needing one, never pasted as a bare link — verified 2026-09-15: a link to an image does not unfurl in a private channel even with `unfurl_media` |

An install missing a scope is told which one, in the channel, once per thread —
`` `groups:history` would let me read the message this thread started with``.
Never "no page context here".

Install the app to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
**Basic Information → App Credentials:** copy the **Signing Secret**.

## 2. Configure the server

```
SLACK_SIGNING_SECRET=…        # Basic Information → App Credentials
SLACK_BOT_TOKEN=xoxb-…        # OAuth & Permissions → Bot User OAuth Token
VOCION_SLACK_EVENTS=1
SLACK_BOT_USER_ID=U0…           # optional — the bot's own user id, only used when a
                                # delivery carries no `authorizations` block
```

Restart the app. Requests are verified with Slack's v0 signature (HMAC-SHA256 over
`v0:<timestamp>:<body>`, five-minute replay window) before anything is parsed; an unverified
request is a 401.

## 3. Point Slack at Vocion

**Event Subscriptions → Enable Events**, Request URL `https://<your-vocion-host>/api/webhooks/slack`.
Slack sends a `url_verification` challenge; Vocion answers it once the signing secret is in place.
Then **Subscribe to bot events:** `app_mention`, `message.im` and `member_joined_channel`. Save,
reinstall if asked, and invite the bot to any channel it should answer in.

Nothing else. In particular **not** `message.channels` or `message.groups`: those stream every
message in every channel the bot is in to this endpoint, and `app_mention` already covers being
spoken to. Reading a whole channel is a decision to take on its own merits, not a side effect of
wanting the bot to notice it was invited.

`member_joined_channel` fires for everyone who joins; the adapter keeps only the event whose
joining member is the bot itself (`authorizations`, or `SLACK_BOT_USER_ID` when a delivery carries
none) and ignores the rest.

## 4. Bind a channel to an agent

The event carries only a channel id, so the binding is how it finds both the org and the agent.
With a tenant API token:

```bash
# one channel → one agent
curl -X POST https://<host>/api/v1/chat-bindings \
  -H "Authorization: Bearer vcn_live_…" -H 'Content-Type: application/json' \
  -d '{"surface":"slack","teamId":"T0123","channelId":"C0456","agentSlug":"revenue-lead"}'

# direct messages: a workspace-wide catch-all
curl -X POST https://<host>/api/v1/chat-bindings \
  -H "Authorization: Bearer vcn_live_…" -H 'Content-Type: application/json' \
  -d '{"surface":"slack","teamId":"T0123","channelId":"*","agentSlug":"revenue-director"}'
```

`GET /api/v1/chat-bindings` lists them; `DELETE /api/v1/chat-bindings/:id` removes one. A channel
is bound once, to one agent in one org. Binding from workspace YAML is a follow-up; phase 1 keeps
bindings explicit and auditable.

## 5. Give the channel a persona (optional)

A binding can carry a `displayName` and an `iconUrl`, and the reply arrives wearing them:

```bash
curl -X POST https://<host>/api/v1/chat-bindings \
  -H "Authorization: Bearer vcn_live_…" -H 'Content-Type: application/json' \
  -d '{"surface":"slack","teamId":"T0123","channelId":"C0456","agentSlug":"revenue-lead",
       "displayName":"Sterling Banks","iconUrl":"https://www.vocion.ai/personas/sterling.png"}'
```

This is Slack's `username` / `icon_url` message override, so it needs the **`chat:write.customize`**
bot scope and nothing else: still one app, one install, one secret, with a different face per
channel. `iconUrl` must be a public `https` URL — Slack fetches the image itself, per message.

Both fields are optional and independent. A binding with neither posts under the app's own name and
icon exactly as before; the adapter omits the keys rather than sending them empty, because an empty
`username` posts a blank name.

A persona is a presentation detail. It changes no identity and no authorisation: the conversation,
the audit trail and the review queue still record the agent slug and the Slack user id. Give the
persona a name that reads as a person only if the surrounding product makes clear it is an agent.

## 6. Give the agent a persona (optional)

A binding gives a *channel* one face. A persona on the **agent** gives that agent its own face
wherever it answers — authored in workspace YAML like everything else:

```yaml
slug: revenue-lead
name: Revenue Lead
persona:
  displayName: Sterling Banks
  iconUrl: https://www.vocion.ai/personas/sterling.png
```

`npm run workspace:apply` puts it on the agent row, and the next reply wears it.

Resolution order for a reply: **the binding's persona if the channel sets one**, else the
answering agent's persona, else the app's own name and icon. A persona resolves as a unit — a
binding that sets only a `displayName` keeps the app's icon rather than borrowing the agent's,
because half of one face on half of another is a third person nobody configured. Bindings that
already carry a persona are unaffected.

The rule that does not bend: a persona must never imply a human. Whatever face answers, the
introduction says it is an agent, and the audit trail records the agent slug.

## What the agent knows in a thread

A mention arrives carrying the channel id, the thread key, the sender and the
text — and **not** the message it replies to. Vocion assembles the rest before
the agent runs, cheapest source first:

1. **Its own outbound posts** (`slack_post`, migration 0102). Every
   announcement, reply and introduction Vocion sends is recorded with its
   channel, `ts`, `thread_ts`, text, the workspace it came from, and — for an
   announcement — **what it was announcing** (`announcedLabel` /
   `announcedUrl`). So when the thread starts with a Vocion release
   announcement, "any screenshots to go with *this*?" resolves with no Slack
   scope at all. Vocion does not need a permission to remember what it said.
2. **Poster names** (`users:read`, which the app holds) — so who is talking
   never degrades to a raw id.
3. **The channel name and the other messages** (`channels:read` /
   `groups:read`, `channels:history` / `groups:history`). These need scopes an
   install may not have granted; what is missing is named, not swallowed.

The result travels as the turn's `page_context` — the same slot a dashboard
page fills — so `this`, `here` and `that` resolve the same way on both
surfaces, and the `page_context` tool returns the thread as JSON. The workspace
the post came from is part of it, and the reply is scoped to that workspace.

## Posting an announcement through Vocion

```bash
curl -X POST https://<host>/api/v1/chat-announcements \
  -H "Authorization: Bearer vcn_live_…" -H 'Content-Type: application/json' \
  -d '{"surface":"slack","channelId":"C0456","teamId":"T0123",
       "text":"Release 2.80.1 is out.",
       "announcedLabel":"Release 2.80.1",
       "announcedUrl":"https://www.example.com/releases/2-80-1",
       "images":[{"url":"https://www.example.com/shots/inbox.png","caption":"the inbox, now one list"}]}'
```

Two things this buys over posting straight at Slack. The images ride in the
**original post** rather than in an answer to "any screenshots?". And the post
is recorded, so a reply to it resolves without a history scope. The channel
must already be bound to an agent in the caller's org; this authorises nothing
in Slack.

## What happens when the bot is invited to a channel

`member_joined_channel` for the bot's own user id is the discovery signal, and Vocion answers it
with exactly one message: who answers here, and that mentioning it starts a thread. It runs no
agent, creates no conversation and spends no budget. The channel resolves the same way a mention
would — exact binding first, then the workspace `*` catch-all — so a channel nobody bound still
introduces the default agent. With no binding at all, it stays silent rather than advertising an
install that cannot answer.

## What happens on a message

1. Signature verified, event classified. Bot messages, edits and reactions are ignored. A Slack
   redelivery (`x-slack-retry-num`) is acknowledged and dropped so a slow first run never answers twice.
2. The channel resolves to a binding — exact channel first, then the team's `*` catch-all.
3. The agent's **period budget** is checked. Over the cap, the reply says so and nothing runs.
4. One **conversation per thread, per sender** (`scopeRef = slack:<channel>:<thread>`), so a
   follow-up in the same thread continues with history.
5. The **thread context** is assembled (above) and handed to the turn as
   `page_context`, and the message is classified for feedback.
6. The agent runs exactly as it would from the dashboard — same skills, sources, tools and audit
   trail — and the reply is posted into the thread.
7. The reply is **recorded** in `slack_post`, so the next mention in this thread
   knows what we said. If a scope was missing, the reply names it — once per
   thread, not on every turn.

## Feedback in a thread becomes work

Someone replying "you should have had the thread context here" has written a
requirement. `docs/DESIGN-PRINCIPLES.md` §9 asks whether an interaction taught the
system anything, and a message read once teaches nothing, so a mention that
reads as feedback takes a second path:

1. A cheap pure classifier (`services/chat/feedbackSignal.ts`) decides whether
   the message is feedback. The model is asked only when the heuristic is
   unsure — it never costs a turn to classify "thanks!".
2. The agent calls `file_feedback`, which records a `learning_candidate`
   (`polarity: correct`) with the Slack permalink as its source, and — when
   the workspace has a team whose mission is building — files an **ask** of
   kind `recommendation` in that workspace's Needs-you inbox: *Plan and start*
   (recommended) / *Add to backlog* / *Decline*, with the thread verbatim in
   its details and a link back to Slack.
3. The reply says what was filed, with the inbox link.

**Approving *Plan and start* in the inbox is what kicks off the work.** Nothing
executes from Slack — decision 025 is unchanged, and a Slack user id still
authorises nothing.

## What it does not do, yet

- No Approve / Reject in Slack — a separate ruling with real authorisation blast radius.
- **No screenshot rendered on demand.** `find_screenshots` finds what the
  workspace already has; driving a headless browser over a route to make a new
  one is a separate capability.
- One Slack app per deployment. Per-org bot tokens through the credential vault are phase 2.
- No streaming: Slack gets the finished reply.

## Other platforms

The Slack code sits behind a `ChatSurfaceAdapter` interface (`libs/surfaces/`) with a registry,
the same pattern as source connectors. Verification, parsing and posting are platform-specific;
binding, conversation, budget, the agent run and the review queue never see a platform type. A
Teams adapter is a second file in that folder.
