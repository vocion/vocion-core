import type { ElevenLabsFetch } from '@/libs/voice/elevenlabs';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { getPlatform, platformForConnectorSlug, validatePlatformCredential } from '@/libs/platforms/registry';
import { configFieldsFor } from '@/libs/sources/configFields';
import { elevenLabsConnector, inspectElevenLabs } from '@/libs/sources/elevenlabs';
import { getConnector } from '@/libs/sources/registry';
import { ELEVENLABS_DEFAULT_MODEL, elevenLabsKeyFrom, elevenLabsVoice, listVoices, readUser, speak } from '@/libs/voice/elevenlabs';
import { voiceProvider } from '@/services/voice/provider';

/**
 * The voice connector against a stand-in network: the header and paths it
 * sends, what it reads back, and how a refusal reads. The key is a fixture.
 */

const KEY = 'sk_fixture_northwind_0000000000000000';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function net(routes: Record<string, { status?: number; json?: unknown; text?: string; audio?: Uint8Array }>): { fetch: ElevenLabsFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: ElevenLabsFetch = async (url, init) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body });
    const path = new URL(url).pathname;
    const r = routes[path] ?? { status: 404, json: { detail: 'not found' } };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json ?? ''),
      arrayBuffer: async () => (r.audio ?? new Uint8Array()).buffer as ArrayBuffer,
    };
  };
  return { fetch, calls };
}

const USER = { subscription: { tier: 'starter', character_count: 2_000, character_limit: 40_000 } };
const VOICES = { voices: [{ voice_id: 'voice_aria_01', name: 'Aria', category: 'premade' }, { voice_id: 'voice_kestrel_02', name: 'Kestrel', category: 'cloned' }] };

describe('the ElevenLabs client', () => {
  it('reads the plan and characters with the xi-api-key header', async () => {
    const { fetch, calls } = net({ '/v1/user': { json: USER } });

    await expect(readUser(KEY, fetch)).resolves.toEqual({ ok: true, data: { tier: 'starter', characterCount: 2_000, characterLimit: 40_000 } });
    expect(calls[0]).toMatchObject({ url: 'https://api.elevenlabs.io/v1/user', method: 'GET' });
    expect(calls[0]!.headers['xi-api-key']).toBe(KEY);
  });

  it('lists voices by id and name', async () => {
    const { fetch } = net({ '/v1/voices': { json: VOICES } });

    await expect(listVoices(KEY, fetch)).resolves.toEqual({ ok: true, data: [{ id: 'voice_aria_01', name: 'Aria', category: 'premade' }, { id: 'voice_kestrel_02', name: 'Kestrel', category: 'cloned' }] });
  });

  it('speaks a line as MP3 with the default model', async () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
    const { fetch, calls } = net({ '/v1/text-to-speech/voice_aria_01': { audio: mp3 } });
    const res = await speak(KEY, { voiceId: 'voice_aria_01', text: '  The export downloads.  ' }, fetch);

    expect(res.ok).toBe(true);
    expect(res.ok && Buffer.compare(res.data.audio, Buffer.from(mp3))).toBe(0);
    expect(res.ok && res.data.characters).toBe('The export downloads.'.length);
    expect(calls[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice_aria_01?output_format=mp3_44100_128');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers.accept).toBe('audio/mpeg');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ text: 'The export downloads.', model_id: ELEVENLABS_DEFAULT_MODEL });
  });

  it('refuses without calling out: an empty line, a line too long, a voice id that is not one', async () => {
    const f = vi.fn();

    await expect(speak(KEY, { voiceId: 'v', text: '   ' }, f as never)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/empty/) });
    await expect(speak(KEY, { voiceId: 'v', text: 'x'.repeat(1_001) }, f as never)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/1001 characters/) });
    await expect(speak(KEY, { voiceId: '../user', text: 'hi' }, f as never)).resolves.toMatchObject({ ok: false, message: expect.stringMatching(/not a voice id/) });
    expect(f).not.toHaveBeenCalled();
  });

  it('says what a refusal means: a bad key, no characters left, rate limited', async () => {
    const bad = net({ '/v1/voices': { status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } } });
    const quota = net({ '/v1/text-to-speech/voice_aria_01': { status: 401, json: { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } } } });
    const slow = net({ '/v1/voices': { status: 429, json: { detail: 'Too many requests' } } });

    await expect(listVoices(KEY, bad.fetch)).resolves.toMatchObject({ ok: false, error: 'voice_unauthorized', message: expect.stringMatching(/refused the API key \(Invalid API key\)/) });
    await expect(speak(KEY, { voiceId: 'voice_aria_01', text: 'hi' }, quota.fetch)).resolves.toMatchObject({ ok: false, error: 'voice_quota', message: expect.stringMatching(/no characters left/) });
    await expect(listVoices(KEY, slow.fetch)).resolves.toMatchObject({ ok: false, error: 'voice_rate_limited' });
  });

  it('reads the key from the vaulted credential', () => {
    expect(elevenLabsKeyFrom({ apiKey: ` ${KEY} ` })).toEqual({ ok: true, apiKey: KEY });
    expect(elevenLabsKeyFrom({})).toMatchObject({ ok: false, message: expect.stringMatching(/Connect ElevenLabs/) });
  });
});

describe('the elevenlabs connector', () => {
  it('is registered as a sync-less API-key connector with its own credential platform', () => {
    expect(getConnector('elevenlabs')).toBe(elevenLabsConnector);
    expect(elevenLabsConnector).toMatchObject({ authKind: 'apikey', syncless: true });
    expect(configFieldsFor('elevenlabs')).toEqual([]);
    expect(platformForConnectorSlug('elevenlabs')?.id).toBe('elevenlabs');
    expect(getPlatform('elevenlabs').fields.map(f => [f.name, f.secret])).toEqual([['apiKey', true]]);
    expect(validatePlatformCredential('elevenlabs', { apiKey: KEY })).toEqual({ apiKey: KEY });
    expect(() => validatePlatformCredential('elevenlabs', { apiKey: 'has a space in it ok' })).toThrow();
  });

  it('tests the connection for free: the plan, the characters left and the voices', async () => {
    const { fetch, calls } = net({ '/v1/user': { json: USER }, '/v1/voices': { json: VOICES } });
    const res = await inspectElevenLabs({ credentials: { apiKey: KEY } }, fetch);

    expect(res).toMatchObject({ reachable: true, authorized: true, error: null });
    expect(res.checks).toEqual([
      { key: 'account', label: 'Reads the account', ok: true, detail: 'Plan: starter · 38,000 of 40,000 characters left this period' },
      { key: 'voices', label: 'Lists its voices', ok: true, detail: '2 voices: Aria, Kestrel' },
    ]);
    // Nothing is spoken by a test.
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('passes a key scoped without the user permission when it can list voices', async () => {
    const { fetch } = net({ '/v1/user': { status: 401, json: { detail: { status: 'missing_permissions', message: 'The API key is missing user_read' } } }, '/v1/voices': { json: VOICES } });
    const res = await inspectElevenLabs({ credentials: { apiKey: KEY } }, fetch);

    expect(res).toMatchObject({ authorized: true, error: null });
    expect(res.checks[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/missing a permission/) });
  });

  it('fails a refused key, with the reason', async () => {
    const refused = { status: 401, json: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } };
    const { fetch } = net({ '/v1/user': refused, '/v1/voices': refused });
    const res = await inspectElevenLabs({ credentials: { apiKey: KEY } }, fetch);

    expect(res).toMatchObject({ reachable: true, authorized: false, error: expect.stringMatching(/refused the API key/) });
  });

  it('asks for a key before calling out', async () => {
    await expect(inspectElevenLabs({ credentials: {} })).rejects.toThrow(/No ElevenLabs API key/);
  });
});

describe('the voice capability', () => {
  it('serves voices and speech through the provider shape callers use', async () => {
    const mp3 = new Uint8Array([1, 2, 3]);
    const { fetch } = net({ '/v1/voices': { json: VOICES }, '/v1/text-to-speech/voice_aria_01': { audio: mp3 } });
    const voice = elevenLabsVoice(KEY, fetch);

    await expect(voice.listVoices()).resolves.toEqual({ ok: true, voices: [{ id: 'voice_aria_01', name: 'Aria' }, { id: 'voice_kestrel_02', name: 'Kestrel' }] });
    await expect(voice.speak({ voiceId: 'voice_aria_01', text: 'hi' })).resolves.toMatchObject({ ok: true, contentType: 'audio/mpeg' });
  });

  it('is null when no voice connector is connected, and each org gets its own key', async () => {
    await expect(voiceProvider('org_none', { credentialFor: async () => null })).resolves.toBeNull();

    const seen: string[] = [];
    const connectors = [{ slug: 'elevenlabs', label: 'ElevenLabs', fromCredentials: (v: Record<string, unknown>) => {
      seen.push(String(v.apiKey));
      return elevenLabsVoice(String(v.apiKey));
    } }];
    const keys: Record<string, string> = { org_a: 'sk_fixture_a_000000000000', org_b: 'sk_fixture_b_000000000000' };

    expect(await voiceProvider('org_a', { connectors, credentialFor: async o => ({ apiKey: keys[o] }) })).not.toBeNull();
    expect(await voiceProvider('org_b', { connectors, credentialFor: async o => ({ apiKey: keys[o] }) })).not.toBeNull();
    expect(seen).toEqual([keys.org_a, keys.org_b]);
  });

  it('is null when the stored credential cannot be used', async () => {
    await expect(voiceProvider('org_x', { credentialFor: async () => ({ apiKey: '' }) })).resolves.toBeNull();
  });
});
