/**
 * The credential a family source authenticates with, resolved the one way
 * every family provider resolves it (`services/warehouse`, `services/productAnalytics`,
 * `services/ads`): the credential the source row names, else the login stored
 * on the connector's install, else the workspace's one live credential on the
 * connector's platform.
 *
 * Built per call and never cached: a provider is constructed with the bag this
 * returns, so a rotated or revoked key takes effect on the next read, and two
 * workspaces can never share one (CLAUDE.md, "Never cache a client keyed on
 * anything less than the exact key in use").
 */

import type { FamilySource } from '@/libs/connectors/families';
import { platformForConnectorSlug } from '@/libs/platforms/registry';

export type FamilyCredentials = Record<string, unknown>;

/**
 * The decrypted credential bag a family source reads with, or null when none is stored.
 *
 * A broken reference (the source names a revoked or deleted credential) throws
 * `ConnectorCredentialError`, whose message is written for a person: falling
 * through to another key in silence would spend a credential nobody chose.
 * @param orgId - The workspace.
 * @param source - The family source, as `familySourcesForOrg` returns it.
 */
export async function familySourceCredentials(orgId: string, source: FamilySource): Promise<FamilyCredentials | null> {
  const { getCredentialsForConnector } = await import('@/services/SourceCredentialService');
  if (source.apiTokenId) {
    return (await getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: source.apiTokenId })) ?? null;
  }
  for (const connectorSlug of new Set([source.slug, source.kind])) {
    const installed = await getCredentialsForConnector({ orgId, connectorSlug, apiTokenId: null });
    if (installed) {
      return installed;
    }
  }
  const platform = platformForConnectorSlug(source.kind);
  if (!platform || platform.credentialsPerOrg !== 'one-live') {
    return null;
  }
  const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
  return resolvePlatformCredential(orgId, platform.id);
}

/**
 * The sentence for a family source with no credential stored, naming where to put one.
 * @param source - The source.
 * @param vendor - The vendor's name, as a person knows it.
 */
export function noCredentialMessage(source: Pick<FamilySource, 'slug'>, vendor: string): string {
  return `The ${source.slug} source has no ${vendor} credential stored. Connect it at /dashboard/connectors (Test connection says whether it works).`;
}
