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

/** One line, spoken. */
export type Speech = { audio: Buffer; contentType: 'audio/mpeg'; durationMs?: number };

/** A refusal, as a sentence for a person. Voice calls never throw. */
export type VoiceRefusal = { ok: false; reason: string };

export type VoiceProvider = {
  /** The connector slug it is served by, for provenance. */
  connector: string;
  /** Its name, for a person reading where a narration came from. */
  label: string;
  listVoices: () => Promise<{ ok: true; voices: Voice[] } | VoiceRefusal>;
  speak: (input: { voiceId: string; text: string }) => Promise<({ ok: true } & Speech) | VoiceRefusal>;
};

/**
 * A connector that can serve the voice capability: its slug and how to build
 * a provider from its decrypted credential (null when the credential cannot
 * be used).
 */
export type VoiceConnector = {
  slug: string;
  label: string;
  fromCredentials: (values: Record<string, unknown>) => VoiceProvider | null;
};
