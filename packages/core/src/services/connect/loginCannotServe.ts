/**
 * Whether a saved login can serve a connector (#1080). One platform can hold
 * logins for several connectors with different access: a Google login made for
 * Drive has no Gmail scope, and Google Ads cannot use a Google login at all.
 * The add form, the chat card and the Connectors page all ask here before
 * treating a saved login as good for a connector.
 */

import type { StoredCredential } from './createSourceOnLogin';
import { providerForConnector } from '@/libs/connect/registry';
import { logger } from '@/libs/Logger';
import { howToConnectFor, platformForConnectorSlug } from '@/libs/platforms/registry';
import { getConnector } from '@/libs/sources/registry';
import { getCredentialsForConnector } from '@/services/SourceCredentialService';

/**
 * Why a saved login cannot serve this connector, or null when it can (or the
 * credential is a pasted key, which this never judges).
 *
 * - A connector with no login of its own (Google Ads) cannot use another
 *   connector's login: its API needs what a login does not carry.
 * - A provider that serves several connectors with different access (Google)
 *   says whether the login holds this connector's scope.
 *
 * A login that cannot be read is left to the save, which reports it the
 * usual way.
 * @param orgId - The workspace.
 * @param stored - The saved credential.
 * @param connector - The connector it would serve.
 */
export async function loginCannotServe(orgId: string, stored: StoredCredential, connector: string): Promise<string | null> {
  if (stored.obtainedVia !== 'login') {
    return null;
  }
  if (!howToConnectFor(connector)?.login) {
    const platformLabel = platformForConnectorSlug(connector)?.label ?? 'saved';
    return `${getConnector(connector)?.name ?? connector} can't use a ${platformLabel} login. Press Replace and paste its key.`;
  }
  const provider = providerForConnector(connector);
  if (!provider?.missingAccessFor) {
    return null;
  }
  try {
    const values = await getCredentialsForConnector({ orgId, connectorSlug: connector, apiTokenId: stored.id });
    return values ? provider.missingAccessFor(values, connector) : null;
  } catch (error) {
    logger.warn('loginCannotServe could not read the saved login to check its access', { orgId, connector, errorName: error instanceof Error ? error.name : 'unknown' });
    return null;
  }
}
