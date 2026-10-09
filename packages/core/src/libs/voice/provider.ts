/**
 * THE VOICE CAPABILITY: what a caller needs from a text-to-speech service,
 * named for what it does, never for who serves it. A plugin, a job or a
 * narration asks `voiceProvider(orgId)` (`services/voice/provider.ts`) and
 * gets one of these, or null when the workspace connected none. The vendor is
 * named only in its connector's own module (`libs/voice/elevenlabs.ts`,
 * `libs/sources/elevenlabs.ts`) and in the list of voice connectors
 * (`libs/voice/connectors.ts`).
 */

import type { Buffer } from 'node:buffer';

/** A voice a line can be spoken in. */
export type Voice = { id: string; name: string };

/** One line, spoken. `characters` is what the provider billed; `durationMs` is set for a script. */
export type Speech = { audio: Buffer; contentType: 'audio/mpeg'; durationMs?: number; characters?: number };

/**
 * A refusal, as a sentence for a person. Voice calls never throw. `badVoice`
 * marks a refusal of the request itself (an unknown voice, say), which a
 * caller can heal by trying the account's own first voice.
 */
export type VoiceRefusal = { ok: false; reason: string; badVoice?: boolean };

export type VoiceProvider = {
  /** The connector slug it is served by, for provenance. */
  connector: string;
  /** Its name, for a person reading where a narration came from. */
  label: string;
  /** The voice to speak in when nobody chose one: natural, and on every account. */
  defaultVoice: Voice;
  /** The model a whole script is spoken with (and priced by, as `<connector>/<model>` in `libs/pricing.ts`). */
  scriptModel: string;
  listVoices: () => Promise<{ ok: true; voices: Voice[] } | VoiceRefusal>;
  /**
   * `speed` is the provider's pace, 1 = its default; a demo narrates a touch faster (Chris, 2026-10-04).
   * `form: 'script'` is a whole script read aloud (a brief), longer than a line and sized to send.
   * `modelId` overrides the provider's default model.
   */
  speak: (input: { voiceId: string; text: string; speed?: number; form?: 'line' | 'script'; modelId?: string }) => Promise<({ ok: true } & Speech) | VoiceRefusal>;
};

/**
 * A connector that can serve the voice capability: its slug and how to build
 * a provider from its decrypted credential (null when the credential cannot
 * be used).
 */
export type VoiceConnector = {
  slug: string;
  label: string;
  /**
   * The server's environment variable holding a key for it, the fallback
   * when no workspace in the Org connected it — the rule every outbound
   * vendor call follows (the stored key first, the server's second).
   */
  envKey?: string;
  fromCredentials: (values: Record<string, unknown>) => VoiceProvider | null;
};
