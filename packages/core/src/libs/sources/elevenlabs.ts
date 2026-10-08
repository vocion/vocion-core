/**
 * ElevenLabs connector — the carrier for the workspace's voice, and nothing
 * else.
 *
 * ElevenLabs is called, never mirrored: a narration speaks its lines with it
 * when it runs (`libs/voice/elevenlabs.ts`, through the voice capability in
 * `services/voice/provider.ts`). So this connector ingests nothing, the way
 * Sentry's and Apollo's do not. What registering it buys is everything around
 * the key: a tile on Connections, a place in the encrypted vault, and —
 * through `inspect` — a Test connection that says whether the key works, the
 * plan and the characters left this period, and how many voices it can speak
 * in. Testing costs no characters.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { ElevenLabsFetch } from '@/libs/voice/elevenlabs';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { ELEVENLABS_CONNECTOR_SLUG, elevenLabsKeyFrom, listVoices, readUser } from '@/libs/voice/elevenlabs';
import { InspectInputError } from './inspect';

const elevenLabsConfigSchema = z.object({});

function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Test connection: the account (`GET /v1/user`), then its voices
 * (`GET /v1/voices`). Free; nothing is spoken and nothing is saved. A key
 * scoped without the user permission still passes when it lists voices,
 * since speaking is what the workspace uses it for.
 * @param input - Config and credential, as typed or as vaulted.
 * @param input.credentials - The credential values.
 * @param doFetch - The network, injected in tests.
 */
export async function inspectElevenLabs(input: { credentials: Record<string, unknown> }, doFetch?: ElevenLabsFetch): Promise<ConnectorInspection> {
  const key = elevenLabsKeyFrom(input.credentials);
  if (!key.ok) {
    throw new InspectInputError(key.message);
  }
  const checks: ConnectorCheck[] = [];
  const user = await readUser(key.apiKey, doFetch);
  if (user.ok) {
    const { tier, characterCount, characterLimit } = user.data;
    const left = characterCount !== null && characterLimit !== null ? `${Math.max(0, characterLimit - characterCount).toLocaleString('en-US')} of ${characterLimit.toLocaleString('en-US')} characters left this period` : null;
    checks.push(check('account', 'Reads the account', true, [tier ? `Plan: ${tier}` : null, left].filter(Boolean).join(' · ') || null));
  } else {
    checks.push(check('account', 'Reads the account', false, user.message));
  }
  const voices = await listVoices(key.apiKey, doFetch);
  if (voices.ok) {
    const names = voices.data.slice(0, 5).map(v => v.name).join(', ');
    checks.push(check('voices', 'Lists its voices', voices.data.length > 0, voices.data.length > 0 ? `${voices.data.length} voice${voices.data.length === 1 ? '' : 's'}: ${names}${voices.data.length > 5 ? ', …' : ''}` : 'The account has no voice to speak with.'));
  } else {
    checks.push(check('voices', 'Lists its voices', false, voices.message));
  }
  const unauthorized = !user.ok && user.error === 'voice_unauthorized' && !voices.ok && voices.error === 'voice_unauthorized';
  const unreachable = !user.ok && user.status === null && !voices.ok && voices.status === null;
  const failed = checks.filter(c => !c.ok);
  const usable = voices.ok && voices.data.length > 0;
  return {
    reachable: !unreachable,
    authorized: !unauthorized,
    checks,
    note: 'Speaking a line spends the account\'s characters; a narrated recording is a few hundred.',
    error: usable ? null : failed.map(c => c.detail).filter(Boolean).join(' ') || null,
  };
}

export const elevenLabsConnector: SourceConnector<typeof elevenLabsConfigSchema> = {
  slug: ELEVENLABS_CONNECTOR_SLUG,
  name: 'ElevenLabs',
  description: 'A voice for the workspace\'s agents. Speaks the narration over a QA recording in the agent\'s voice. Nothing is synced.',
  icon: 'AudioLines',
  brand: 'elevenlabs',
  authKind: 'apikey',
  syncless: true,
  configSchema: elevenLabsConfigSchema,
  inspectNote: 'Reads the account and its voices. Free: nothing is spoken and nothing is saved.',

  async inspect({ credentials }) {
    return inspectElevenLabs({ credentials });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // A voice is called when a narration runs, never mirrored.
  },
};
