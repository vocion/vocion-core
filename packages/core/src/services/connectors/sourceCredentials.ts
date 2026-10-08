/**
 * The credential a family source authenticates with, for the callers that
 * hold the source row rather than a sync context — the agents' read tools and
 * the actions. One answer for every prebuilt connector, in the order the sync
 * itself resolves it:
 *
 *   1. the credential the source row names (`api_token_id` — a pasted key or
 *      a login), or the source's own install credential;
 *   2. the install credential of the connector the source runs;
 *   3. the workspace's one live credential for the connector's platform,
 *      saved under Settings → Credentials with no source pointing at it.
 *
 * Always per org and per call: nothing is cached, so a rotated or revoked key
 * takes effect on the next call and one workspace's key never answers for
 * another's (the two-org tests hold it).
 *
 * A source whose credential was revoked says so (`ConnectorCredentialError`)
 * rather than falling through to another key without a word.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { platformForConnectorSlug } from '@/libs/platforms/registry';

/**
 * The decrypted credential bag for a source, or undefined when the workspace
 * holds none for it.
 * @param orgId - The workspace.
 * @param source - The source row (slug, kind, the credential it names).
 */
export async function credentialsForSource(orgId: string, source: Pick<FamilySource, 'slug' | 'kind' | 'apiTokenId'>): Promise<Record<string, unknown> | undefined> {
  const { getCredentialsForConnector, ConnectorCredentialError } = await import('@/services/SourceCredentialService');
  try {
    const own = await getCredentialsForConnector({ orgId, connectorSlug: source.slug, apiTokenId: source.apiTokenId });
    if (own) {
      return own;
    }
  } catch (err) {
    if (err instanceof ConnectorCredentialError) {
      throw err;
    }
  }
  if (source.kind !== source.slug) {
    const byKind = await getCredentialsForConnector({ orgId, connectorSlug: source.kind, apiTokenId: null }).catch(() => undefined);
    if (byKind) {
      return byKind;
    }
  }
  const platform = platformForConnectorSlug(source.kind);
  if (platform && platform.credentialsPerOrg === 'one-live') {
    const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
    return (await resolvePlatformCredential(orgId, platform.id)) ?? undefined;
  }
  return undefined;
}

/**
 * The one enabled source of a family the call is about: the named one, else
 * the workspace's only one. Anything else is an error naming what is
 * connected, so the agent can say which it can and cannot reach.
 * @param sources - The family's enabled sources.
 * @param label - The family as a person names it ("help desk").
 * @param sourceSlug - The source the caller named, if any.
 */
export function pickFamilySource(sources: FamilySource[], label: string, sourceSlug?: string | null): FamilySource {
  if (sources.length === 0) {
    throw new Error(`This workspace has no ${label} connected. Connect one at /dashboard/connectors and give this agent the source.`);
  }
  const connected = sources.map(s => `${s.slug} (${s.kind})`).join(', ');
  if (sourceSlug) {
    const named = sources.find(s => s.slug === sourceSlug || s.kind === sourceSlug);
    if (!named) {
      throw new Error(`No ${label} source named ${sourceSlug}. Connected: ${connected}.`);
    }
    return named;
  }
  if (sources.length > 1) {
    throw new Error(`This workspace has ${sources.length} ${label} sources; name one (source). Connected: ${connected}.`);
  }
  return sources[0]!;
}
