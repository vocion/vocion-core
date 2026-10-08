# ElevenLabs

A voice for the workspace's agents: the narration over a QA recording is spoken in the agent's
voice, on the workspace's own ElevenLabs account.

| | |
|---|---|
| Auth | ElevenLabs API key with Text to Speech and Voices (read); User (read) lets Test connection show the characters left (`elevenlabs` platform). Works today; no OAuth app. |
| Syncs | Nothing — a voice is called, never mirrored. |
| Uses | The voice capability (`services/voice/provider.ts`) speaks with the connected key; an agent's `harness.voiceId` picks its voice, else the account's first. |
| Actions | None: speaking a line changes nothing outside Vocion. |

Test connection reads the plan, the characters left this period and the voices, and speaks
nothing. Each workspace speaks on its own key — the provider is built per call from the
workspace's stored credential, never shared between workspaces. Speaking spends the account's
characters; a narrated recording is a few hundred.
