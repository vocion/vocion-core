/**
 * ElevenLabs API client — the one place that knows how to talk to ElevenLabs.
 * The `elevenlabs` connector's Test connection and the voice capability
 * (`libs/voice/provider.ts`, `services/voice/provider.ts`) go through it, so the
 * `xi-api-key` header, the host and the error shaping exist exactly once.
 * Nothing outside this file and the connector's own module names the vendor:
 * callers ask for "the workspace's voice".
 *
 * Three calls:
 *   - `readUser` — `GET /v1/user`: the plan and the characters left this
 *     period. Test connection only; it costs nothing.
 *   - `listVoices` — `GET /v1/voices`: the voices the account can speak with.
 *   - `speak` — `POST /v1/text-to-speech/{voice_id}`: one line of text to MP3
 *     (`output_format=mp3_44100_128`, model `eleven_multilingual_v2` unless
 *     the caller names one). This is the call that spends characters. A
 *     spoken SCRIPT (`form: 'script'`, a brief read aloud) may run to
 *     {@link ELEVENLABS_SCRIPT_MAX_CHARS} and comes back as speech-grade
 *     64 kbps MP3, so two minutes is about a megabyte: small enough to text.
 *
 * Errors are DATA, never throws, as the Sentry and PostHog clients have it: a
 * caller hands the failure on (to the checklist on the Connections page, to a
 * note on the request) and it says what to do.
 */

import type { VoiceConnector, VoiceProvider } from './provider';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const ELEVENLABS_HOST = 'https://api.elevenlabs.io';
/** The model a line is spoken with when the caller names none. */
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2';
/** MP3 at 44.1 kHz, 128 kbps: available on every plan. */
export const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
const TIMEOUT_MS = 30_000;
/** The longest line `speak` sends. A narration line is a sentence; this is a backstop on spend. */
export const ELEVENLABS_MAX_CHARS = 1_000;
/**
 * The longest SCRIPT `speak` sends (`form: 'script'`). A brief read aloud is
 * at most about 150 seconds, some 2,500 characters; this is the backstop.
 * One request, no stitching: Multilingual v2 takes 10,000 per request.
 */
export const ELEVENLABS_SCRIPT_MAX_CHARS = 5_000;
/**
 * A script's format: MP3, 44.1 kHz, 64 kbps CBR, on every plan. Speech-grade
 * for one voice, half the size of the 128 kbps a line uses, and constant bit
 * rate, so the duration is the byte count (`scriptDurationMs`).
 */
export const ELEVENLABS_SCRIPT_FORMAT = 'mp3_44100_64';
/** The bit rate of {@link ELEVENLABS_SCRIPT_FORMAT}, in bits per second. */
export const ELEVENLABS_SCRIPT_BITRATE = 64_000;
/**
 * The voice a script is spoken in when nobody chose one: "Brian", one of
 * ElevenLabs' default voices (every account has them) — an even, warm
 * American narrator that reads like a person talking you through your day
 * rather than an announcer. Org and person choose their own under
 * Notification settings → Your day; a voice the account does not have falls
 * back to the account's first voice (`services/briefings/audio/audio.ts`).
 */
export const ELEVENLABS_DEFAULT_VOICE = { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian' } as const;

/**
 * The model a SCRIPT is spoken with: Multilingual v2, ElevenLabs' most
 * lifelike and steady model for long-form narration (v3 is more expressive
 * but less consistent over two minutes; Flash and Turbo trade quality for
 * latency a brief does not need). `VOCION_BRIEF_VOICE_MODEL` overrides it
 * per install (`eleven_v3`, say).
 * @param env - The environment.
 */
export function elevenLabsScriptModel(env: Record<string, string | undefined> = process.env): string {
  const m = env.VOCION_BRIEF_VOICE_MODEL?.trim();
  return m && /^[\w.-]{1,64}$/.test(m) ? m : ELEVENLABS_DEFAULT_MODEL;
}

/**
 * How long a script's MP3 plays: constant bit rate, so bytes over rate.
 * @param bytes - The file's size.
 */
export function scriptDurationMs(bytes: number): number {
  return Math.round((bytes * 8 * 1000) / ELEVENLABS_SCRIPT_BITRATE);
}

export type ElevenLabsFailure
  = | { ok: false; error: 'voice_unauthorized'; status: 401 | 403; message: string }
    | { ok: false; error: 'voice_quota'; status: number; message: string }
    | { ok: false; error: 'voice_rate_limited'; status: 429; message: string }
    | { ok: false; error: 'voice_error'; status: number | null; message: string };

export type ElevenLabsResult<T> = { ok: true; data: T } | ElevenLabsFailure;

/** What a fetch looks like to this client, so a test can stand in for the network. */
export type ElevenLabsFetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers?: { get: (name: string) => string | null };
}>;

/**
 * The vaulted credential's key, or why it cannot be used. `apiKey` is the
 * storage contract with the `elevenlabs` platform descriptor in
 * `libs/platforms/registry.ts`.
 * @param values - The decrypted credential bag.
 */
export function elevenLabsKeyFrom(values?: Record<string, unknown> | null): { ok: true; apiKey: string } | { ok: false; message: string } {
  const apiKey = typeof values?.apiKey === 'string' ? values.apiKey.trim() : '';
  if (!apiKey) {
    return { ok: false, message: 'No ElevenLabs API key is stored for this workspace. Connect ElevenLabs on the Connections page with an API key.' };
  }
  return { ok: true, apiKey };
}

/**
 * ElevenLabs' error body (`{detail: {status, message}}` or `{detail: "…"}`),
 * as one sentence.
 * @param body - The response body as text.
 */
function vendorMessage(body: string): { status: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    const d = parsed.detail;
    if (typeof d === 'string') {
      return { status: null, message: d };
    }
    if (d && typeof d === 'object') {
      const o = d as { status?: unknown; message?: unknown };
      return { status: typeof o.status === 'string' ? o.status : null, message: typeof o.message === 'string' ? o.message : null };
    }
  } catch { /* not JSON */ }
  return { status: null, message: body.trim().slice(0, 200) || null };
}

async function call(apiKey: string, path: string, init: { method?: string; body?: unknown; accept?: string }, doFetch?: ElevenLabsFetch): Promise<ElevenLabsResult<Awaited<ReturnType<ElevenLabsFetch>>>> {
  const f = doFetch ?? (globalThis.fetch as unknown as ElevenLabsFetch);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await f(`${ELEVENLABS_HOST}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'xi-api-key': apiKey,
        'accept': init.accept ?? 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: ctrl.signal,
    });
    if (res.ok) {
      return { ok: true, data: res };
    }
    const said = vendorMessage(await res.text().catch(() => ''));
    const detail = said.message ? ` (${said.message.slice(0, 200)})` : '';
    if (said.status === 'quota_exceeded') {
      return { ok: false, error: 'voice_quota', status: res.status, message: `The ElevenLabs account has no characters left this period${detail}.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'voice_unauthorized', status: res.status, message: said.status === 'missing_permissions'
        ? `The ElevenLabs key is missing a permission this call needs${detail}.`
        : `ElevenLabs refused the API key${detail}. Check it on the Connections page.` };
    }
    if (res.status === 429) {
      return { ok: false, error: 'voice_rate_limited', status: 429, message: `ElevenLabs is rate limiting this account${detail}; try again shortly.` };
    }
    return { ok: false, error: 'voice_error', status: res.status, message: `ElevenLabs answered ${res.status}${detail}.` };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return { ok: false, error: 'voice_error', status: null, message: aborted ? `ElevenLabs did not answer within ${TIMEOUT_MS / 1000}s.` : `ElevenLabs could not be reached (${(err as Error)?.message?.slice(0, 160) ?? 'unknown error'}).` };
  } finally {
    clearTimeout(timer);
  }
}

export type ElevenLabsUser = {
  tier: string | null;
  characterCount: number | null;
  characterLimit: number | null;
};

/**
 * The plan and the characters spent and allowed this period. Free.
 * @param apiKey - The key.
 * @param doFetch - The network, injected in tests.
 */
export async function readUser(apiKey: string, doFetch?: ElevenLabsFetch): Promise<ElevenLabsResult<ElevenLabsUser>> {
  const res = await call(apiKey, '/v1/user', {}, doFetch);
  if (!res.ok) {
    return res;
  }
  const body = await res.data.json().catch(() => null) as { subscription?: { tier?: unknown; character_count?: unknown; character_limit?: unknown } } | null;
  const s = body?.subscription ?? {};
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  return { ok: true, data: { tier: typeof s.tier === 'string' ? s.tier : null, characterCount: num(s.character_count), characterLimit: num(s.character_limit) } };
}

/** A voice the account can speak with. */
export type VoiceInfo = { id: string; name: string; category: string | null };

/**
 * The voices the account can speak with, in the order ElevenLabs lists them.
 * @param apiKey - The key.
 * @param doFetch - The network, injected in tests.
 */
export async function listVoices(apiKey: string, doFetch?: ElevenLabsFetch): Promise<ElevenLabsResult<VoiceInfo[]>> {
  const res = await call(apiKey, '/v1/voices', {}, doFetch);
  if (!res.ok) {
    return res;
  }
  const body = await res.data.json().catch(() => null) as { voices?: Array<{ voice_id?: unknown; name?: unknown; category?: unknown }> } | null;
  const voices = (body?.voices ?? [])
    .filter(v => typeof v.voice_id === 'string' && v.voice_id)
    .map(v => ({ id: String(v.voice_id), name: typeof v.name === 'string' ? v.name : String(v.voice_id), category: typeof v.category === 'string' ? v.category : null }));
  return { ok: true, data: voices };
}

export type SpokenLine = { audio: Buffer; contentType: 'audio/mpeg'; characters: number };

/**
 * One line of text, spoken. Spends `text.length` characters of the account's
 * quota.
 * @param apiKey - The key.
 * @param input - What to say and in which voice.
 * @param input.voiceId - An id from `listVoices`.
 * @param input.text - The line (trimmed; refused when empty or over {@link ELEVENLABS_MAX_CHARS}).
 * @param input.modelId - The model; {@link ELEVENLABS_DEFAULT_MODEL} when unset.
 * @param input.speed - The pace, 0.7–1.2; 1 or unset is the voice's own.
 * @param input.form - `line` (default: one sentence, 128 kbps) or `script` (a brief read aloud: longer, 64 kbps).
 * @param doFetch - The network, injected in tests.
 */
export async function speak(apiKey: string, input: { voiceId: string; text: string; modelId?: string; speed?: number; form?: 'line' | 'script' }, doFetch?: ElevenLabsFetch): Promise<ElevenLabsResult<SpokenLine>> {
  const text = input.text.trim();
  const script = input.form === 'script';
  const max = script ? ELEVENLABS_SCRIPT_MAX_CHARS : ELEVENLABS_MAX_CHARS;
  if (!text) {
    return { ok: false, error: 'voice_error', status: null, message: 'There is nothing to say: the line is empty.' };
  }
  if (text.length > max) {
    return { ok: false, error: 'voice_error', status: null, message: `The ${script ? 'script' : 'line'} is ${text.length} characters, over the ${max} a spoken ${script ? 'script' : 'line'} may be.` };
  }
  if (!/^[\w-]{1,64}$/.test(input.voiceId)) {
    return { ok: false, error: 'voice_error', status: null, message: `"${input.voiceId.slice(0, 40)}" is not a voice id.` };
  }
  const res = await call(apiKey, `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${script ? ELEVENLABS_SCRIPT_FORMAT : ELEVENLABS_OUTPUT_FORMAT}`, {
    method: 'POST',
    accept: 'audio/mpeg',
    // ElevenLabs' pace is 0.7–1.2; anything else is left at the voice's own.
    body: { text, model_id: input.modelId ?? ELEVENLABS_DEFAULT_MODEL, ...(input.speed && input.speed !== 1 && input.speed >= 0.7 && input.speed <= 1.2 ? { voice_settings: { speed: input.speed } } : {}) },
  }, doFetch);
  if (!res.ok) {
    return res;
  }
  const audio = Buffer.from(await res.data.arrayBuffer());
  if (audio.byteLength === 0) {
    return { ok: false, error: 'voice_error', status: res.data.status, message: 'ElevenLabs answered with no audio.' };
  }
  return { ok: true, data: { audio, contentType: 'audio/mpeg', characters: text.length } };
}

/** The connector slug this client serves. */
export const ELEVENLABS_CONNECTOR_SLUG = 'elevenlabs';

/**
 * The voice capability, served by ElevenLabs with one key.
 * @param apiKey - The key.
 * @param doFetch - The network, injected in tests.
 */
export function elevenLabsVoice(apiKey: string, doFetch?: ElevenLabsFetch): VoiceProvider {
  return {
    connector: ELEVENLABS_CONNECTOR_SLUG,
    label: 'ElevenLabs',
    defaultVoice: ELEVENLABS_DEFAULT_VOICE,
    scriptModel: elevenLabsScriptModel(),
    async listVoices() {
      const res = await listVoices(apiKey, doFetch);
      return res.ok ? { ok: true, voices: res.data.map(v => ({ id: v.id, name: v.name })) } : { ok: false, reason: res.message };
    },
    async speak(input) {
      const res = await speak(apiKey, input, doFetch);
      if (!res.ok) {
        return { ok: false, reason: res.message, ...(res.status === 400 || res.status === 404 ? { badVoice: true } : {}) };
      }
      return { ok: true, audio: res.data.audio, contentType: res.data.contentType, characters: res.data.characters, ...(input.form === 'script' ? { durationMs: scriptDurationMs(res.data.audio.byteLength) } : {}) };
    },
  };
}

/** How the voice capability finds this connector (`libs/voice/connectors.ts`). */
export const elevenLabsVoiceConnector: VoiceConnector = {
  slug: ELEVENLABS_CONNECTOR_SLUG,
  label: 'ElevenLabs',
  envKey: 'ELEVENLABS_API_KEY',
  fromCredentials(values) {
    const key = elevenLabsKeyFrom(values);
    return key.ok ? elevenLabsVoice(key.apiKey) : null;
  },
};
