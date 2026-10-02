/**
 * Show an admin the stored login or key the Connectors form is about to reuse
 * (#1080). The page itself only ever carries the account and a masked tail;
 * the value crosses the wire here, on a deliberate "Show" click, to an admin.
 *
 * Every reveal writes a `source_audit` row (who, which credential, when) BEFORE
 * the value is returned, so a reveal that cannot be recorded does not happen.
 * The row holds ids and names, never the value.
 */

import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { sourceAuditSchema } from '@/models/Schema';
import { loginTokenOf, revealPlatformCredential } from '@/services/ApiTokenService';
import { newestLiveCredential } from './createSourceOnLogin';

/** The audit event a reveal writes. */
export const CREDENTIAL_REVEALED_EVENT = 'credential_revealed';

/**
 * What a reveal found. `ok` carries `values` keyed by the platform's credential
 * field names, ready to fill the form's inputs. `none` means the workspace holds
 * no live credential for the connector. `no-token` is a login with no token
 * string to show (a GitHub App installation).
 */
export type RevealStoredOutcome
  = | { status: 'ok'; values: Record<string, string> }
    | { status: 'none' }
    | { status: 'no-token' };

/**
 * Open the connector's newest live credential and record who looked.
 * @param input - Who is asking and for which connector.
 * @param input.orgId - The workspace.
 * @param input.userId - The admin asking, for the audit row.
 * @param input.connector - Connector slug.
 */
export async function revealStoredCredential(input: { orgId: string; userId: string; connector: string }): Promise<RevealStoredOutcome> {
  const platform = platformForConnectorSlug(input.connector);
  const stored = platform ? await newestLiveCredential(input.orgId, platform.id) : null;
  if (!platform || !stored) {
    return { status: 'none' };
  }
  const revealed = await revealPlatformCredential(input.orgId, stored.id, { includeLogin: true });
  if (revealed.status !== 'ok') {
    return { status: 'none' };
  }
  let values: Record<string, string>;
  if (stored.obtainedVia === 'login') {
    const token = loginTokenOf(revealed.values);
    const field = platform.fields.find(candidate => candidate.secret) ?? platform.fields[0];
    if (token === null || !field) {
      return { status: 'no-token' };
    }
    values = { [field.name]: token };
  } else {
    values = Object.fromEntries(Object.entries(revealed.values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }
  await db.insert(sourceAuditSchema).values({
    orgId: input.orgId,
    userId: input.userId,
    event: CREDENTIAL_REVEALED_EVENT,
    metadata: { connector: input.connector, platform: platform.id, credentialId: stored.id, obtainedVia: stored.obtainedVia },
  });
  return { status: 'ok', values };
}
