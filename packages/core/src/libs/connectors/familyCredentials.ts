/**
 * The decrypted credential a family source authenticates with — the same
 * answer its sync gets, so a live read by an agent and a sync of the same
 * source fail and recover the same way.
 *
 * The source's own linked credential first (`knowledge_source.api_token_id`,
 * how a pasted key or a login is attached), then the connector's install
 * credential under the source's slug, then under its connector kind — the
 * three places a credential for one source can be.
 */

import type { FamilySource } from './families';
import { logger } from '@/libs/Logger';
import { getCredentialsForConnector } from '@/services/SourceCredentialService';

/**
 * The credential bag for a family source, or undefined when none is stored.
 * A credential that is revoked or expired throws its own sentence
 * (`ConnectorCredentialError`), which callers hand on as it is.
 * @param orgId - The workspace.
 * @param source - The source, as `familySourcesForOrg` returned it.
 */
export async function familySourceCredentials(orgId: string, source: FamilySource): Promise<Record<string, unknown> | undefined> {
  const own = await getCredentialsForConnector({ orgId, connectorSlug: source.slug, apiTokenId: source.apiTokenId });
  if (own || source.apiTokenId) {
    return own;
  }
  if (source.kind === source.slug) {
    return undefined;
  }
  return getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: null });
}

/**
 * The persistence a login refresh needs for this source: save the rotated
 * grant to the source's row, and log a warning when it cannot.
 * @param orgId - The workspace.
 * @param source - The source the login belongs to.
 */
export function familyGrantPersistence(orgId: string, source: FamilySource) {
  return {
    kind: 'persist' as const,
    orgId,
    sourceId: source.id,
    warn: (message: string) => logger.warn(message, { orgId, sourceId: source.id, connector: source.kind }),
  };
}
