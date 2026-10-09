/**
 * The workspace's voice: the first connected connector that can speak
 * (`libs/voice/connectors.ts`), resolved from the vault the way every other
 * connector's key is — the source a person connected on the Connections page
 * first (its row names the credential), then the workspace's one live platform
 * credential of that kind under Settings → Credentials.
 *
 * Null when none is connected or its credential cannot be used: a caller that
 * would speak does nothing then.
 *
 * A voice is a team connector, so it lives in a team workspace, while a
 * person's own brief lives in their Personal workspace.
 * {@link voiceProviderForAccount} therefore looks in the asking workspace,
 * then in the Org's other workspaces, then at the server's key
 * (`ELEVENLABS_API_KEY`): one key anywhere in the Org speaks for it.
 */

import type { VoiceConnector, VoiceProvider } from '@/libs/voice/provider';
import process from 'node:process';
import { VOICE_CONNECTORS } from '@/libs/voice/connectors';

export type VoiceDeps = {
  connectors?: readonly VoiceConnector[];
  /** The decrypted credential for a connector slug, or null. */
  credentialFor?: (orgId: string, slug: string) => Promise<Record<string, unknown> | null>;
  /** The Org's workspaces, oldest first (a seam for tests). */
  workspacesOf?: (accountId: string) => Promise<string[]>;
  env?: Record<string, string | undefined>;
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

/**
 * The Org's workspaces, oldest first: where a team connector may live.
 * @param accountId - The Org.
 */
async function orgWorkspaces(accountId: string): Promise<string[]> {
  const { asc, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { projectSchema } = await import('@/models/Schema');
  const rows = await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.accountId, accountId)).orderBy(asc(projectSchema.createdAt)).limit(50);
  return rows.map(r => r.id);
}

/**
 * A voice for anything the Org speaks — a brief read aloud: the asking
 * workspace's own, else the first of the Org's workspaces that connected one,
 * else the server's key. Null when there is none anywhere; never throws.
 * @param orgId - The asking workspace (a Personal workspace, for a person's brief).
 * @param accountId - Its Org, or null to look only in the workspace and the server.
 * @param deps - Seams for tests.
 */
export async function voiceProviderForAccount(orgId: string, accountId: string | null, deps: VoiceDeps = {}): Promise<VoiceProvider | null> {
  const own = await voiceProvider(orgId, deps);
  if (own) {
    return own;
  }
  if (accountId) {
    const others = await (deps.workspacesOf ?? orgWorkspaces)(accountId).catch(() => [] as string[]);
    for (const id of others.filter(w => w !== orgId)) {
      const found = await voiceProvider(id, deps);
      if (found) {
        return found;
      }
    }
  }
  const env = deps.env ?? process.env;
  for (const c of deps.connectors ?? VOICE_CONNECTORS) {
    const key = c.envKey ? env[c.envKey]?.trim() : '';
    const provider = key ? c.fromCredentials({ apiKey: key }) : null;
    if (provider) {
      return provider;
    }
  }
  return null;
}
