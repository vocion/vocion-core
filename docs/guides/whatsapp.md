# WhatsApp

People message a workspace's WhatsApp number and the number's agent answers, the way a text
to a Twilio number or a mention in Slack is answered. It runs on a **Twilio WhatsApp sender**
and reuses the text-message surface end to end: the same binding, the same signature check,
the same answer routing (a reply that decides a waiting card first, else a turn).

| | |
|---|---|
| Auth | Twilio Account SID + auth token (`twilio` platform). Works today with an API key; no OAuth app. |
| Surface | `whatsapp` — `libs/surfaces/whatsapp.ts`, webhook `POST /api/webhooks/twilio/whatsapp` |
| Syncs | Nothing. Messages are conversations, not documents. |
| Tools / actions | The agent's own; a reply goes back on WhatsApp. |

## Turn it on

1. In Twilio, register a WhatsApp sender (or use the Sandbox while trying it out) and point its
   **A message comes in** webhook at `https://<your Vocion>/api/webhooks/twilio/whatsapp` (POST).
2. Connect Twilio in Vocion (Connectors → Twilio, or ask in chat — `offer_connection` shows the
   card). The server's `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are the fallback.
3. Bind the number: `POST /api/v1/chat-bindings { "surface": "whatsapp", "channelId": "+19705550199", "agentSlug": "front-desk" }`,
   or `"answers": "sender"` for a shared number where each member reaches their own assistant.
4. A member says "my mobile number is …" in Vocion chat so their number is known.

## How it behaves

- **Who may ask.** A sender is the member whose profile holds the number. A stranger hears one
  line on how to become known; nothing runs.
- **Signatures.** Twilio signs with the account's auth token. The server's token is tried, then the
  token of the workspace that bound the number — a workspace on its own Twilio account works.
- **Words.** WhatsApp renders `*bold*` and `_italic_`, so markdown is converted rather than
  stripped; links are written out whole; 1600 characters per message (Twilio's cap).
- **The 24-hour window.** WhatsApp only lets a business message someone who wrote in the last 24
  hours without an approved template. Vocion only ever answers, inside that window.
