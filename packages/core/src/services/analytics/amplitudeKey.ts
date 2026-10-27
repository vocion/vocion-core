/**
 * The Amplitude key, as one of the System Keys (`services/keys/systemKeys.ts`):
 * saved on System for the instance, overridden per workspace on Developers,
 * else `AMPLITUDE_API_KEY`. It turns on browser analytics
 * (`features/analytics`) and Agent Analytics (`libs/Amplitude.ts`) for the
 * workspaces it covers.
 *
 * A different credential from the Amplitude connector's key pair
 * (`libs/platforms/registry.ts`), which READS a business's Amplitude project
 * and sends nothing. Sharing one would pour Vocion's usage into a client's
 * project the day that client connected its Amplitude as a source.
 *
 * Resolved on every page load and every model call, so the answer is held for
 * a minute per workspace; saving or removing a key here clears it at once.
 */

import type { KeyScope, SystemKeyService } from '@/services/keys/systemKeys';
import { removeSystemKey, resolveSystemKey, saveSystemKey, systemKeyStatus } from '@/services/keys/systemKeys';

/** An Amplitude project API key: 32 hex characters. */
const KEY_SHAPE = /^[a-f0-9]{32}$/i;

export const AMPLITUDE_KEY: SystemKeyService = {
  id: 'amplitude',
  envVar: 'AMPLITUDE_API_KEY',
  problem: (raw) => {
    const key = raw.trim();
    if (!key) {
      return 'Paste an Amplitude project API key.';
    }
    return KEY_SHAPE.test(key)
      ? null
      : 'That does not look like an Amplitude API key: it is 32 letters and digits, from Settings → Projects → your project → General.';
  },
  providerOf: () => 'amplitude',
};

const TTL_MS = 60_000;
const cache = new Map<string, { key: string | null; until: number }>();

/**
 * The key this workspace's events go to, or null when analytics is off here.
 * A saved key that will not decrypt reads as off, and says so in the log.
 * @param orgId - The workspace (`project.id`).
 */
export async function amplitudeKeyFor(orgId: string): Promise<string | null> {
  const hit = cache.get(orgId);
  if (hit && hit.until > Date.now()) {
    return hit.key;
  }
  let key: string | null = null;
  try {
    key = (await resolveSystemKey(AMPLITUDE_KEY, orgId))?.key ?? null;
  } catch (error) {
    console.error('[amplitude] the saved key would not decrypt; analytics is off for this workspace', { orgId, error });
  }
  cache.set(orgId, { key, until: Date.now() + TTL_MS });
  return key;
}

export const amplitudeKeyStatus = (orgId: string) => systemKeyStatus(AMPLITUDE_KEY, orgId);

export async function saveAmplitudeKey(input: { scope: KeyScope; orgId: string; key: string; by: string }) {
  const saved = await saveSystemKey(AMPLITUDE_KEY, input);
  cache.clear();
  return saved;
}

export async function removeAmplitudeKey(scope: KeyScope, orgId: string): Promise<void> {
  await removeSystemKey(AMPLITUDE_KEY, scope, orgId);
  cache.clear();
}

export function resetAmplitudeKeyCacheForTests(): void {
  cache.clear();
}
