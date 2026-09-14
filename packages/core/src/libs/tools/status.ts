/**
 * Turning a provider into the status line the Tools catalog renders.
 *
 * Every capability answers the same three-part question — is a key needed, who
 * has one, and which account gets billed — so the answer lives here once
 * rather than four times over in the capability registries.
 *
 * The order matters and mirrors what the providers actually do at call time:
 * the org's own key wins, the server's env var is the fallback. Reporting them
 * the other way round would tell a workspace the server is paying when it is
 * not.
 *
 * Nothing here throws. These statuses render two dashboard pages from server
 * components with no error boundary, and the server's own view is worth
 * showing even when the credential store cannot be reached.
 */

import type { StoredToolCredential } from './orgKey';
import type { CapabilityStatus } from './types';
import { storedToolProviderCredential } from './orgKey';

/** The part of a provider this module needs to report on it. */
type ReportableProvider = {
  readonly name: string;
  readonly requiredEnv: string[];
  isReady: () => boolean;
};

/**
 * The catalog status for one capability's active provider.
 * @param capability - The capability key, e.g. `web_search`.
 * @param provider - The provider currently selected for it.
 * @param orgId - The org the page is being rendered for, or undefined for the
 * server's own view — with no org there is nothing to look a stored key up by,
 * so the credential store is left alone entirely.
 */
export async function statusForProvider(
  capability: string,
  provider: ReportableProvider,
  orgId?: string,
): Promise<CapabilityStatus> {
  // A provider that names no env var needs no key — the builtin page extractor
  // and the calculator both call nothing that bills anyone.
  if (provider.requiredEnv.length === 0) {
    return {
      capability,
      provider: provider.name,
      ready: provider.isReady(),
      missingEnv: [],
      keySource: 'none',
    };
  }

  const stored = orgId ? await storedCredentialOrNone(provider.name, orgId) : null;
  if (stored) {
    return {
      capability,
      provider: provider.name,
      ready: true,
      missingEnv: [],
      keySource: 'workspace',
      storedKeyHint: stored.keyHint,
    };
  }

  if (provider.isReady()) {
    return { capability, provider: provider.name, ready: true, missingEnv: [], keySource: 'server' };
  }

  return {
    capability,
    provider: provider.name,
    ready: false,
    missingEnv: provider.requiredEnv,
    keySource: 'none',
  };
}

/**
 * The org's stored credential for `provider`, or null when it has none — and
 * also null when the lookup itself fails.
 *
 * A credential store that cannot be reached is reported as "the org has no key
 * of its own", which falls the status back to the server's view. The
 * alternative is a 500 on a page that could have said something useful.
 * @param provider - The provider being reported on.
 * @param orgId - The org the page is being rendered for.
 */
async function storedCredentialOrNone(
  provider: string,
  orgId: string,
): Promise<StoredToolCredential | null> {
  try {
    return await storedToolProviderCredential(provider, orgId);
  } catch (error) {
    console.error('[tools/status] could not read the org\'s stored credential', { provider, orgId, error });
    return null;
  }
}
