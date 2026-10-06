/**
 * The workspace's voice: the first connected connector that can speak
 * (`libs/voice/connectors.ts`), resolved from the vault the way every other
 * connector's key is — the source a person connected on the Connections page
 * first (its row names the credential), then the workspace's one live platform
 * credential of that kind under Settings → Credentials.
 *
 * Null when none is connected or its credential cannot be used: a caller that
 * would speak does nothing then.
 */

import type { VoiceConnector, VoiceProvider } from '@/libs/voice/provider';
import { VOICE_CONNECTORS } from '@/libs/voice/connectors';

export type VoiceDeps = {
  connectors?: readonly VoiceConnector[];
  /** The decrypted credential for a connector slug, or null. */
  credentialFor?: (orgId: string, slug: string) => Promise<Record<string, unknown> | null>;
};

/**
 * A connector's decrypted credential: its connected source, else the
 * workspace's platform credential for it. Null when neither is usable.
 * @param orgId - The workspace.
 * @param slug - The connector slug.
 */
async function vaultedCredential(orgId: string, slug: string): Promise<Record<string, unknown> | null> {
  try {
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    const values = await getCredentialsForSource(orgId, slug);
    if (values) {
      return values as Record<string, unknown>;
    }
  } catch {
    // A revoked source credential falls through to the platform credential.
  }
  try {
    const { platformForConnectorSlug } = await import('@/libs/platforms/registry');
    const platform = platformForConnectorSlug(slug);
    if (!platform) {
      return null;
    }
    const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
    return (await resolvePlatformCredential(orgId, platform.id)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/**
 * The workspace's voice, or null when it has none. Never throws.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function voiceProvider(orgId: string, deps: VoiceDeps = {}): Promise<VoiceProvider | null> {
  const credentialFor = deps.credentialFor ?? vaultedCredential;
  for (const c of deps.connectors ?? VOICE_CONNECTORS) {
    const values = await credentialFor(orgId, c.slug).catch(() => null);
    const provider = values ? c.fromCredentials(values) : null;
    if (provider) {
      return provider;
    }
  }
  return null;
}
