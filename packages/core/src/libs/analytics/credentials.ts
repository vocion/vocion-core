/**
 * Resolving "which analytics property should this measure read, and as whom"
 * for a given org.
 *
 * Web analytics is the second `verified` connector behind a team measure, and
 * like Bedrock its credential is not one pasted string: a Google service
 * account is a client email plus a PEM private key, and the read also needs
 * the property to run the report against. So it cannot go through
 * `resolvePlatformKey`, which deliberately refuses multi-field platforms —
 * handing back field one would hand back a property id, which authenticates
 * nothing. This module is the `resolveBedrockCredentials` of the analytics
 * path: the org's stored credential first, the server's env vars second.
 *
 * **There is no third fallback, and that is the point.** Bedrock may fall
 * through to the AWS SDK's ambient chain because a host identity is a real
 * answer there. Nothing is ambient about a GA4 property: if neither the
 * workspace nor the deployment named one, there is no property to read and no
 * honest number to show. This function returns null, the measure resolves to
 * `unconfigured`, and the report says "not connected" instead of 0. A zero
 * that means "we did not ask" is exactly what the provenance model exists to
 * prevent.
 *
 * Resolved per call, never cached against anything looser than the exact
 * credential — see `runWebAnalyticsReport`, which caches minted access tokens
 * by a digest of the key that minted them and not by org.
 */

import process from 'node:process';
import { resolvePlatformCredential } from '@/services/ApiTokenService';

/** Where the analytics credential came from, for logging and for tests. */
export type WebAnalyticsCredentialSource = 'org' | 'environment';

/** A Google service account, as the Data API needs it. */
export type ServiceAccountKey = {
  clientEmail: string;
  /** PEM, with real newlines — see {@link normalizePrivateKey}. */
  privateKey: string;
};

export type WebAnalyticsCredentials = {
  source: WebAnalyticsCredentialSource;
  /** The numeric GA4 property the report runs against, as `properties/<id>`. */
  propertyId: string;
  serviceAccount: ServiceAccountKey;
};

/**
 * A PEM private key with real newlines.
 *
 * The `private_key` in a Google service-account JSON file carries its
 * newlines as the two characters `\` and `n`. A person pasting that value out
 * of the file — or an env var set from it, where a literal newline cannot
 * survive a `.env` line — ends up with the escaped form, which every RSA
 * signer rejects with an unhelpful message. Unescaping here means both pastes
 * work and neither produces a "failed to read" the workspace cannot explain.
 * @param raw - The private key exactly as stored.
 */
export function normalizePrivateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/**
 * Every field a complete analytics credential needs, whichever half supplied it.
 * @param source - Which half supplied these values.
 * @param propertyId - The GA4 property.
 * @param clientEmail - The service account.
 * @param privateKey - Its PEM key.
 */
function assemble(
  source: WebAnalyticsCredentialSource,
  propertyId: string | undefined,
  clientEmail: string | undefined,
  privateKey: string | undefined,
): WebAnalyticsCredentials | null {
  if (!propertyId || !clientEmail || !privateKey) {
    // A partial credential is not a credential. Reading with two of three
    // values would fail at the transport with a vendor error; answering null
    // makes it the same "not connected" state as having supplied nothing,
    // which is what a person can actually act on.
    return null;
  }
  return { source, propertyId, serviceAccount: { clientEmail, privateKey: normalizePrivateKey(privateKey) } };
}

/**
 * The analytics identity and property a `verified` web-analytics measure for
 * `orgId` should read with, or null when neither the workspace nor the
 * deployment has configured one.
 *
 * Null is the ordinary answer for a workspace that has not connected
 * analytics, not an error — `provenance.ts` turns it into an `unconfigured`
 * reading with `value: null`.
 *
 * **Does throw when the org's stored credential cannot be decrypted.**
 * `resolvePlatformCredential` throws on decryption failure rather than
 * answering null, and that is not caught here for the same reason Bedrock does
 * not catch it: treating "the vault will not open" like "nothing is stored"
 * would silently read the DEPLOYMENT's property and label the answer
 * `verified` for this workspace. The caller turns the throw into an `error`
 * reading — a state the report shows, never a zero.
 * @param orgId - The workspace the measure belongs to.
 */
export async function resolveWebAnalyticsCredentials(orgId: string): Promise<WebAnalyticsCredentials | null> {
  const stored = await resolvePlatformCredential(orgId, 'google-analytics');
  const fromOrg = assemble('org', stored?.propertyId, stored?.clientEmail, stored?.privateKey);
  if (fromOrg) {
    return fromOrg;
  }
  return assemble(
    'environment',
    process.env.GOOGLE_ANALYTICS_PROPERTY_ID,
    process.env.GOOGLE_ANALYTICS_CLIENT_EMAIL,
    process.env.GOOGLE_ANALYTICS_PRIVATE_KEY,
  );
}
