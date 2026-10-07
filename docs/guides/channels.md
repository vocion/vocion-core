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

## Adding a medium (SMS)

1. **Inbound:** a route that verifies the provider's signature, finds the workspace by the number written to, and answers through the same turn path as email (`EmailSurfaceService.handleInboundEmail` is the pattern: `approval` first, then the agent turn). The conversation's `scopeRef` is `sms:<the person's number>`.
2. **The channel:** `smsChannel.ts` with `owns` (scopeRef starts with `sms:`), `say` (send a text from the workspace's number; files as links, or MMS), `alreadySaid` (`saidInConversation`), `memberOf` (the member whose verified phone is this number), and `signInHint`.
3. **Register it** in `services/chat/channels.ts`.

Nothing else changes: `x-tell`, followers, the asker's updates and deciding by reply all work through the channel.
