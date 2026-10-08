# Discord

Discord is the chat family's second provider after Slack. A workspace connects a **bot**, and:

| | |
|---|---|
| Auth | Bot token, plus the application's public key to answer `/ask` (`discord` platform). Works today with a token; no OAuth app. |
| Syncs | `discord` source — each message in the channels the bot can read (or the ones listed) as a document, cited with its link. Incremental by message id; a weekly full pass tombstones deleted messages. |
| Tools | `chat_read_thread`, `chat_read_file` — the family's reads, given a `https://discord.com/channels/…` link. |
| Actions | `chat.reply_in_thread` (Undo deletes the reply), `chat.add_reaction` (Undo removes it). |
| Surface | `discord` — people ask with `/ask <question>`; webhook `POST /api/webhooks/discord`. |

## Turn it on

1. Discord Developer Portal → your application → **Bot**: reset and copy the token; turn on the
   **Message Content** intent (without it the bot reads empty messages).
2. **OAuth2 → URL Generator**, scope `bot` with View Channels, Read Message History, Send
   Messages, Add Reactions; open the URL to add the bot to your server.
3. Connect Discord in Vocion (Connectors, or from chat). Paste the token and the **Public Key**
   from General Information. **Test connection** reads the bot and its channels and registers
   the `/ask` command (the one change a test makes; idempotent).
4. For `/ask`: set the application's **Interactions Endpoint URL** to
   `https://<your Vocion>/api/webhooks/discord`, then bind a channel —
   `POST /api/v1/chat-bindings { "surface": "discord", "channelId": "<channel id>", "agentSlug": "…" }`
   or `{ "channelId": "*", "teamId": "<server id>" }` for the whole server.

`DISCORD_BOT_TOKEN` / `DISCORD_PUBLIC_KEY` are the server's fallback bot.

## What it cannot do, and why

- Ordinary messages reach a bot only over Discord's gateway socket, which this server does not
  hold open, so an agent answers `/ask` rather than an @mention. The rest of a channel is read by
  the source.
- Discord never tells a bot anyone's email, so `lookup_person` cannot match a Discord user to a
  Vocion member, and a Discord user cannot decide a card by replying. Decisions stay in Vocion.
