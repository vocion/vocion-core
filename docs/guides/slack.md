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
| `channels:read`, `groups:read` | receive `member_joined_channel` — the invite that triggers the introduction (public / private channels) |

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
5. The agent runs exactly as it would from the dashboard — same skills, sources, tools and audit
   trail — and the reply is posted into the thread.

## What it does not do, yet

- No Approve / Reject in Slack — a separate ruling with real authorisation blast radius.
- One Slack app per deployment. Per-org bot tokens through the credential vault are phase 2.
- No streaming: Slack gets the finished reply.

## Other platforms

The Slack code sits behind a `ChatSurfaceAdapter` interface (`libs/surfaces/`) with a registry,
the same pattern as source connectors. Verification, parsing and posting are platform-specific;
binding, conversation, budget, the agent run and the review queue never see a platform type. A
Teams adapter is a second file in that folder.
