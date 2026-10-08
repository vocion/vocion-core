/**
 * The check every vault makes before it unwraps a DEK: the `source_dek` row a
 * credential names belongs to the org the read is for.
 *
 * One definition for both vaults, so a credential sealed for one workspace is
 * refused in another the same way whichever vault the deployment runs. It
 * matters most on the local vault, where every DEK row resolves to the same
 * master key and nothing else would stop one org's credential opening for
 * another; on KMS it also saves the round trip, and the EncryptionContext
 * stands behind it.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { sourceDekSchema } from '@/models/Schema';
import { VaultDecryptionError } from './credentialVault';

/** The `source_dek` columns an unwrap needs. */
export type DekRow = { id: number; orgId: string; wrappedDek: string };

/**
 * The refusal for a credential read under an org its DEK does not belong to.
 * A `VaultDecryptionError`, so the routes show it: it names the cause and the
 * fix and no secret. The two org ids go on `cause`, for the log.
 * @param dekId - The DEK row asked for.
 * @param owner - The org the row belongs to.
 * @param reader - The org the read was made for.
 */
export function crossOrgRefusal(dekId: number, owner: string, reader: string): VaultDecryptionError {
  return new VaultDecryptionError(
    'This credential was sealed for a different workspace than the one reading it, so it is not '
    + 'opened here. Reconnect the credential in this workspace.',
    { cause: new Error(`source_dek ${dekId} belongs to org ${owner}; read for org ${reader}`) },
  );
}

/**
 * The DEK row a credential names, refused when it belongs to another org.
 * @param orgId - The org the read is for.
 * @param dekId - The DEK row the credential names.
 */
export async function dekRowFor(orgId: string, dekId: number): Promise<DekRow> {
  const [row] = await db
    .select({ id: sourceDekSchema.id, orgId: sourceDekSchema.orgId, wrappedDek: sourceDekSchema.wrappedDek })
    .from(sourceDekSchema)
    .where(eq(sourceDekSchema.id, dekId));
  if (!row) {
    throw new Error(`source_dek row ${dekId} not found`);
  }
  if (row.orgId !== orgId) {
    throw crossOrgRefusal(dekId, row.orgId, orgId);
  }
  return row;
}
