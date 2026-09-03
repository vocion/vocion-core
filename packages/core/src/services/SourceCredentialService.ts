/**
 * SourceCredentialService — the read/write bridge between the encrypted
 * credential vault and a connector's sync.
 *
 * The vault (`libs/crypto/credentialVault`) and the `source_install` /
 * `source_credential` / `source_dek` tables already exist. This service is the
 * missing link: it stores a connector's credentials encrypted-at-rest, and —
 * the part the sync pipeline needs — resolves the decrypted credentials for a
 * source at sync time so the connector can authenticate. Without it,
 * `ctx.credentials` is always empty and every OAuth/token connector refuses.
 *
 * A connector's credentials come from one of two places, and the install says
 * which:
 *
 *   - `source_install.api_token_id` set — an API-key connector (Jira, Strapi,
 *     HubSpot, Granola) pointing at a credential the workspace stores under API
 *     credentials. One value, typed once, shared by every install that wants
 *     it, and rotated in one place.
 *   - otherwise — `source_credential`, where every OAuth grant lives. A grant
 *     is issued to one installation and carries a refresh token, so there is
 *     nothing to share and nothing to point at.
 */

import { Buffer } from 'node:buffer';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { apiTokenSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
import { resolveCredentialById } from '@/services/ApiTokenService';

/** Decrypted connector credentials (e.g. `{ token, refreshToken, developerToken }`). */
export type RawCredentials = Record<string, unknown>;

/**
 * Encrypt + persist credentials for an install. Returns the new credential id.
 * The plaintext never touches the DB — only the AES-GCM ciphertext + the dek id.
 * @param input
 * @param input.orgId
 * @param input.installId
 * @param input.displayName
 * @param input.raw
 * @param input.userId
 */
export async function storeCredential(input: {
  orgId: string;
  installId: number;
  displayName: string;
  raw: RawCredentials;
  userId?: string | null;
}): Promise<number> {
  const vault = buildCredentialVault();
  const { ciphertext, nonce, authTag, dekId } = await vault.encrypt(
    input.orgId,
    Buffer.from(JSON.stringify(input.raw), 'utf8'),
  );
  const [row] = await db
    .insert(sourceCredentialSchema)
    .values({
      installId: input.installId,
      userId: input.userId ?? null,
      displayName: input.displayName,
      dekId,
      ciphertext,
      nonce,
      authTag,
    })
    .returning({ id: sourceCredentialSchema.id });
  return row!.id;
}

/**
 * Find-or-create the org-scoped `source_install` for a connector slug. Nothing
 * else creates installs (sources are added as `knowledge_source` rows), so
 * without this the credential vault has no anchor and every apikey/OAuth
 * connector refuses at sync time. Returns the install id.
 * @param orgId
 * @param sourceSlug
 * @param userId
 * @param projectId
 */
export async function ensureInstall(
  orgId: string,
  sourceSlug: string,
  userId?: string | null,
  projectId?: string | null,
): Promise<number> {
  const [existing] = await db
    .select({ id: sourceInstallSchema.id })
    .from(sourceInstallSchema)
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      eq(sourceInstallSchema.sourceSlug, sourceSlug),
    ))
    .limit(1);
  if (existing) {
    // Re-enable if it was soft-disabled; credentials outlive the toggle.
    await db
      .update(sourceInstallSchema)
      .set({ disabled: 'false' })
      .where(eq(sourceInstallSchema.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(sourceInstallSchema)
    .values({
      orgId,
      projectId: projectId ?? orgId,
      sourceSlug,
      installedBy: userId ?? 'system',
    })
    .returning({ id: sourceInstallSchema.id });
  return row!.id;
}

/**
 * The onboarding entry point: encrypt + persist credentials for a source slug,
 * creating the install if needed. This is what the Sources UI + the creds CLI
 * call — the one path that turns a pasted token into a live, decryptable
 * credential the sync pipeline can use.
 * @param input
 * @param input.orgId
 * @param input.sourceSlug
 * @param input.raw
 * @param input.displayName
 * @param input.userId
 * @param input.projectId
 */
export async function storeCredentialForSource(input: {
  orgId: string;
  sourceSlug: string;
  raw: RawCredentials;
  displayName?: string;
  userId?: string | null;
  projectId?: string | null;
}): Promise<{ installId: number; credentialId: number }> {
  const installId = await ensureInstall(input.orgId, input.sourceSlug, input.userId, input.projectId);
  const credentialId = await storeCredential({
    orgId: input.orgId,
    installId,
    displayName: input.displayName ?? `${input.sourceSlug} credential`,
    raw: input.raw,
    userId: input.userId,
  });
  return { installId, credentialId };
}

/** Why a credential an install points at cannot be used. */
export type BrokenCredentialReason = 'revoked' | 'expired' | 'missing';

/**
 * The credential an install points at exists as a reference but cannot be used.
 *
 * A distinct type because this is the failure the whole "point at a stored
 * credential" design exists to make legible. Someone revoked a key in one
 * place and three connectors stopped working; the connector has to be able to
 * say so, rather than reporting whatever 401 the vendor happened to return.
 */
export class ConnectorCredentialError extends Error {
  readonly reason: BrokenCredentialReason;

  constructor(reason: BrokenCredentialReason, message: string) {
    super(message);
    this.name = 'ConnectorCredentialError';
    this.reason = reason;
  }
}

/**
 * Sentence to show for a broken credential, written for whoever has to fix it.
 * @param reason - Why the credential cannot be used.
 * @param platformLabel - The platform it belongs to, e.g. `Strapi`.
 */
function brokenCredentialMessage(reason: BrokenCredentialReason, platformLabel: string): string {
  if (reason === 'revoked') {
    return `The ${platformLabel} credential this connector uses was revoked. Point it at a live credential, or store a new one.`;
  }
  if (reason === 'expired') {
    return `The ${platformLabel} credential this connector uses has expired. Rotate it, or point the connector at a live credential.`;
  }
  return `The ${platformLabel} credential this connector uses no longer exists. Point it at a live credential, or store a new one.`;
}

/**
 * Point an API-key connector at a credential the workspace already holds,
 * creating the install if there isn't one yet.
 *
 * This is the "pick a stored credential" half of connector setup — the half
 * that means a Jira key already saved under API credentials does not have to be
 * pasted a second time. Returns the install id.
 *
 * Refuses a credential belonging to a different platform. A HubSpot token
 * cannot authenticate Jira, and a mismatch here would surface as an
 * unexplainable 401 at the next sync instead of an error at the moment someone
 * chose the wrong thing.
 * @param input - The install and the credential to link.
 * @param input.orgId - The org both belong to.
 * @param input.sourceSlug - Connector slug, e.g. `strapi`.
 * @param input.apiTokenId - The stored credential row to point at.
 * @param input.userId - Who made the change, for the install's audit trail.
 * @param input.projectId - Project the install belongs to.
 */
export async function linkInstallToStoredCredential(input: {
  orgId: string;
  sourceSlug: string;
  apiTokenId: string;
  userId?: string | null;
  projectId?: string | null;
}): Promise<number> {
  const platform = platformForConnectorSlug(input.sourceSlug);
  if (!platform) {
    throw new Error(`${input.sourceSlug} does not authenticate with a stored API credential`);
  }

  const [credential] = await db
    .select({ platform: apiTokenSchema.platform })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.apiTokenId),
      isNull(apiTokenSchema.revokedAt),
    ))
    .limit(1);
  if (!credential) {
    throw new ConnectorCredentialError('missing', 'That credential does not exist, or has been revoked.');
  }
  if (credential.platform !== platform.id) {
    throw new Error(
      `that credential belongs to ${credential.platform}, not ${platform.id}`,
    );
  }

  const installId = await ensureInstall(input.orgId, input.sourceSlug, input.userId, input.projectId);
  await db
    .update(sourceInstallSchema)
    .set({ apiTokenId: input.apiTokenId })
    .where(eq(sourceInstallSchema.id, installId));
  return installId;
}

/**
 * Whether a source slug has a live credential, when it was set, and — when it
 * has one that cannot be used — why not.
 *
 * `broken` is the case worth naming. An install pointing at a credential
 * somebody revoked is not the same as an install nobody has connected yet:
 * one needs a key, the other needs the key it already names put back in
 * service, and offering "Connect" for the second hides what actually happened.
 */
export type CredentialStatus = {
  connected: boolean;
  updatedAt: string | null;
  broken: BrokenCredentialReason | null;
};

/**
 * Connection status for every source slug in an org — drives the "Connected /
 * Needs credentials" badge in the connectors UI without decrypting anything.
 *
 * An install that names a stored API credential is answered from that
 * credential's own row: live, revoked, or expired. Every other install is
 * answered from `source_credential` as before.
 * @param orgId
 */
export async function credentialStatusForOrg(orgId: string): Promise<Record<string, CredentialStatus>> {
  const status: Record<string, CredentialStatus> = {};

  const rows = await db
    .select({
      slug: sourceInstallSchema.sourceSlug,
      createdAt: sourceCredentialSchema.createdAt,
      revokedAt: sourceCredentialSchema.revokedAt,
    })
    .from(sourceInstallSchema)
    .leftJoin(sourceCredentialSchema, eq(sourceCredentialSchema.installId, sourceInstallSchema.id))
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      isNull(sourceInstallSchema.apiTokenId),
    ));

  for (const r of rows) {
    const live = !!r.createdAt && !r.revokedAt;
    const prev = status[r.slug];
    if (!prev || (live && !prev.connected)) {
      status[r.slug] = {
        connected: live,
        updatedAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        broken: null,
      };
    }
  }

  const linked = await db
    .select({
      slug: sourceInstallSchema.sourceSlug,
      updatedAt: sourceInstallSchema.updatedAt,
      credentialId: apiTokenSchema.id,
      revokedAt: apiTokenSchema.revokedAt,
      expiresAt: apiTokenSchema.expiresAt,
    })
    .from(sourceInstallSchema)
    .leftJoin(apiTokenSchema, eq(apiTokenSchema.id, sourceInstallSchema.apiTokenId))
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      isNotNull(sourceInstallSchema.apiTokenId),
    ));

  for (const row of linked) {
    status[row.slug] = {
      connected: !!row.credentialId && !row.revokedAt && !isPast(row.expiresAt),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      broken: brokenReasonFor(row),
    };
  }

  return status;
}

/**
 * Whether a moment has already passed. A null date never expires.
 * @param at - The moment to test, or null.
 */
function isPast(at: Date | null): boolean {
  return at !== null && at.getTime() <= Date.now();
}

/**
 * Why the credential an install names cannot be used, or null when it can.
 * @param row - The install joined to the credential it points at.
 * @param row.credentialId - Credential row id, or null when the join found none.
 * @param row.revokedAt - When the credential was revoked, if it was.
 * @param row.expiresAt - When the credential expires, if it does.
 */
function brokenReasonFor(row: {
  credentialId: string | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}): BrokenCredentialReason | null {
  if (!row.credentialId) {
    return 'missing';
  }
  if (row.revokedAt) {
    return 'revoked';
  }
  if (isPast(row.expiresAt)) {
    return 'expired';
  }
  return null;
}

/**
 * Resolve the decrypted credentials for a source in an org, or `undefined` when
 * the source has no install or no live credential (e.g. the `web` connector,
 * which needs none). Picks the most recent non-revoked credential for the
 * org-scoped install.
 * @param orgId
 * @param sourceSlug
 */
export async function getCredentialsForSource(
  orgId: string,
  sourceSlug: string,
): Promise<RawCredentials | undefined> {
  const [install] = await db
    .select({ id: sourceInstallSchema.id, apiTokenId: sourceInstallSchema.apiTokenId })
    .from(sourceInstallSchema)
    .where(and(
      eq(sourceInstallSchema.orgId, orgId),
      eq(sourceInstallSchema.sourceSlug, sourceSlug),
      eq(sourceInstallSchema.disabled, 'false'),
    ))
    .limit(1);
  if (!install) {
    return undefined;
  }

  if (install.apiTokenId) {
    // The install names a credential the workspace stores centrally, so that
    // is the value — not whatever copy `source_credential` may still hold from
    // before the two were joined up.
    const platformLabel = platformForConnectorSlug(sourceSlug)?.label ?? sourceSlug;
    const resolved = await resolveCredentialById(orgId, install.apiTokenId);
    if (resolved.status === 'ok') {
      return resolved.values;
    }
    // Every remaining case is a reference to something unusable. Thrown rather
    // than returned as "no credentials", because the connector would then fail
    // with the vendor's own 401 and nothing would say that a key was revoked.
    const reason: BrokenCredentialReason = resolved.status === 'revoked' || resolved.status === 'expired'
      ? resolved.status
      : 'missing';
    throw new ConnectorCredentialError(reason, brokenCredentialMessage(reason, platformLabel));
  }

  const [cred] = await db
    .select()
    .from(sourceCredentialSchema)
    .where(and(
      eq(sourceCredentialSchema.installId, install.id),
      isNull(sourceCredentialSchema.revokedAt),
    ))
    .orderBy(desc(sourceCredentialSchema.createdAt))
    .limit(1);
  if (!cred) {
    return undefined;
  }

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, cred.ciphertext, cred.nonce, cred.authTag, cred.dekId);
  return JSON.parse(plaintext.toString('utf8')) as RawCredentials;
}
