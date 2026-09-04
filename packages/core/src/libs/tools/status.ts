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
 */

import type { CapabilityStatus } from './types';
import { hasToolProviderKey } from './orgKey';

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

  const workspaceHasKey = orgId ? await hasToolProviderKey(provider.name, orgId) : false;
  if (workspaceHasKey) {
    return { capability, provider: provider.name, ready: true, missingEnv: [], keySource: 'workspace' };
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
