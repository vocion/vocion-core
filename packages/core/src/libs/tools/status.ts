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

  const stored = orgId ? await storedCredentialOrNone(provider.name, orgId) : { kind: 'none' as const };
  if (stored.kind === 'unknown') {
    // Not `none`, and deliberately not `ready`. `resolveToolProviderKey`
    // refuses the call in this state rather than falling back, so a page that
    // said "on the Vocion server key, ready" would contradict every search and
    // crawl the workspace runs — at exactly the moment somebody is trying to
    // work out what is wrong.
    return {
      capability,
      provider: provider.name,
      ready: false,
      missingEnv: [],
      keySource: 'unknown',
    };
  }
  if (stored.kind === 'found') {
    return {
      capability,
      provider: provider.name,
      ready: true,
      missingEnv: [],
      keySource: 'workspace',
      storedKeyHint: stored.credential.keyHint,
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

/** What a credential lookup can tell us, including that it could not tell us. */
type CredentialLookup
  = | { kind: 'found'; credential: StoredToolCredential }
    | { kind: 'none' }
    | { kind: 'unknown' };

/**
 * The org's stored credential for `provider`, or why there isn't one to report.
 *
 * Three answers rather than two. "This org stored nothing" and "the credential
 * store would not answer" look identical from a null, and they call for
 * opposite things on screen: the first falls back to the deployment's key and
 * runs, the second cannot run at all, because the call path refuses rather
 * than spending the wrong account.
 *
 * Still no throw. A settings page that 500s tells a person less than one that
 * renders and says which part it could not check.
 * @param provider - The provider being reported on.
 * @param orgId - The org the page is being rendered for.
 */
async function storedCredentialOrNone(
  provider: string,
  orgId: string,
): Promise<CredentialLookup> {
  try {
    const credential = await storedToolProviderCredential(provider, orgId);
    return credential ? { kind: 'found', credential } : { kind: 'none' };
  } catch (error) {
    console.error('[tools/status] could not read the org\'s stored credential', { provider, orgId, error });
    return { kind: 'unknown' };
  }
}
