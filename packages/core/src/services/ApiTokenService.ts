/**
 * ApiTokenService — an org's API credentials, in both directions.
 *
 * **Inbound (`platform: 'vocion'`).** An app (FirstHQ) or a client integration
 * authenticates with a Bearer token `vcn_live_<id>_<secret>`. We store only the
 * SHA-256 of the secret; the plaintext is shown once, at issue. A verified
 * token resolves to an **authz Principal**, so every mutation a token makes
 * routes through the same permission model + review queue as everything else
 * (platform-plan §5).
 *
 * **Outbound (every other platform).** The org supplies a key for a third party
 * — OpenAI, Anthropic, Azure — and Vocion stores it encrypted under the same
 * per-org DEK that protects `source_credential`. Model calls for that org then
 * run on the org's own account instead of the server's env key.
 *
 * The two never cross. `verifyToken` refuses any row that is not `vocion`, so a
 * stored OpenAI key cannot be replayed as a Vocion credential; and a Vocion row
 * has no ciphertext to decrypt, so it can never be handed to a provider.
 */

import type { CredentialPlatformId, CredentialValues } from '@/libs/platforms/registry';
import type { Principal, WorkspaceRole } from '@/services/authz';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { DEFAULT_PLATFORM_ID, getPlatform, hintField, keyHint, validatePlatformCredential } from '@/libs/platforms/registry';
import { apiTokenSchema } from '@/models/Schema';

const PREFIX = 'vcn_live';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export type IssuedToken = { token: string; id: string };

/**
 * Issue a token. Returns the plaintext ONCE — only the hash is stored.
 * @param input
 * @param input.orgId
 * @param input.name
 * @param input.createdBy
 * @param input.role
 * @param input.grants
 * @param input.expiresAt - When the token stops working; omit or pass null for
 * a token that never expires.
 */
export async function issueToken(input: {
  orgId: string;
  name: string;
  createdBy?: string;
  role?: WorkspaceRole;
  grants?: string[];
  expiresAt?: Date | null;
}): Promise<IssuedToken> {
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const secret = randomBytes(24).toString('hex'); // hex → no '_', safe to split
  await db.insert(apiTokenSchema).values({
    id,
    orgId: input.orgId,
    name: input.name,
    platform: DEFAULT_PLATFORM_ID,
    secretHash: sha256(secret),
    role: input.role ?? 'owner',
    grants: input.grants ?? [],
    createdBy: input.createdBy ?? null,
    expiresAt: input.expiresAt ?? null,
  });
  return { token: `${PREFIX}_${id}_${secret}`, id };
}

export type TokenIdentity = { orgId: string; tokenId: string; principal: Principal };

/**
 * Verify a raw token string → its identity (+ authz principal), or null.
 * @param raw
 */
export async function verifyToken(raw: string): Promise<TokenIdentity | null> {
  const parts = raw.split('_');
  // vcn _ live _ <id> _ <secret>
  if (parts.length !== 4 || `${parts[0]}_${parts[1]}` !== PREFIX) {
    return null;
  }
  const id = parts[2]!;
  const secret = parts[3]!;
  const [row] = await db.select().from(apiTokenSchema).where(eq(apiTokenSchema.id, id)).limit(1);
  if (!row || row.revokedAt) {
    return null;
  }
  // Only a Vocion-minted row can authenticate into Vocion. A stored
  // third-party key lives in this same table, and refusing it here — rather
  // than relying on the hash comparison to fail — is what stops a leaked
  // OpenAI key from ever being probed against our own auth path.
  if (row.platform !== DEFAULT_PLATFORM_ID || !row.secretHash) {
    return null;
  }
  // An expired token is refused exactly like a revoked one, and the row stays
  // put so the dashboard can still show what expired and when.
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  if (sha256(secret) !== row.secretHash) {
    return null;
  }
  await db.update(apiTokenSchema).set({ lastUsedAt: new Date() }).where(eq(apiTokenSchema.id, id));
  const principal: Principal = {
    kind: 'user',
    id: `token:${id}`,
    role: row.role as WorkspaceRole,
    scope: { orgId: row.orgId },
    grants: row.grants,
  };
  return { orgId: row.orgId, tokenId: id, principal };
}

/**
 * Authenticate an `Authorization: Bearer …` header for the write API.
 * @param authHeader
 */
export async function authenticateBearer(authHeader: string | null | undefined): Promise<TokenIdentity | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return verifyToken(authHeader.slice('Bearer '.length).trim());
}

export async function revokeToken(orgId: string, id: string): Promise<void> {
  await db
    .update(apiTokenSchema)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokenSchema.orgId, orgId), eq(apiTokenSchema.id, id)));
}

/**
 * One row of the credential list — metadata only. Never the Vocion secret, its
 * hash, or a supplied key's plaintext or ciphertext. `keyHint` is the only
 * trace of a supplied key that leaves the service.
 */
export type TokenSummary = {
  id: string;
  name: string;
  platform: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  keyHint: string | null;
};

/**
 * List an org's credentials, newest first. Revoked and expired rows are
 * included so the dashboard can show a credential's whole history, not just
 * live ones.
 * @param orgId
 */
export async function listTokens(orgId: string): Promise<TokenSummary[]> {
  return db
    .select({
      id: apiTokenSchema.id,
      name: apiTokenSchema.name,
      platform: apiTokenSchema.platform,
      createdAt: apiTokenSchema.createdAt,
      lastUsedAt: apiTokenSchema.lastUsedAt,
      revokedAt: apiTokenSchema.revokedAt,
      expiresAt: apiTokenSchema.expiresAt,
      keyHint: apiTokenSchema.keyHint,
    })
    .from(apiTokenSchema)
    .where(eq(apiTokenSchema.orgId, orgId))
    .orderBy(desc(apiTokenSchema.createdAt));
}

/* ------------------------------------------------------------------ */
/* Supplied third-party keys (OpenAI, Anthropic, …)                    */
/* ------------------------------------------------------------------ */

/** What the caller gets back after storing a supplied key. Never the key. */
export type StoredPlatformKey = { id: string; keyHint: string };

/**
 * Encrypt and store a key the org supplied for a third-party platform.
 *
 * Only one live key per platform per org is allowed (enforced by
 * `api_token_org_platform_live_idx`), so this revokes whatever key the platform
 * currently holds before inserting the new one. That makes "save a key" and
 * "rotate a key" the same action from the outside, which is what the person
 * pasting a replacement expects.
 *
 * The plaintext never reaches the database and is never returned.
 * @param input - The credential to store.
 * @param input.orgId - The org the credential belongs to.
 * @param input.name - Human label for the credential, e.g. "Acme OpenAI".
 * @param input.platform - Which platform the key belongs to.
 * @param input.apiKey - Single-secret platforms: the key as the person pasted it.
 * @param input.values - Multi-field platforms: every field, keyed by field name.
 * @param input.createdBy - User id of whoever saved it, for the audit trail.
 * @param input.expiresAt - When the key stops being used; null for no expiry.
 */
export async function storePlatformKey(input: {
  orgId: string;
  name: string;
  platform: CredentialPlatformId;
  /** Single-secret platforms. Mutually exclusive with `values`. */
  apiKey?: string;
  /** Multi-field platforms (AWS). Mutually exclusive with `apiKey`. */
  values?: CredentialValues;
  createdBy?: string;
  expiresAt?: Date | null;
}): Promise<StoredPlatformKey> {
  const platform = getPlatform(input.platform);
  const soleField = platform.fields[0];
  const supplied = input.values
    ?? (soleField ? { [soleField.name]: input.apiKey ?? '' } : {});

  // Throws with a message written for the person filling the form, and never
  // echoes a value back.
  const values = validatePlatformCredential(input.platform, supplied);

  const vault = buildCredentialVault();
  const { ciphertext, nonce, authTag, dekId } = await vault.encrypt(
    input.orgId,
    // Stored as a JSON document so a platform can carry more than one value —
    // AWS needs an access key id alongside its secret. Single-secret platforms
    // are just a one-entry document.
    Buffer.from(JSON.stringify(values), 'utf8'),
  );
  const hintOf = hintField(platform);
  const hint = hintOf ? keyHint(values[hintOf.name] ?? '') : '…';

  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  await db.transaction(async (tx) => {
    // Clear the way for the partial unique index. Revoking rather than
    // deleting keeps the audit trail of which keys this org has held.
    await tx
      .update(apiTokenSchema)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(apiTokenSchema.orgId, input.orgId),
        eq(apiTokenSchema.platform, input.platform),
        isNull(apiTokenSchema.revokedAt),
      ));
    await tx.insert(apiTokenSchema).values({
      id,
      orgId: input.orgId,
      name: input.name,
      platform: input.platform,
      secretHash: null,
      dekId,
      ciphertext,
      nonce,
      authTag,
      keyHint: hint,
      createdBy: input.createdBy ?? null,
      expiresAt: input.expiresAt ?? null,
    });
  });

  return { id, keyHint: hint };
}

/**
 * Decrypt the org's live key for `platform`, or null when it has none.
 *
 * Returns null — rather than throwing — for every "no key here" case, because
 * every caller's next move is the same: fall back to the server's own key. A
 * revoked or expired row counts as no key.
 *
 * Decryption failure is the one case that does throw. A row whose ciphertext
 * will not open means the DEK and the data have diverged, and silently falling
 * back to the server key would bill us for a customer who thinks they are
 * paying their own bill.
 * @param orgId - The org whose key to resolve.
 * @param platform - Which platform's key is wanted.
 */
export async function resolvePlatformKey(
  orgId: string,
  platform: CredentialPlatformId,
): Promise<string | null> {
  const descriptor = getPlatform(platform);
  const soleField = descriptor.fields[0];
  if (!soleField) {
    return null;
  }
  const values = await resolvePlatformCredential(orgId, platform);
  return values?.[soleField.name] ?? null;
}

/**
 * Decrypt the org's live credential document for `platform`, or null when it
 * has none. The multi-field form of {@link resolvePlatformKey}.
 *
 * Returns null — rather than throwing — for every "no credential here" case,
 * because every caller's next move is the same. A revoked or expired row counts
 * as none.
 *
 * Decryption failure is the one case that does throw. A row whose ciphertext
 * will not open means the DEK and the data have diverged, and silently falling
 * back would use the wrong account without saying so.
 * @param orgId - The org whose credential to resolve.
 * @param platform - Which platform's credential is wanted.
 */
export async function resolvePlatformCredential(
  orgId: string,
  platform: CredentialPlatformId,
): Promise<CredentialValues | null> {
  if (getPlatform(platform).keySource !== 'supplied') {
    return null;
  }
  const [row] = await db
    .select({
      dekId: apiTokenSchema.dekId,
      ciphertext: apiTokenSchema.ciphertext,
      nonce: apiTokenSchema.nonce,
      authTag: apiTokenSchema.authTag,
      expiresAt: apiTokenSchema.expiresAt,
    })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.platform, platform),
      isNull(apiTokenSchema.revokedAt),
      ne(apiTokenSchema.platform, DEFAULT_PLATFORM_ID),
    ))
    .limit(1);

  if (!row?.ciphertext || !row.nonce || !row.authTag || row.dekId === null) {
    return null;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, row.ciphertext, row.nonce, row.authTag, row.dekId);
  return JSON.parse(plaintext.toString('utf8')) as CredentialValues;
}

/**
 * The answer to a reveal request: the decrypted values, or the reason there is
 * nothing to hand back.
 *
 * A union rather than `null` because the two refusals are not interchangeable
 * to the person who clicked the button. "This credential is a Vocion token, so
 * its plaintext no longer exists anywhere" and "no such row" call for different
 * sentences on screen, and neither is an error the caller did something wrong
 * to cause.
 */
export type RevealedCredential
  = | { status: 'ok'; values: CredentialValues }
  /** No row with that id belongs to this org. */
    | { status: 'not-found' }
  /** A `vocion` row. Only the SHA-256 was ever stored, so nothing can open it. */
    | { status: 'minted' };

/**
 * Decrypt one supplied credential so an admin can read it back on screen.
 *
 * This is the only path in the service that hands a stored third-party key to
 * a person, so it is deliberately narrow: a single row, named by id, scoped to
 * the caller's org.
 *
 * A revoked or expired row still opens. Revoking stops Vocion using a key; it
 * does not erase the key, which still exists at the vendor and is still the
 * thing an admin has to go and rotate there. Refusing to show it would hide a
 * secret the org already owns from the only people who can retire it.
 *
 * A `vocion` row can never be revealed here, and not because of a rule we
 * chose: those rows hold a SHA-256 of the secret and no ciphertext at all, so
 * there is genuinely nothing to decrypt.
 *
 * Decryption failure throws, matching {@link resolvePlatformCredential} — a
 * ciphertext that will not open means the DEK and the data have diverged, and
 * that is worth surfacing rather than reporting as "no key here".
 * @param orgId - The org the caller is acting in. Rows outside it are invisible.
 * @param tokenId - The credential row to open.
 */
export async function revealPlatformCredential(
  orgId: string,
  tokenId: string,
): Promise<RevealedCredential> {
  const [row] = await db
    .select({
      platform: apiTokenSchema.platform,
      dekId: apiTokenSchema.dekId,
      ciphertext: apiTokenSchema.ciphertext,
      nonce: apiTokenSchema.nonce,
      authTag: apiTokenSchema.authTag,
    })
    .from(apiTokenSchema)
    .where(and(eq(apiTokenSchema.orgId, orgId), eq(apiTokenSchema.id, tokenId)))
    .limit(1);

  if (!row) {
    return { status: 'not-found' };
  }
  if (row.platform === DEFAULT_PLATFORM_ID) {
    return { status: 'minted' };
  }
  if (!row.ciphertext || !row.nonce || !row.authTag || row.dekId === null) {
    // The `api_token_shape_ck` constraint is supposed to make this impossible,
    // so reaching it means a row was written around the schema. Log it and
    // answer the caller the same way a missing row would.
    console.error('[ApiTokenService.revealPlatformCredential] supplied row has no ciphertext', {
      tokenId,
      platform: row.platform,
    });
    return { status: 'not-found' };
  }

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, row.ciphertext, row.nonce, row.authTag, row.dekId);
  return { status: 'ok', values: JSON.parse(plaintext.toString('utf8')) as CredentialValues };
}

/** An IAM access key pair, as AWS SDK clients expect it. */
export type AwsCredentials = { accessKeyId: string; secretAccessKey: string };

/**
 * The org's stored AWS credentials, or null when it has none.
 *
 * **AWS deliberately does not get the automatic env fallback the model
 * providers get**, and `allowServerFallback` defaults to false.
 *
 * For OpenAI or Anthropic, falling back to the server key means we pay the
 * model bill — a cost surprise, nothing more. AWS is different in kind: the
 * server's own AWS identity is the platform account. It holds the KMS key that
 * wraps every tenant's DEK, the AgentCore runtime, the deployment role. A
 * tenant-scoped operation that quietly fell back to it would run against our
 * account with our permissions while looking like it ran as the customer —
 * which is a privilege escalation, not a billing surprise.
 *
 * A call site that genuinely wants the platform identity when a tenant has
 * supplied none can pass `allowServerFallback: true` and say so out loud. What
 * must never happen is the vault itself reading a tenant's stored AWS key:
 * unwrapping the DEK is what decrypts that key in the first place.
 * @param orgId - The org whose AWS credentials to resolve.
 * @param options - Resolution options.
 * @param options.allowServerFallback - Fall back to the process's own AWS
 * credentials when the org has stored none. Off by default, on purpose.
 */
export async function resolveAwsCredentials(
  orgId: string,
  options: { allowServerFallback?: boolean } = {},
): Promise<AwsCredentials | null> {
  const values = await resolvePlatformCredential(orgId, 'aws');
  if (values?.accessKeyId && values.secretAccessKey) {
    return { accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey };
  }
  if (!options.allowServerFallback) {
    return null;
  }
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return { accessKeyId, secretAccessKey };
}
