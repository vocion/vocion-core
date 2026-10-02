/**
 * One-time move of existing OAuth logins into the workspace credential store
 * (#1080).
 *
 * A login used to live only in `source_credential`, on the connector's
 * `source_install`. A new login is now an `api_token` row (`obtained_via =
 * 'login'`) that every source of the connector points at. This moves the old
 * ones across. It cannot be a SQL migration: the bag is encrypted under the
 * org's key, so moving it is decrypt-then-seal in application code.
 *
 * Why this is its own module and not part of `ConnectorCredentialBackfill`:
 * that backfill moves pasted keys, validates them against the platform's
 * fields, and deliberately skips OAuth bags. A login bag is the provider's
 * own shape and is read with the provider's `summarize`, so the two share
 * nothing but the idea.
 *
 * Deliberate choices:
 *   - The old `source_credential` row is left in place and live. A bad move is
 *     undone by clearing `api_token_id`, with nothing to recover.
 *   - Only sources with no credential link are linked, and always with
 *     `apiTokenExclusive: false`. A source the person put on a pasted key is
 *     never touched.
 *   - A bag the provider cannot read is reported, not guessed at.
 *
 * Idempotent: the login row is rotated in place when the account matches, and
 * a linked source is no longer a candidate, so a second run moves nothing.
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import type { CredentialPlatform } from '@/libs/platforms/registry';
import type { SealedLoginValues } from '@/services/ApiTokenService';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { providerForConnector } from '@/libs/connect/registry';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { holdsManyCredentials, platformForConnectorSlug } from '@/libs/platforms/registry';
import { apiTokenSchema, knowledgeSourceSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
import { sealLoginValues, storeLoginCredential } from '@/services/ApiTokenService';
import { sourceIsOfConnector } from './connectorSources';

export type MovedLogin = { orgId: string; connector: string; tokenId: string; linkedSourceIds: number[] };
export type SkippedLogin = { orgId: string; connector: string; why: string };
export type MoveLoginsReport = { moved: MovedLogin[]; skipped: SkippedLogin[] };

type InstallToMove = { orgId: string; connector: string };
type MoveOutcome = { moved: MovedLogin | null; skipped: SkippedLogin | null };
type LiveCredential = { ciphertext: string; nonce: string; authTag: string; dekId: number; displayName: string };

/** Every enabled install whose connector can be logged in to with a click. */
async function installsWithLogin(): Promise<InstallToMove[]> {
  const installs = await db
    .select({ orgId: sourceInstallSchema.orgId, connector: sourceInstallSchema.sourceSlug })
    .from(sourceInstallSchema)
    .where(eq(sourceInstallSchema.disabled, 'false'))
    .orderBy(asc(sourceInstallSchema.id));
  return installs.filter(install => providerForConnector(install.connector) !== null);
}

/**
 * The newest live credential of the install, the one the sync pipeline reads.
 * @param install - Which org and connector.
 */
async function newestLiveCredential(install: InstallToMove): Promise<LiveCredential | null> {
  const [row] = await db
    .select({
      ciphertext: sourceCredentialSchema.ciphertext,
      nonce: sourceCredentialSchema.nonce,
      authTag: sourceCredentialSchema.authTag,
      dekId: sourceCredentialSchema.dekId,
      displayName: sourceCredentialSchema.displayName,
    })
    .from(sourceCredentialSchema)
    .innerJoin(sourceInstallSchema, eq(sourceInstallSchema.id, sourceCredentialSchema.installId))
    .where(and(
      eq(sourceInstallSchema.orgId, install.orgId),
      eq(sourceInstallSchema.sourceSlug, install.connector),
      isNull(sourceCredentialSchema.revokedAt),
    ))
    .orderBy(desc(sourceCredentialSchema.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Open the stored bag. Null when it will not decrypt or is not a JSON object:
 * a vault-key problem, reported by the caller and not repaired here.
 * @param orgId - The org whose key sealed it.
 * @param credential - The stored row.
 */
async function openBag(orgId: string, credential: LiveCredential): Promise<Record<string, unknown> | null> {
  try {
    const plaintext = await buildCredentialVault().decrypt(orgId, credential.ciphertext, credential.nonce, credential.authTag, credential.dekId);
    const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Store the login row and link the connector's unlinked sources to it, in one
 * transaction so a failed link leaves no stray row.
 * @param tx - The transaction.
 * @param input - What to write.
 * @param input.install - Which org and connector.
 * @param input.platform - The credential platform of the connector.
 * @param input.account - The account the login is on.
 * @param input.displayName - The old row's name, kept for the new row.
 * @param input.bag - The login bag.
 * @param input.sealed - The bag, sealed before the transaction opened.
 */
async function writeMove(
  tx: DbTransaction,
  input: { install: InstallToMove; platform: CredentialPlatform; account: string; displayName: string; bag: Record<string, unknown>; sealed: SealedLoginValues },
): Promise<MovedLogin> {
  const { orgId, connector } = input.install;
  const stored = await storeLoginCredential({
    orgId,
    platform: input.platform.id,
    name: input.displayName,
    account: input.account,
    values: input.bag,
    sealed: input.sealed,
    createdBy: 'system',
    tx,
  });
  const unlinked = await tx
    .select({ id: knowledgeSourceSchema.id })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), sourceIsOfConnector(connector), isNull(knowledgeSourceSchema.apiTokenId)))
    .orderBy(asc(knowledgeSourceSchema.id));
  const linkedSourceIds = unlinked.map(source => source.id);
  if (linkedSourceIds.length > 0) {
    await tx
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: stored.id, apiTokenExclusive: false })
      .where(and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.id, linkedSourceIds)));
  }
  return { orgId, connector, tokenId: stored.id, linkedSourceIds };
}

/**
 * The outcome for an install that was left as it was.
 * @param install - Which org and connector.
 * @param why - A short reason, never a credential value.
 */
function skippedInstall(install: InstallToMove, why: string): MoveOutcome {
  return { moved: null, skipped: { ...install, why } };
}

/**
 * Whether storing this login would revoke a row the person holds. A one-live
 * platform keeps one live row, so storing a login revokes any other: a pasted
 * key, or a login on a different account. Sources on that row would end up on a
 * revoked token, so the move leaves the install alone instead. The same
 * account's own login is rotated in place and revokes nothing.
 * @param orgId - The workspace.
 * @param platform - The connector's credential platform.
 * @param account - The account of the login about to be stored.
 */
async function wouldRevokeAnotherKey(orgId: string, platform: CredentialPlatform, account: string): Promise<boolean> {
  if (holdsManyCredentials(platform.id)) {
    return false;
  }
  const live = await db
    .select({ obtainedVia: apiTokenSchema.obtainedVia, account: apiTokenSchema.account })
    .from(apiTokenSchema)
    .where(and(eq(apiTokenSchema.orgId, orgId), eq(apiTokenSchema.platform, platform.id), isNull(apiTokenSchema.revokedAt)));
  return live.some(row => row.obtainedVia !== 'login' || row.account !== account);
}

/**
 * Move one install's login, turning any failure into a skip that names the org
 * and the error's name or code, never its message (a message can carry a value).
 * @param install - Which org and connector.
 */
async function moveOne(install: InstallToMove): Promise<MoveOutcome> {
  try {
    return await moveOneInstall(install);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const label = typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown';
    return skippedInstall(install, `move failed: ${label}`);
  }
}

/**
 * Move one install's login across, or say why it was left.
 * @param install - Which org and connector.
 */
async function moveOneInstall(install: InstallToMove): Promise<MoveOutcome> {
  const provider = providerForConnector(install.connector);
  const platform = platformForConnectorSlug(install.connector);
  if (!provider || !platform) {
    return skippedInstall(install, 'no connect provider or credential platform');
  }
  const credential = await newestLiveCredential(install);
  if (!credential) {
    return skippedInstall(install, 'no live credential to move');
  }
  const bag = await openBag(install.orgId, credential);
  if (!bag) {
    return skippedInstall(install, 'existing credential could not be decrypted');
  }
  const account = provider.summarize(bag)?.account;
  if (!account) {
    return skippedInstall(install, 'credential is not a login the provider can read');
  }
  if (await wouldRevokeAnotherKey(install.orgId, platform, account)) {
    return skippedInstall(install, 'a pasted key is already live for this one-live platform');
  }
  // Sealed first: the vault reads the org's key through the pool, which must not wait on the transaction.
  const sealed = await sealLoginValues(install.orgId, bag);
  const moved = await db.transaction(tx => writeMove(tx, { install, platform, account, displayName: credential.displayName, bag, sealed }));
  // A re-run finds the login row already there and every source already linked: nothing moved.
  return { moved: moved.linkedSourceIds.length > 0 ? moved : null, skipped: null };
}

/**
 * Move every workspace's existing GitHub, Atlassian and Slack logins into the
 * credential store and link their sources to it. Never revokes the old row.
 */
export async function moveLoginsToCredentialStore(): Promise<MoveLoginsReport> {
  const report: MoveLoginsReport = { moved: [], skipped: [] };
  for (const install of await installsWithLogin()) {
    const outcome = await moveOne(install);
    if (outcome.moved) {
      report.moved.push(outcome.moved);
    }
    if (outcome.skipped) {
      report.skipped.push(outcome.skipped);
    }
  }
  return report;
}
