/**
 * The workspace's Sentry credential, resolved once for every reader — the
 * agents' tools, the product page and the error watch.
 *
 * Two places can hold it, and both are the same vault: the `sentry` source a
 * person connected on the Connections page (its row names the credential), or
 * the workspace's one live `sentry` platform credential saved under Settings →
 * Credentials. The connected source wins, because it is the one whose Test
 * connection a person saw pass.
 */

import type { SentryCredentials } from '@/libs/sentry/client';
import { sentryCredentialsFrom } from '@/libs/sentry/client';

export const SENTRY_CONNECTOR_SLUG = 'sentry';

export type SentryAccess = { ok: true; credentials: SentryCredentials } | { ok: false; error: 'no_sentry_credentials'; message: string };

/**
 * The org's Sentry credential, or why there is none, in words a person acts on.
 * @param orgId - The workspace.
 */
export async function sentryFor(orgId: string): Promise<SentryAccess> {
  let values: Record<string, unknown> | null = null;
  let problem: string | null = null;
  try {
    const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
    values = (await getCredentialsForSource(orgId, SENTRY_CONNECTOR_SLUG)) as Record<string, unknown> | undefined ?? null;
  } catch (err) {
    // A connected source whose credential was revoked says so, rather than
    // falling through to another key without a word.
    problem = (err as Error).message;
  }
  if (!values) {
    try {
      const { resolvePlatformCredential } = await import('@/services/ApiTokenService');
      values = await resolvePlatformCredential(orgId, 'sentry');
    } catch (err) {
      problem = problem ?? (err as Error).message;
    }
  }
  const parsed = sentryCredentialsFrom(values);
  if (parsed.ok) {
    return parsed;
  }
  return { ok: false, error: 'no_sentry_credentials', message: values ? parsed.message : `${problem ? `${problem} ` : ''}${parsed.message}` };
}
