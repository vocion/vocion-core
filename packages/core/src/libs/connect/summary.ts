/**
 * The account a connected source's grant is on, for the connector card.
 *
 * A person who connected GitHub by installing the app sees "Connected" and a
 * date, and nothing that says which organization or which repositories the
 * installation covers — so a source listing a repository the installation
 * was never granted looks exactly like one that works (Noco, 2026-09-30: a
 * green card over a sync that read nothing). This reads the stored bag once,
 * hands it to the provider that stored it, and returns only names.
 */
import type { GrantSummary } from './provider';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { providerForConnector } from './registry';

/**
 * The grant summary for one connector row, or null when there is nothing to
 * say: a connector no provider connects, a row with no credential, a pasted
 * token (no account was recorded), or a bag that will not decrypt. Never
 * throws — the card renders without it rather than not at all.
 * @param input - Which row.
 * @param input.orgId - The org that owns it.
 * @param input.sourceSlug - The connector row's slug.
 * @param input.connectorSlug - The connector it runs (`github`, `jira`, `slack`).
 */
export async function grantSummaryForSource(input: { orgId: string; sourceSlug: string; connectorSlug: string }): Promise<GrantSummary | null> {
  const provider = providerForConnector(input.connectorSlug);
  if (!provider) {
    return null;
  }
  try {
    const credentials = await getCredentialsForSource(input.orgId, input.sourceSlug);
    return credentials ? provider.summarize(credentials) : null;
  } catch {
    return null;
  }
}
