/**
 * The Google Ads accounts the workspace's Google login can run, for the
 * Connectors form: after "Log in with Google" the Customer ID is a pick from
 * this list, never ten digits a person has to find and type
 * (`libs/sources/configFields.ts` `optionsFrom: 'google-ads-accounts'`).
 */
import type { AdsAccountChoice } from '@/libs/googleAds/client';
import { platformForConnectorSlug } from '@/libs/platforms/registry';

export type AdsAccountChoices = { accounts: AdsAccountChoice[]; reason?: string };

/**
 * The accounts on this workspace's newest live Google login that holds Ads
 * access. With no such login, an empty list and the sentence that says what
 * to do first.
 * @param orgId - The workspace.
 */
export async function googleAdsAccountChoices(orgId: string): Promise<AdsAccountChoices> {
  const platform = platformForConnectorSlug('google-ads');
  if (!platform) {
    return { accounts: [], reason: 'Google Ads is not a connector here.' };
  }
  const [{ newestLiveCredential }, { getCredentialsForConnector }] = await Promise.all([
    import('@/services/connect/createSourceOnLogin'),
    import('@/services/SourceCredentialService'),
  ]);
  const credential = await newestLiveCredential(orgId, platform.id);
  if (!credential) {
    return { accounts: [], reason: 'Log in with Google first, then pick the account.' };
  }
  const bag = await getCredentialsForConnector({ orgId, connectorSlug: 'google-ads', apiTokenId: credential.id });
  if (!bag) {
    return { accounts: [], reason: 'Log in with Google first, then pick the account.' };
  }
  const [{ resolveGoogleAccessToken }, { listGoogleAdsAccounts }] = await Promise.all([
    import('@/libs/sources/googleAuth'),
    import('@/libs/googleAds/client'),
  ]);
  try {
    const accounts = await listGoogleAdsAccounts(await resolveGoogleAccessToken(bag, orgId));
    return accounts.length > 0 ? { accounts } : { accounts, reason: 'This Google login runs no Google Ads account yet.' };
  } catch (error) {
    return { accounts: [], reason: error instanceof Error ? error.message : 'Google Ads did not answer just now. Try again in a minute.' };
  }
}
