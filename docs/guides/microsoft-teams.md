# Microsoft Teams

Conversations from Teams channels, the Microsoft 365 counterpart of the Slack
connector. Setup and permissions: [microsoft-365.md](microsoft-365.md).

- **Syncs.** Every channel of every team the logged-in account belongs to, or
  one team (`teamId`) or one channel (`channelId`). One document per thread,
  the root message and its replies (`msteams:<team>:<channel>:<message>`), over
  the last `pastDays` (30). Graph's channel delta filters by last change, so an
  incremental run reads only threads whose root changed since the last run; a
  reply to a thread whose root did not change waits for the root to change or
  is read live. A channel the login cannot read is reported and skipped.
  **Chats are never synced**; they are personal.
- **Tools.** `msteams_list_channels` (teams and channel ids),
  `msteams_read_channel` (latest threads, or one thread, with replies, live),
  `msteams_read_chat` (recent chats, or one chat's messages, live).
- **Actions.** `msteams.post_message` posts a message, or a reply in a thread, as
  the connected account; the words are editable on the card. **No Undo**: Graph
  deletes a channel message only with `ChannelMessage.ReadWrite`, which this
  connector does not ask for. The person can delete it in Teams. Risk `medium`.
- **Auth.** Log in with Microsoft: `Team.ReadBasic.All`, `Channel.ReadBasic.All`,
  `ChannelMessage.Read.All` (**needs a tenant admin's consent**),
  `ChannelMessage.Send`, `Chat.Read`. Test connection lists the teams.
