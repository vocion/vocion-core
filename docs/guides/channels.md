# Conversation channels: reaching the person where they asked

A conversation lives in the app. Some also live where a person is: a Slack thread, an email thread, and later a text thread. A **channel** is what Vocion needs to reach the person there, and to know who answered.

```ts
// packages/core/src/services/chat/conversationChannel.ts
type ConversationChannel = {
  surface: string; // 'slack', 'email', 'sms'
  owns: (c) => boolean; // is this conversation one of my threads?
  say: (orgId, c, text, { key, files, url }) => Promise<boolean>;
  alreadySaid: (orgId, c, key, text) => Promise<boolean>;
  memberOf: (orgId, externalUserId) => Promise<ChannelMember>;
  signInHint: (email) => string; // "the email on your Slack profile (…)"
};
```

Two things go through it, so every medium behaves the same:

- **Telling the asker** (`tellConversation`). A record's moves, as its type's `x-tell` declares them (blocked, a plan or a merge waiting on you, live), a filed demo, and anything else outside a chat turn. The line is added to the app conversation and said on the channel, once per key, with absolute links and the files (uploaded where the medium takes files, linked where it does not). The origin conversation and every conversation that acted on the record since (`services/objects/followers.ts`) hear it.
- **Deciding by reply** (`approvalFromThread`). A reply on the medium is read against the cards waiting on the thread, or on a record the thread follows. A model reads it as consent, and it runs as the Vocion member the channel resolves the sender to. A sender Vocion does not know is told how to become known (`signInHint`), and nothing is decided.

| Medium | Thread | Files | Sender is |
|---|---|---|---|
| Slack (`slackChannel.ts`) | `slack:<channel>:<thread ts>` | uploaded under the post | the member with the email on the Slack profile |
| Email (`emailChannel.ts`) | `email:<first Message-ID>`, threaded by `In-Reply-To` / `References` | links into Vocion | the member with the address written from |
| Text (`smsChannel.ts`, Twilio) | `sms:<workspace number>:<their number>` | links into Vocion | the member whose profile holds the number (`user.phone`) |

## Text messages (Twilio)

- **Server:** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in the app's environment. The webhook (`/api/webhooks/twilio/sms`) checks Twilio's signature against `NEXT_PUBLIC_APP_URL`, so that must be the address Twilio calls.
- **A number per workspace:** bind it like a Slack channel, `POST /api/v1/chat-bindings {"surface":"sms","channelId":"+19704894702","agentSlug":"product-manager"}`. In Twilio, set the number's "A message comes in" webhook to `https://<app>/api/webhooks/twilio/sms` (HTTP POST).
- **Who is texting:** a member's mobile number on their profile. They set it on the profile page, or tell any agent in chat ("my mobile is …"); the agent proposes `me.set_phone`, which only ever sets the asker's own number. A text from a number nobody holds gets one line saying how to become known, and no agent runs.
- **One number for everyone's own assistant:** bind it with `"answers":"sender"` instead of an agent, `POST /api/v1/chat-bindings {"surface":"sms","channelId":"+19705550100","answers":"sender"}` (stored as the agent `*`). A text to it is routed by who sent it: the member is found on the binding's account, their personal workspace is made if it is not there yet, and whoever leads it (their assistant) answers in a conversation there (`services/chat/ownAssistant.ts`). An unknown number hears how to become known; a person with no assistant yet is told so; a reply that decides a card waiting in their thread still decides it, as them. A number bound to one workspace keeps answering as that workspace's agent.
- **Notifications by text:** `sms` is a notification channel, off for every kind until a person turns it on in notification settings. It goes to the number on their profile, from the account's shared number when there is one (so a reply reaches their assistant), else the workspace's own number, in one text with its link.
- **Carriers:** US carriers filter application texts from a local number until the sender is registered for A2P 10DLC (a brand and a campaign on a Messaging Service, in the Twilio Console under Messaging → Regulatory Compliance).

## Adding another medium

1. **Inbound:** a route that verifies the provider's signature and hands a `ChatInbound` to `handleInbound` (`app/api/webhooks/twilio/sms/route.ts` is the smallest example), or, for a medium with its own threading, a handler like `EmailSurfaceService.handleInboundEmail` that runs `approval` first and then the turn.
2. **The channel:** a file beside `smsChannel.ts` with `owns`, `say`, `alreadySaid`, `memberOf` and `signInHint`.
3. **Register it** in `services/chat/channels.ts`, and its surface adapter in `libs/surfaces/registry.ts`.

Nothing else changes: `x-tell`, followers, the asker's updates and deciding by reply all work through the channel.
