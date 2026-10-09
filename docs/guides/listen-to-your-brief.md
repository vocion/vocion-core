# Listen to your brief

Every brief can be heard. Your morning brief, your evening wrap and, where your
Org has them on, your workspaces' briefs come with a short spoken version: a
minute or two, told to you the way a chief of staff would tell you, not read
word for word. Listen in the app, in Slack, from a text, or in your podcast
app on the drive in.

## Where you hear it

| Where | What you get |
|---|---|
| **The brief's page** | A compact player above the brief: play/pause, a scrubber, the time, and 1×, 1.5× or 2×. It is a native audio element, so on an iPhone it plays inline and keeps going with the screen locked where Safari allows; the lock screen and headphones show the title and play, pause and skip. |
| **The brief's chat message** | The same player, under the message that delivers your brief. |
| **Slack DM** | The brief's summary, then the MP3 uploaded into the same DM as a file, so Slack shows its own audio player. |
| **Text message** | The MP3 as an MMS attachment you can open and play, plus the link to the brief. If your number or carrier cannot take an MMS, or the file is over the carrier limit, the text carries the link alone. |
| **Email** | A **▶ Listen (2:14)** button that opens the brief's page with focus on Play. The MP3 is attached too when it is under 2 MB (about four minutes, so in practice always), which iOS Mail plays inline, offline. |
| **Your podcast app** | A private podcast feed of your briefs (below). |

**Next surface:** the iOS app, where the same MP3 and the same feed give
CarPlay and background playback with no browser in the way.

## What is said

A small model (the classifier role) writes a **spoken script** from the brief
(`services/briefings/audio/script.ts`):

- conversational, the important things first;
- about 60 to 150 seconds out loud for a full day (150–387 words at 155 words a
  minute); a quiet day is shorter, never padded;
- no markdown, links, tables, ids or reference numbers; people and numbers said
  the way a person says them ("three decisions", "nine thirty").

These rules are checked, not hoped for. The model answers through one tool;
the answer is checked for length, links, formatting and ids; a script that
breaks one is sent back once, naming exactly which; one that still breaks a
rule is made speakable and cut at a whole sentence inside the bound. With no
model (the budget said no, or it could not answer), the brief's own words are
spoken the same way. The script is kept with the audio, so what you heard is
always one click from the words it came from.

## The voice

| | |
|---|---|
| Provider | ElevenLabs, through the existing voice capability (`libs/voice`, `services/voice/provider.ts`) |
| Model | `eleven_multilingual_v2`: ElevenLabs' most lifelike and steady model for long-form narration. `eleven_v3` is more expressive but less consistent over two minutes; Flash and Turbo trade quality for latency a brief does not need. `VOCION_BRIEF_VOICE_MODEL` changes it per install. |
| Default voice | **Brian** (`nPczCjzI2devNBz1zQrb`), one of ElevenLabs' default voices that every account has: an even, warm American narrator. |
| Format | MP3, 44.1 kHz, 64 kbps CBR: speech-grade for one voice, about 480 KB a minute, so a brief fits in a text. The duration is the byte count over the bit rate. |
| Choosing | The Org picks its voice (Org admins, under Notification settings → Your day); each person can pick their own, which wins for their briefs. A voice the account does not have falls back to the account's first voice rather than failing. |

## Where the key comes from

A voice is a **team connector**. Briefs look for one in this order, and the
first found speaks:

1. the brief's own workspace;
2. any other workspace in the Org (so a personal brief uses the key a team
   workspace connected);
3. the server's `ELEVENLABS_API_KEY`.

To turn listening on, an Org admin opens any team workspace → **Manage
workspace → Team connectors → ElevenLabs** and pastes an API key (Developers →
API Keys; it needs Text to Speech and Voices read). Or the operator sets
`ELEVENLABS_API_KEY` on the server.

**With no key anywhere, nothing happens:** no player, no attachment, no error.

## Made once, when first needed

The audio is made the first time it is needed — when the brief is first
viewed, or when it is about to leave the app (pushed to a channel, or listed in
a podcast feed) — and kept: the MP3 in the media store (S3 when
`VOCION_MEDIA_BUCKET` is set, else disk), and the brief's row
(`briefing.audio`) holding the script, the file, the duration, the voice and
the cost.

That row is keyed by a hash of what was spoken from (the brief's words, the
voice and the model), so the second view plays the same file, and a personal
brief refreshed later the same day is spoken again on its next view. A first
view says "Preparing your brief to listen to…" and the player appears when it
is ready; two views at once make it once. A voice that refuses (no characters
left, a bad key) is said on the player and tried again after ten minutes.

## Cost and budget

Both halves charge through the ordinary spend path to `platform:brief.audio`:

- the script's model call, priced by the model it ran on (a Haiku-class call
  over a brief is a fraction of a cent);
- the voice, priced per character: `libs/pricing.ts` carries
  `elevenlabs/eleven_multilingual_v2` at **$0.20 per 1,000 characters**, an
  estimate between ElevenLabs' Creator and Pro plan rates. A full brief is
  about 1,500–2,400 characters, so **about $0.30–0.48 a brief, typically
  ~$0.35**. The characters are spent on your own ElevenLabs plan; this is what
  Vocion's budget counts.

The Org's **daily brief cap** holds the audio together with the briefs
(`services/briefings/budgetGate.ts` sums `personal.brief` and `brief.audio`).
Over it, audio pauses for the day and the player stays away; the briefs
themselves behave as before.

## The private podcast feed

Under **Notification settings → Your day → Listen to my briefs → Private
podcast**, **Make a link** gives a feed URL to paste into Apple Podcasts
(Library → Follow a Show by URL) or Overcast.

- The URL carries a random token; only its SHA-256 is kept, so it is shown
  once. **New link** replaces it; **Stop** revokes it at once.
- It lists your own spoken briefs (your Personal workspace), newest first,
  about a month of them, each with its duration and the script as show notes.
  It is marked `itunes:block`, so no directory lists it.
- With a live feed, each scheduled brief and wrap is spoken at delivery, so it
  is there by the time your podcast app checks.

## Settings

Under **Notification settings → Your day → Listen to my briefs**:

| Setting | Default |
|---|---|
| Read my briefs aloud | On whenever a voice is connected in the Org |
| Voice | The Org's voice, else Brian |
| Start at | 1× (the player's speed when a brief opens; change it any time) |
| Private podcast | None |

Org admins also get **Workspace briefs read aloud** (on by default) and the
Org's voice.

## Pieces

| | |
|---|---|
| Plan, make, keep, read | `services/briefings/audio/audio.ts` |
| The spoken script | `services/briefings/audio/script.ts` |
| Podcast feed | `services/briefings/audio/podcast.ts` |
| Shared types, the `2:14` clock | `services/briefings/audio/types.ts` |
| The player | `features/dashboard/briefings/BriefAudioPlayer.tsx` |
| Signed MP3 links for texts | `libs/briefings/listenLink.ts` |
| Routes | `app/api/briefings/[id]/audio` (signed-in), `app/api/listen/[...path]` (feed and text attachment; sign-in-free and kept light, `check:route-graph`) |
| Channels | `services/personal/push.ts` (`pushEmail`), `libs/notifications/slack.ts` (file upload), `libs/notifications/sms.ts` (MMS with fallback) |
| Migration | `0207_brief_audio` |

| Environment | |
|---|---|
| `ELEVENLABS_API_KEY` | The server's ElevenLabs key, used when no workspace in the Org connected one |
| `VOCION_BRIEF_VOICE_MODEL` | The model scripts are spoken with (default `eleven_multilingual_v2`) |
| `VOCION_MMS_MAX_BYTES` | The largest MP3 sent as an MMS (default 1,000,000; past it, the text carries the link) |
