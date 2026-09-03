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
 * A connector's credentials come from one of two places, and the connector row
 * says which:
 *
 *   - `knowledge_source.api_token_id` set — an API-key connector (Jira,
 *     Strapi, HubSpot, Granola) pointing at a credential the workspace stores
 *     under API credentials. One value, typed once, rotated in one place.
 *
 *     The link is per connector rather than per install, because a workspace
 *     runs several connectors of one kind and they point at different places
 *     when it does — a Strapi against staging and another against production.
 *     Each names its own credential.
 *
 *     One credential, one connector: two connectors may never name the same
 *     one. A credential is issued for the instance or account its connector
 *     talks to, so a second connector naming it is somebody having picked the
 *     wrong row, and revoking it would then take down a connector nobody was
 *     looking at. A partial unique index on `knowledge_source.api_token_id`
 *     is what actually holds the rule.
 *   - otherwise — `source_credential`, where every OAuth grant lives. A grant
 *     is issued to one installation and carries a refresh token, so there is
 *     nothing to share and nothing to point at.
 */

import { Buffer } from 'node:buffer';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { apiTokenSchema, knowledgeSourceSchema, sourceCredentialSchema, sourceInstallSchema } from '@/models/Schema';
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
 * A credential another connector already uses.
 *
 * Its own type because the route shows this message to whoever picked it, and
 * "that credential is already in use" is the whole explanation — unlike a
 * constraint violation, which says the same thing in words nobody can act on.
 */
export class CredentialInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialInUseError';
  }
}

/**
 * Point one connector at a credential the workspace already holds.
 *
 * This is the "pick a stored credential" half of connector setup — the half
 * that means a Jira key already saved under API credentials does not have to be
 * pasted a second time.
 *
 * Scoped to the single connector named by `sourceId`, so a workspace running a
 * staging Strapi and a production one can point each at its own credential.
 *
 * Refuses a credential belonging to a different platform. A HubSpot token
 * cannot authenticate Jira, and a mismatch here would surface as an
 * unexplainable 401 at the next sync instead of an error at the moment someone
 * chose the wrong thing.
 *
 * Refuses a credential another connector already uses, too. A key is issued
 * for the one instance or account its connector talks to, so a second
 * connector naming it is a mis-pick — and revoking it later would take down a
 * connector nobody was looking at.
 * @param input - The connector and the credential to link.
 * @param input.orgId - The org both belong to.
 * @param input.sourceId - The `knowledge_source` row to point at the credential.
 * @param input.connectorSlug - Which connector that row runs, e.g. `strapi`.
 * @param input.apiTokenId - The stored credential row to point at.
 */
export async function linkSourceToStoredCredential(input: {
  orgId: string;
  sourceId: number;
  connectorSlug: string;
  apiTokenId: string;
}): Promise<void> {
  const platform = platformForConnectorSlug(input.connectorSlug);
  if (!platform) {
    throw new Error(`${input.connectorSlug} does not authenticate with a stored API credential`);
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

  // Checked before writing so the refusal can name the connector holding it.
  // The unique index is still the rule — two people picking the same
  // credential at once get past this check, and one of the two writes then
  // fails, which the catch below turns into the same message.
  const [heldBy] = await db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, input.orgId),
      eq(knowledgeSourceSchema.apiTokenId, input.apiTokenId),
    ))
    .limit(1);
  if (heldBy && heldBy.id !== input.sourceId) {
    throw new CredentialInUseError(
      `The ${heldBy.slug} connector already uses that credential. Store a separate one for this connector.`,
    );
  }

  let linked: { id: number }[];
  try {
    linked = await db
      .update(knowledgeSourceSchema)
      .set({ apiTokenId: input.apiTokenId })
      .where(and(
        eq(knowledgeSourceSchema.orgId, input.orgId),
        eq(knowledgeSourceSchema.id, input.sourceId),
      ))
      .returning({ id: knowledgeSourceSchema.id });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Two people picked the same credential at the same time. The index
    // refused the second write, which is the rule doing its job.
    console.error('[linkSourceToStoredCredential] a concurrent link claimed the credential first', {
      sourceId: input.sourceId,
      connectorSlug: input.connectorSlug,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new CredentialInUseError(
      'Another connector just claimed that credential. Store a separate one for this connector.',
    );
  }
  if (linked.length === 0) {
    throw new Error(`connector ${input.sourceId} not found for org ${input.orgId}`);
  }
}

/**
 * Whether a database error is a unique-constraint violation.
 *
 * Postgres says so with SQLSTATE 23505, which every driver in use here passes
 * through on the error object as `code`.
 * @param error - Whatever the query threw.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}

/**
 * The stored credentials this org's connectors already use, so setup can offer
 * only the ones still free.
 *
 * Offering a credential another connector holds would put a choice in front of
 * somebody that the link then refuses — worse than not offering it at all.
 * @param orgId - The org whose connectors to read.
 * @param exceptSourceId - A connector to leave out, so its own credential still shows as its current pick.
 */
export async function credentialIdsInUse(
  orgId: string,
  exceptSourceId?: number,
): Promise<string[]> {
  const rows = await db
    .select({ sourceId: knowledgeSourceSchema.id, apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      isNotNull(knowledgeSourceSchema.apiTokenId),
    ));
  const inUse: string[] = [];
  for (const row of rows) {
    if (row.apiTokenId !== null && row.sourceId !== exceptSourceId) {
      inUse.push(row.apiTokenId);
    }
  }
  return inUse;
}

/**
 * The stored credential one connector points at, or null when it points at
 * none — an OAuth connector, one needing no auth, or an API-key connector
 * nobody has connected yet.
 * @param orgId - The org that owns the connector.
 * @param sourceId - The `knowledge_source` row to read.
 */
export async function storedCredentialIdForSource(
  orgId: string,
  sourceId: number,
): Promise<string | null> {
  const [source] = await db
    .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      eq(knowledgeSourceSchema.id, sourceId),
    ))
    .limit(1);
  return source?.apiTokenId ?? null;
}

/**
 * Whether a connector has a live credential, when it was set, and — when it
 * has one that cannot be used — why not.
 *
 * `broken` is the case worth naming. A connector pointing at a credential
 * somebody revoked is not the same as one nobody has connected yet: one needs
 * a key, the other needs the key it already names put back in service, and
 * offering "Connect" for the second hides what actually happened.
 */
export type CredentialStatus = {
  connected: boolean;
  updatedAt: string | null;
  broken: BrokenCredentialReason | null;
};

/**
 * Connection status for one org, in the two shapes the connectors page needs.
 *
 * Two maps rather than one, because the two kinds of credential are not
 * addressed the same way. An OAuth grant belongs to the org's single install of
 * a connector, so its status is the same for every connector row of that kind.
 * A stored API credential is named by one connector row, so two Strapi
 * connectors can be connected, revoked or untouched independently and only a
 * per-row answer can say so.
 */
export type OrgCredentialStatus = {
  /** Keyed by connector slug — OAuth grants, and anything still on its own copy. */
  byConnectorSlug: Record<string, CredentialStatus>;
  /** Keyed by `knowledge_source.id` — connectors naming a stored credential. */
  bySourceId: Record<number, CredentialStatus>;
};

/**
 * Connection status for an org's connectors — drives the "Connected / Needs
 * credentials" badge in the connectors UI without decrypting anything.
 *
 * A connector row naming a stored API credential is answered from that
 * credential's own row: live, revoked, or expired. Everything else is answered
 * from `source_credential` against the install, as before.
 * @param orgId - The org to report on.
 */
export async function credentialStatusForOrg(orgId: string): Promise<OrgCredentialStatus> {
  const byConnectorSlug: Record<string, CredentialStatus> = {};
  const bySourceId: Record<number, CredentialStatus> = {};

  const installs = await db
    .select({
      slug: sourceInstallSchema.sourceSlug,
      createdAt: sourceCredentialSchema.createdAt,
      revokedAt: sourceCredentialSchema.revokedAt,
    })
    .from(sourceInstallSchema)
    .leftJoin(sourceCredentialSchema, eq(sourceCredentialSchema.installId, sourceInstallSchema.id))
    .where(eq(sourceInstallSchema.orgId, orgId));

  for (const install of installs) {
    const live = !!install.createdAt && !install.revokedAt;
    const previous = byConnectorSlug[install.slug];
    // One install can have several credential rows over its life. A live one
    // wins over a revoked one, so a reconnected connector reads as connected.
    if (!previous || (live && !previous.connected)) {
      byConnectorSlug[install.slug] = {
        connected: live,
        updatedAt: install.createdAt ? new Date(install.createdAt).toISOString() : null,
        broken: null,
      };
    }
  }

  const linked = await db
    .select({
      sourceId: knowledgeSourceSchema.id,
      updatedAt: knowledgeSourceSchema.updatedAt,
      credentialId: apiTokenSchema.id,
      revokedAt: apiTokenSchema.revokedAt,
      expiresAt: apiTokenSchema.expiresAt,
    })
    .from(knowledgeSourceSchema)
    .leftJoin(apiTokenSchema, eq(apiTokenSchema.id, knowledgeSourceSchema.apiTokenId))
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      isNotNull(knowledgeSourceSchema.apiTokenId),
    ));

  for (const source of linked) {
    bySourceId[source.sourceId] = {
      connected: !!source.credentialId && !source.revokedAt && !isPast(source.expiresAt),
      updatedAt: source.updatedAt ? new Date(source.updatedAt).toISOString() : null,
      broken: brokenReasonFor(source),
    };
  }

  return { byConnectorSlug, bySourceId };
}

/**
 * Whether a moment has already passed. A null date never expires.
 * @param at - The moment to test, or null.
 */
function isPast(at: Date | null): boolean {
  return at !== null && at.getTime() <= Date.now();
}

/**
 * Why the credential a connector names cannot be used, or null when it can.
 * @param row - The connector row joined to the credential it points at.
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
 * The decrypted credentials one connector authenticates with, or `undefined`
 * when it has none to authenticate with (e.g. the `web` connector, which needs
 * none).
 *
 * `apiTokenId` is the connector row's link to a stored workspace credential.
 * When it is set that credential is the answer, and the copy `source_credential`
 * may still hold from before the two were joined up is not read at all. When it
 * is null the install's most recent non-revoked `source_credential` row is
 * decrypted instead, which is where every OAuth grant lives.
 * @param input - Which connector to resolve for.
 * @param input.orgId - The org that owns it.
 * @param input.connectorSlug - Connector slug, e.g. `strapi` — names the install.
 * @param input.apiTokenId - The stored credential this connector names, or null.
 */
export async function getCredentialsForConnector(input: {
  orgId: string;
  connectorSlug: string;
  apiTokenId: string | null;
}): Promise<RawCredentials | undefined> {
  if (input.apiTokenId) {
    const platformLabel = platformForConnectorSlug(input.connectorSlug)?.label ?? input.connectorSlug;
    const resolved = await resolveCredentialById(input.orgId, input.apiTokenId);
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

  const [install] = await db
    .select({ id: sourceInstallSchema.id })
    .from(sourceInstallSchema)
    .where(and(
      eq(sourceInstallSchema.orgId, input.orgId),
      eq(sourceInstallSchema.sourceSlug, input.connectorSlug),
      eq(sourceInstallSchema.disabled, 'false'),
    ))
    .limit(1);
  if (!install) {
    return undefined;
  }

  const [credential] = await db
    .select()
    .from(sourceCredentialSchema)
    .where(and(
      eq(sourceCredentialSchema.installId, install.id),
      isNull(sourceCredentialSchema.revokedAt),
    ))
    .orderBy(desc(sourceCredentialSchema.createdAt))
    .limit(1);
  if (!credential) {
    return undefined;
  }

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(
    input.orgId,
    credential.ciphertext,
    credential.nonce,
    credential.authTag,
    credential.dekId,
  );
  return JSON.parse(plaintext.toString('utf8')) as RawCredentials;
}

/**
 * The decrypted credentials for a connector named by slug, for callers holding
 * a slug and nothing else — the agent tools and the action runner.
 *
 * The connector row of that slug says which stored credential to use, if any.
 * A caller that already has the row should pass its `apiTokenId` to
 * `getCredentialsForConnector` instead and save the lookup.
 * @param orgId - The org that owns the connector.
 * @param sourceSlug - The connector row's slug, which is also its connector slug for a single install.
 */
export async function getCredentialsForSource(
  orgId: string,
  sourceSlug: string,
): Promise<RawCredentials | undefined> {
  const [source] = await db
    .select({ apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      eq(knowledgeSourceSchema.slug, sourceSlug),
    ))
    .limit(1);
  return getCredentialsForConnector({
    orgId,
    connectorSlug: sourceSlug,
    apiTokenId: source?.apiTokenId ?? null,
  });
}
