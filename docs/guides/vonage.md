# Vonage

Vonage on the same model as Twilio: texts to a Vonage number are answered by the number's
agent, and the account's voice call log is searchable.

| | |
|---|---|
| Auth | API key + secret, plus the signature secret and method for inbound texts (`vonage` platform). Works today; no OAuth app. |
| Surface | `vonage` — `libs/surfaces/vonage.ts`, webhook `GET or POST /api/webhooks/vonage/sms`. Same binding, sender and answer rules as Twilio texts. |
| Syncs | `vonage` source — one document per voice call, both directions, from the Reports API. Settings: `pastDays` (30). |
| Tools | `phone_calls`, `phone_call` — the same tools as Twilio Voice. |
| Actions | None yet (see below). |

## Turn it on

1. Dashboard → API settings: copy the API key and secret; turn on **Signed webhooks** and copy
   the signature secret and method (`sha256` unless you chose another).
2. Connect Vonage in Vocion with all four values.
3. Numbers → your number → **Inbound webhook URL**: `https://<your Vocion>/api/webhooks/vonage/sms`.
4. Bind it: `POST /api/v1/chat-bindings { "surface": "vonage", "channelId": "+19705550199", "agentSlug": "…" }`.

The server's `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_SIGNATURE_SECRET` and
`VONAGE_SIGNATURE_METHOD` are the fallback. A signed webhook older than five minutes is refused.

## Not built, and why

Placing a call and fetching a recording need a **Vonage Application** (an application id and a
private key, signed into a JWT); an API key and secret cannot stand in. They wait for a
workspace that needs them. Placing calls works today through Twilio (`phone.place_call`).
