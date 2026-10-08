/**
 * ApiTokenService — an org's API credentials, in both directions.
 *
 * **Inbound (`platform: 'vocion'`).** An app (FirstHQ) or a client integration
 * authenticates with a Bearer token `vcn_live_<id>_<secret>`. A verified token
 * resolves to an **authz Principal**, so every mutation a token makes routes
 * through the same permission model + review queue as everything else
 * (platform-plan §5).
 *
 * A minted token is stored twice over: the SHA-256 of its secret half, which is
 * what `verifyToken` compares against on every request, and the whole token
 * encrypted under the org's DEK, which is what lets the dashboard show it again
 * later. The hash is kept so the hot authentication path stays one comparison
 * with no decryption in it. Storing the ciphertext is a deliberate tradeoff:
 * a token is now only as strong as the DEK protecting it, in exchange for an
 * admin being able to read their own token back instead of having to revoke and
 * re-issue it — the same bargain the supplied third-party keys already make.
 * Tokens issued before this existed have no ciphertext and stay unreadable.
 *
 * **Outbound (every other platform).** The org supplies a key for a third party
 * — OpenAI, Anthropic, Azure — and Vocion stores it encrypted under the same
 * per-org DEK that protects `source_credential`. Model calls for that org then
 * run on the org's own account instead of the server's env key.
 *
 * The two never cross, and both directions are held by an explicit rule rather
 * than by the shape of the data. `verifyToken` refuses any row that is not
 * `vocion`, so a stored OpenAI key cannot be replayed as a Vocion credential.
 * `resolvePlatformCredential` refuses any row that *is* `vocion`, so a minted
 * token can never be handed to a provider — it no longer suffices that a minted
 * row has nothing to decrypt, because now it does. Underneath both, the
 * `api_token_platform_immutable_tg` trigger stops a written row changing which
 * kind it is.
 */

import type { DbTransaction } from '@/libs/DbTransaction';
import type { CredentialPlatformId, CredentialValues } from '@/libs/platforms/registry';
import type { Principal, WorkspaceRole } from '@/services/authz';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { DEFAULT_PLATFORM_ID, getPlatform, hintField, holdsManyCredentials, isCredentialPlatformId, keyHint, validatePlatformCredential } from '@/libs/platforms/registry';
import { apiTokenSchema } from '@/models/Schema';
import { normalizeWorkspaceRole } from '@/services/authz';
import { RUN_TOKEN_PREFIX } from '@/services/runners/runToken';

const PREFIX = 'vcn_live';

/**
 * The field name a revealed Vocion token comes back under.
 *
 * Supplied credentials are stored as a document keyed by the platform's field
 * names, and a minted token uses the same shape with a single entry so that one
 * decrypt path, one ciphertext column set and one dashboard component serve
 * both kinds of credential.
 */
export const MINTED_TOKEN_FIELD = 'token';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export type IssuedToken = { token: string; id: string };

/**
 * Issue a token. Returns the plaintext, and also keeps it: the secret's SHA-256
 * for verification and the whole token encrypted under the org's DEK so an
 * admin can read it back from the dashboard later.
 *
 * Encrypting means issuing a token now depends on the vault, and in production
 * that means KMS. A KMS outage therefore blocks new tokens being minted, which
 * it did not before. Deliberate: a token nobody can read back is worth less
 * than one that waits for the vault, and the failure is loud rather than a
 * silently unreadable row. Verifying an existing token is untouched and still
 * runs without the vault.
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
  const token = `${PREFIX}_${id}_${secret}`;

  // The whole token, not just the secret half, because that is what someone
  // copies out of the dashboard and pastes into an integration.
  const vault = buildCredentialVault();
  const { ciphertext, nonce, authTag, dekId } = await vault.encrypt(
    input.orgId,
    Buffer.from(JSON.stringify({ [MINTED_TOKEN_FIELD]: token }), 'utf8'),
  );

  await db.insert(apiTokenSchema).values({
    id,
    orgId: input.orgId,
    name: input.name,
    platform: DEFAULT_PLATFORM_ID,
    secretHash: sha256(secret),
    dekId,
    ciphertext,
    nonce,
    authTag,
    keyHint: keyHint(token),
    role: input.role ?? 'admin',
    grants: input.grants ?? [],
    createdBy: input.createdBy ?? null,
    expiresAt: input.expiresAt ?? null,
  });
  return { token, id };
}

export type TokenIdentity = { orgId: string; tokenId: string; principal: Principal };

/**
 * Verify a raw token string → its identity (+ authz principal), or null.
 * @param raw
 */
export async function verifyToken(raw: string): Promise<TokenIdentity | null> {
  // A run token (services/runners/runToken.ts) is never a general credential: it authenticates
  // only the calls of its own run, and only through `authApi`, which has the request to check that
  // against (`services/runners/runTokenAccess.ts`). Everything that comes through here instead
  // (the MCP server, the write API's bearer path, OAuth revoke) refuses it.
  if (raw.startsWith(RUN_TOKEN_PREFIX)) {
    return null;
  }
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
    role: normalizeWorkspaceRole(row.role),
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
 * Revoke every live credential an org holds for one platform, in one
 * statement, and return the ids it revoked (none when there were none).
 *
 * One statement rather than a read and then a revoke per row, so two revokes
 * racing each other cannot both report the same row, and a save landing
 * between a read and a revoke cannot survive it.
 * @param orgId - The org whose credentials to revoke.
 * @param platform - Which platform's credentials to revoke.
 */
export async function revokeLivePlatformCredentials(orgId: string, platform: CredentialPlatformId): Promise<string[]> {
  const revoked = await db
    .update(apiTokenSchema)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.platform, platform),
      isNull(apiTokenSchema.revokedAt),
    ))
    .returning({ id: apiTokenSchema.id });
  return revoked.map(row => row.id);
}

/**
 * One row of the credential list — metadata only. Never the Vocion secret, its
 * hash, or a supplied key's plaintext or ciphertext. `keyHint` is the only
 * trace of a credential's value that leaves the service.
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
  /** Pasted by a person, or granted by a provider login (#1080). */
  obtainedVia: 'paste' | 'login';
  /** The identity a login belongs to (a GitHub org, a Slack team); null on a paste. */
  account: string | null;
  /**
   * Whether this row still holds something the reveal route can decrypt.
   *
   * False for a Vocion token issued before minted tokens were kept encrypted:
   * only its hash was ever stored, so the dashboard must not offer a show
   * button that could never produce anything. Also false for a login: its
   * tokens are the provider's grant, never shown on screen.
   */
  revealable: boolean;
};

/**
 * List an org's credentials, newest first.
 *
 * Revoked rows are left out unless asked for. Replacing a key on a platform
 * capped at one live credential revokes the old row rather than deleting it,
 * so the history grows by one dead row on every rotation; showing all of them
 * by default turns the page into a changelog of keys nobody can use. Expired
 * rows are still listed, because an expiry is a thing an admin may want to
 * notice and act on rather than a decision already taken.
 * @param orgId - The org whose credentials to list.
 * @param options - Listing options.
 * @param options.includeRevoked - True to list revoked rows as well, for the
 * audit view behind the dashboard's "show revoked" toggle.
 */
export async function listTokens(
  orgId: string,
  options: { includeRevoked?: boolean } = {},
): Promise<TokenSummary[]> {
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
      obtainedVia: apiTokenSchema.obtainedVia,
      account: apiTokenSchema.account,
      // Asked as a boolean rather than by selecting the ciphertext, so no part
      // of an encrypted credential travels with a list that is only metadata.
      revealable: sql<boolean>`(${apiTokenSchema.ciphertext} is not null and ${apiTokenSchema.obtainedVia} <> 'login')`.mapWith(Boolean),
    })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      options.includeRevoked ? undefined : isNull(apiTokenSchema.revokedAt),
    ))
    // `id` breaks the tie: two keys stored inside the same millisecond share a
    // `created_at`, and without a second sort key Postgres may return them in
    // either order — so a rotated key could list above its replacement, and a
    // test asserting that order fails at random.
    .orderBy(desc(apiTokenSchema.createdAt), desc(apiTokenSchema.id));
}

/* ------------------------------------------------------------------ */
/* Supplied third-party keys (OpenAI, Anthropic, …)                    */
/* ------------------------------------------------------------------ */

/** What the caller gets back after storing a supplied key. Never the key. */
export type StoredPlatformKey = { id: string; keyHint: string };

/**
 * Insert a supplied key's row, first revoking the platform's live key when the
 * platform holds only one. Runs in the caller's transaction so the revoke and
 * the insert land together.
 * @param tx - The transaction to write in.
 * @param row - The `api_token` row to insert.
 * @param revokeLiveKeys - Whether the platform allows one live key, so the old one goes first.
 */
async function writeKeyRow(tx: DbTransaction, row: typeof apiTokenSchema.$inferInsert & { orgId: string; platform: string }, revokeLiveKeys: boolean): Promise<void> {
  if (revokeLiveKeys) {
    // Clear the way for the partial unique index. Revoking rather than
    // deleting keeps the audit trail of which keys this org has held.
    await tx
      .update(apiTokenSchema)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(apiTokenSchema.orgId, row.orgId),
        eq(apiTokenSchema.platform, row.platform),
        isNull(apiTokenSchema.revokedAt),
      ));
  }
  await tx.insert(apiTokenSchema).values(row);
}

/** A supplied key, validated and encrypted, ready to insert. Holds no plaintext. */
export type SealedPlatformKey = {
  encrypted: { ciphertext: string; nonce: string; authTag: string; dekId: number };
  hint: string;
};

/**
 * Validate and encrypt a supplied key without writing it. Split from the
 * insert so a caller with an open transaction can seal first: sealing reads
 * the org's DEK through the pool, which must not wait on that transaction.
 * @param input - The key to seal.
 * @param input.orgId - The org the credential belongs to.
 * @param input.platform - Which platform the key belongs to.
 * @param input.apiKey - Single-secret platforms: the key as the person pasted it.
 * @param input.values - Multi-field platforms: every field, keyed by field name.
 */
export async function sealPlatformKey(input: {
  orgId: string;
  platform: CredentialPlatformId;
  apiKey?: string;
  values?: CredentialValues;
}): Promise<SealedPlatformKey> {
  const platform = getPlatform(input.platform);
  const soleField = platform.fields[0];
  const supplied = input.values
    ?? (soleField ? { [soleField.name]: input.apiKey ?? '' } : {});

  // Throws with a message written for the person filling the form, and never
  // echoes a value back.
  const values = validatePlatformCredential(input.platform, supplied);

  const vault = buildCredentialVault();
  const encrypted = await vault.encrypt(
    input.orgId,
    // Stored as a JSON document so a platform can carry more than one value —
    // AWS needs an access key id alongside its secret. Single-secret platforms
    // are just a one-entry document.
    Buffer.from(JSON.stringify(values), 'utf8'),
  );
  const hintOf = hintField(platform);
  return { encrypted, hint: hintOf ? keyHint(values[hintOf.name] ?? '') : '…' };
}

/**
 * Insert a sealed key in the caller's transaction. See {@link storePlatformKey}
 * for what a second save means per platform.
 * @param tx - The transaction to write in.
 * @param input - The key's row.
 * @param input.orgId - The org the credential belongs to.
 * @param input.name - Human label for the credential.
 * @param input.platform - Which platform the key belongs to.
 * @param input.sealed - The key, from {@link sealPlatformKey}.
 * @param input.createdBy - User id of whoever saved it.
 * @param input.expiresAt - When the key stops being used; null for no expiry.
 */
export async function insertSealedPlatformKey(tx: DbTransaction, input: {
  orgId: string;
  name: string;
  platform: CredentialPlatformId;
  sealed: SealedPlatformKey;
  createdBy?: string;
  expiresAt?: Date | null;
}): Promise<StoredPlatformKey> {
  const { ciphertext, nonce, authTag, dekId } = input.sealed.encrypted;
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  await writeKeyRow(tx, {
    id,
    orgId: input.orgId,
    name: input.name,
    platform: input.platform,
    secretHash: null,
    dekId,
    ciphertext,
    nonce,
    authTag,
    keyHint: input.sealed.hint,
    createdBy: input.createdBy ?? null,
    expiresAt: input.expiresAt ?? null,
  }, !holdsManyCredentials(input.platform));
  return { id, keyHint: input.sealed.hint };
}

/**
 * Encrypt and store a key the org supplied for a third-party platform.
 *
 * What a second save means depends on the platform's `credentialsPerOrg`:
 *
 *   - `one-live` (every LLM platform, `aws`, `custom`). Only one live key per
 *     platform per org is allowed, enforced by
 *     `api_token_org_platform_live_idx`, so this revokes whatever key the
 *     platform currently holds before inserting the new one. That makes "save
 *     a key" and "rotate a key" the same action from the outside, which is
 *     what the person pasting a replacement expects.
 *   - `many` (the connector platforms). Saving adds another live credential
 *     alongside the ones already there, told apart by `name`. Nothing is
 *     revoked, because a connector install may be pointing at any of them and
 *     "add a second Strapi token" is a different intention from "replace this
 *     one". Replacing one in place is {@link rotatePlatformCredential}, which
 *     keeps the row id so installs pointing at it need no edit.
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
  const sealed = await sealPlatformKey(input);
  return db.transaction(tx => insertSealedPlatformKey(tx, { ...input, sealed }));
}

/** The hint a login shows when its bag holds no token string (a GitHub App installation: tokens are minted per request). */
export const LOGIN_WITHOUT_TOKEN_HINT = 'login';

/**
 * The token string a login's bag holds, or null when it holds none. A GitHub
 * App installation keeps only the installation id: its tokens are minted on
 * each request, so there is nothing to show or copy.
 * @param values - The provider's credential bag.
 */
export function loginTokenOf(values: Record<string, unknown>): string | null {
  const shown = [values.token, values.accessToken].find(value => typeof value === 'string' && value !== '');
  return typeof shown === 'string' ? shown : null;
}

/**
 * The masked tail to show beside a login: the last characters of its `token`
 * or `accessToken` when it has one, else the word `login`.
 * @param values - The provider's credential bag.
 */
function loginKeyHint(values: Record<string, unknown>): string {
  const token = loginTokenOf(values);
  return token === null ? LOGIN_WITHOUT_TOKEN_HINT : keyHint(token);
}

/** What storing a login did, so the caller can repoint what used the old rows. */
export type StoredLogin = { id: string; replacedIds: string[]; rotated: boolean };

/**
 * The write half of {@link storeLoginCredential}, run inside one transaction.
 * @param tx - The transaction to write in.
 * @param input - What the caller asked to store.
 * @param encrypted - The bag, already sealed under the org's DEK.
 * @param encrypted.ciphertext
 * @param encrypted.nonce
 * @param encrypted.authTag
 * @param encrypted.dekId
 * @param hint - Masked tail to show beside the row.
 */
async function writeLoginRow(
  tx: DbTransaction,
  input: StoreLoginInput,
  encrypted: { ciphertext: string; nonce: string; authTag: string; dekId: number },
  hint: string,
): Promise<StoredLogin> {
  const [sameAccount] = await tx
    .select({ id: apiTokenSchema.id })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.platform, input.platform),
      eq(apiTokenSchema.account, input.account),
      eq(apiTokenSchema.obtainedVia, 'login'),
      isNull(apiTokenSchema.revokedAt),
    ))
    .limit(1);
  if (sameAccount) {
    // A re-login: the same account keeps its row, so anything pointing at the
    // id keeps working with the fresh grant.
    await tx
      .update(apiTokenSchema)
      .set({ ...encrypted, keyHint: hint, name: input.name })
      .where(eq(apiTokenSchema.id, sameAccount.id));
    return { id: sameAccount.id, replacedIds: [], rotated: true };
  }

  let replacedIds: string[] = [];
  if (!holdsManyCredentials(input.platform)) {
    // Clear the way for the partial unique index, as `storePlatformKey` does.
    // Revoked, not deleted, to keep the history of what the org held.
    const revoked = await tx
      .update(apiTokenSchema)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(apiTokenSchema.orgId, input.orgId),
        eq(apiTokenSchema.platform, input.platform),
        isNull(apiTokenSchema.revokedAt),
      ))
      .returning({ id: apiTokenSchema.id });
    replacedIds = revoked.map(row => row.id);
  }
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  await tx.insert(apiTokenSchema).values({
    id,
    orgId: input.orgId,
    name: input.name,
    platform: input.platform,
    secretHash: null,
    ...encrypted,
    keyHint: hint,
    obtainedVia: 'login',
    account: input.account,
    createdBy: input.createdBy,
  });
  return { id, replacedIds, rotated: false };
}

type StoreLoginInput = {
  orgId: string;
  platform: CredentialPlatformId;
  name: string;
  account: string;
  values: Record<string, unknown>;
  createdBy: string;
  tx?: DbTransaction;
  /**
   * The bag already sealed by `sealLoginValues`. A caller that holds a
   * transaction open seals first: sealing reads the org's DEK through the
   * pool, and doing that mid-transaction waits on a connection the
   * transaction may be holding.
   */
  sealed?: SealedLoginValues;
};

/** A login bag encrypted under the org's DEK, with its masked hint. */
export type SealedLoginValues = {
  encrypted: { ciphertext: string; nonce: string; authTag: string; dekId: number };
  hint: string;
};

/**
 * Encrypt a login bag ahead of `storeLoginCredential`, so the write itself can
 * run inside a larger transaction without touching the vault.
 * @param orgId - The org whose DEK seals it.
 * @param values - The provider's whole bag.
 */
export async function sealLoginValues(orgId: string, values: Record<string, unknown>): Promise<SealedLoginValues> {
  const encrypted = await buildCredentialVault().encrypt(orgId, Buffer.from(JSON.stringify(values), 'utf8'));
  return { encrypted, hint: loginKeyHint(values) };
}

/**
 * Store a provider login's credential bag (#1080).
 *
 * - Same platform and account already live (re-login): rotate that row's values in place, keep its id.
 * - One-live platform with another live row: revoke it and insert; its id is in `replacedIds`.
 * - Otherwise: insert.
 *
 * One transaction (the caller's, when `tx` is given). Never validates against
 * the platform's `fields`: a login bag is the provider's, not a paste.
 * @param input - The login to store.
 * @param input.account - The non-secret identity it belongs to, e.g. a Slack team name.
 * @param input.values - The provider's whole bag (tokens, installation id, ...).
 * @param input.sealed - The bag already sealed, when the caller holds a transaction.
 */
export async function storeLoginCredential(input: StoreLoginInput): Promise<StoredLogin> {
  const { encrypted, hint } = input.sealed ?? await sealLoginValues(input.orgId, input.values);
  if (input.tx) {
    return writeLoginRow(input.tx, input, encrypted, hint);
  }
  return db.transaction(tx => writeLoginRow(tx, input, encrypted, hint));
}

/**
 * Write a refreshed login bag back to the same row.
 *
 * Compare-and-swap, mirroring `updateCredentialValuesForConnector`: writes only
 * while the stored bag's `refreshToken` still equals `expectedRefreshToken`,
 * and the write itself insists the ciphertext is still the one that was read,
 * so two refreshes racing cannot both win.
 *
 * Returns false when the row is gone, revoked, not a login, or the swap lost.
 * @param input - Which row, the new bag, and the token it was refreshed from.
 * @param input.orgId
 * @param input.tokenId
 * @param input.values
 * @param input.expectedRefreshToken
 */
export async function updateLoginCredentialValues(input: {
  orgId: string;
  tokenId: string;
  values: Record<string, unknown>;
  expectedRefreshToken: string;
}): Promise<boolean> {
  const [row] = await db
    .select({
      dekId: apiTokenSchema.dekId,
      ciphertext: apiTokenSchema.ciphertext,
      nonce: apiTokenSchema.nonce,
      authTag: apiTokenSchema.authTag,
    })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.tokenId),
      eq(apiTokenSchema.obtainedVia, 'login'),
      isNull(apiTokenSchema.revokedAt),
    ))
    .limit(1);
  if (!row || !row.ciphertext || !row.nonce || !row.authTag || row.dekId === null) {
    return false;
  }
  const vault = buildCredentialVault();
  const stored = JSON.parse(
    (await vault.decrypt(input.orgId, row.ciphertext, row.nonce, row.authTag, row.dekId)).toString('utf8'),
  ) as { refreshToken?: unknown };
  if (stored.refreshToken !== input.expectedRefreshToken) {
    return false;
  }
  const encrypted = await vault.encrypt(input.orgId, Buffer.from(JSON.stringify(input.values), 'utf8'));
  const written = await db
    .update(apiTokenSchema)
    // Saving the new token ends the refresh, so it also lifts the claim.
    .set({ ...encrypted, keyHint: loginKeyHint(input.values), refreshingUntil: null })
    .where(and(
      eq(apiTokenSchema.id, input.tokenId),
      eq(apiTokenSchema.ciphertext, row.ciphertext),
      isNull(apiTokenSchema.revokedAt),
    ))
    .returning({ id: apiTokenSchema.id });
  return written.length === 1;
}

/** What `claimLoginRefresh` found: this caller's claim, someone else's, or no live login. */
export type LoginRefreshClaim = { kind: 'claimed'; until: Date } | { kind: 'held' } | { kind: 'gone' };

/**
 * Claim the right to refresh a login, so a second caller waits for the new
 * token instead of spending the same refresh token. One conditional UPDATE:
 * it marks the row only when no unexpired claim is on it, so of two callers
 * arriving together exactly one gets the row back.
 *
 * The claim runs out after `holdMs` on its own, so a caller that crashes
 * mid-refresh never blocks the login for longer than that. Saving the
 * refreshed token (`updateLoginCredentialValues`) lifts it; a refresh that
 * fails lifts it with `releaseLoginRefresh`.
 *
 * Returns `claimed` with the claim's end time, the handle for releasing it;
 * `held` when another caller holds an unexpired claim; or `gone` when the
 * login was revoked or removed, so a waiting caller stops at once instead of
 * waiting out a claim that will never come.
 * @param input - Which login, and how long the claim may last.
 * @param input.orgId - The workspace.
 * @param input.tokenId - The login's `api_token` row.
 * @param input.holdMs - How long before the claim runs out by itself.
 */
export async function claimLoginRefresh(input: { orgId: string; tokenId: string; holdMs: number }): Promise<LoginRefreshClaim> {
  const now = new Date();
  const until = new Date(now.getTime() + input.holdMs);
  const claimed = await db
    .update(apiTokenSchema)
    .set({ refreshingUntil: until })
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.tokenId),
      eq(apiTokenSchema.obtainedVia, 'login'),
      isNull(apiTokenSchema.revokedAt),
      or(isNull(apiTokenSchema.refreshingUntil), lt(apiTokenSchema.refreshingUntil, now)),
    ))
    .returning({ id: apiTokenSchema.id });
  if (claimed.length === 1) {
    return { kind: 'claimed', until };
  }
  const [row] = await db
    .select({ revokedAt: apiTokenSchema.revokedAt, obtainedVia: apiTokenSchema.obtainedVia })
    .from(apiTokenSchema)
    .where(and(eq(apiTokenSchema.orgId, input.orgId), eq(apiTokenSchema.id, input.tokenId)))
    .limit(1);
  return row && !row.revokedAt && row.obtainedVia === 'login' ? { kind: 'held' } : { kind: 'gone' };
}

/**
 * Lift a refresh claim after a refresh that saved nothing (the vendor refused
 * or did not answer), so the next caller can try at once. Matches on the
 * claim's own end time, so a caller whose claim already ran out never lifts
 * the claim someone else took since.
 * @param input - Which login, and the end time `claimLoginRefresh` returned.
 * @param input.orgId - The workspace.
 * @param input.tokenId - The login's `api_token` row.
 * @param input.claimedUntil - The claim's end time.
 */
export async function releaseLoginRefresh(input: { orgId: string; tokenId: string; claimedUntil: Date }): Promise<void> {
  await db
    .update(apiTokenSchema)
    .set({ refreshingUntil: null })
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.tokenId),
      eq(apiTokenSchema.refreshingUntil, input.claimedUntil),
    ));
}

/**
 * One live credential an org holds for a platform, as a picker sees it.
 *
 * Metadata only. Telling two credentials for the same platform apart is what
 * `name` is for on a connector platform, and the masked `keyHint` is there to
 * confirm which key was pasted — neither requires opening the ciphertext, so
 * listing credentials never touches the vault.
 */
export type PlatformCredentialSummary = {
  id: string;
  name: string;
  keyHint: string | null;
  createdAt: Date;
  expiresAt: Date | null;
};

/**
 * The credentials an org currently holds for one platform, newest first.
 *
 * Live rows only — a revoked credential is not something to offer a connector.
 * An expired one is included, with its `expiresAt`, because the person setting
 * up a connector is better served by seeing the key they meant to use marked
 * expired than by it silently not being on the list.
 *
 * Empty for `vocion`: those are inbound API tokens and there is no connector
 * they could authenticate.
 * @param orgId - The org whose credentials to list.
 * @param platform - Which platform's credentials are wanted.
 */
export async function listPlatformCredentials(
  orgId: string,
  platform: CredentialPlatformId,
): Promise<PlatformCredentialSummary[]> {
  if (getPlatform(platform).keySource !== 'supplied') {
    return [];
  }
  return db
    .select({
      id: apiTokenSchema.id,
      name: apiTokenSchema.name,
      keyHint: apiTokenSchema.keyHint,
      createdAt: apiTokenSchema.createdAt,
      expiresAt: apiTokenSchema.expiresAt,
    })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.platform, platform),
      isNull(apiTokenSchema.revokedAt),
    ))
    // `id` breaks the tie: two keys stored inside the same millisecond share a
    // `created_at`, and without a second sort key Postgres may return them in
    // either order — so a rotated key could list above its replacement, and a
    // test asserting that order fails at random.
    .orderBy(desc(apiTokenSchema.createdAt), desc(apiTokenSchema.id));
}

/**
 * The answer to resolving one named credential for use.
 *
 * A union rather than `null` because the reasons a credential cannot be used
 * are not interchangeable to whoever has to fix it. "Someone revoked the key
 * this connector points at" is a sentence a person can act on; "sync failed"
 * is the silent failure this whole shape exists to avoid.
 */
export type ResolvedCredential
  = | { status: 'ok'; values: CredentialValues }
  /** No credential with that id belongs to this org. */
    | { status: 'not-found' }
  /** The credential was retired. Point the caller at a live one. */
    | { status: 'revoked' }
  /** The credential is past its expiry date. */
    | { status: 'expired' }
  /**
   * The row is a Vocion-minted API token, not a key the org supplied for a
   * third party. It authenticates callers *into* Vocion and must never be
   * handed out to one.
   */
    | { status: 'minted' };

/**
 * Decrypt one stored credential, named by id, so a caller can use it.
 *
 * This is the resolution path for the platforms an org may hold several
 * credentials for — a connector install names the credential it wants rather
 * than relying on there being exactly one. {@link resolvePlatformCredential}
 * is the other path, for the platforms where exactly one live row is the rule.
 *
 * Decryption failure throws, matching the rest of the service: a ciphertext
 * that will not open means the DEK and the data have diverged, and that is
 * worth surfacing rather than reporting as one more kind of "cannot use it".
 * @param orgId - The org the caller is acting in. Rows outside it are invisible.
 * @param tokenId - The credential row to open.
 */
export async function resolveCredentialById(
  orgId: string,
  tokenId: string,
): Promise<ResolvedCredential> {
  const [row] = await db
    .select({
      platform: apiTokenSchema.platform,
      dekId: apiTokenSchema.dekId,
      ciphertext: apiTokenSchema.ciphertext,
      nonce: apiTokenSchema.nonce,
      authTag: apiTokenSchema.authTag,
      revokedAt: apiTokenSchema.revokedAt,
      expiresAt: apiTokenSchema.expiresAt,
    })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.id, tokenId),
    ))
    .limit(1);

  if (!row) {
    return { status: 'not-found' };
  }
  if (row.platform === DEFAULT_PLATFORM_ID) {
    return { status: 'minted' };
  }
  if (row.revokedAt) {
    return { status: 'revoked' };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { status: 'expired' };
  }
  if (!row.ciphertext || !row.nonce || !row.authTag || row.dekId === null) {
    // The shape constraint makes this unreachable for a supplied key, so it is
    // a half-written row rather than a case to handle. Reported as not-found
    // because there is genuinely nothing to hand back.
    return { status: 'not-found' };
  }

  await stampLastUsed(orgId, tokenId);

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, row.ciphertext, row.nonce, row.authTag, row.dekId);
  return { status: 'ok', values: JSON.parse(plaintext.toString('utf8')) as CredentialValues };
}

/** How stale `last_used_at` may get before a resolve writes it again. */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

/**
 * Record that a credential was just used, at most once an hour.
 *
 * One conditional UPDATE: it matches only a row never stamped or stamped more
 * than an hour ago, so a hot path that resolves the same credential on every
 * call writes once an hour instead of every time.
 * @param orgId - The org that owns the row.
 * @param tokenId - The credential that was just resolved.
 */
async function stampLastUsed(orgId: string, tokenId: string): Promise<void> {
  const now = new Date();
  await db
    .update(apiTokenSchema)
    .set({ lastUsedAt: now })
    .where(and(
      eq(apiTokenSchema.orgId, orgId),
      eq(apiTokenSchema.id, tokenId),
      or(
        isNull(apiTokenSchema.lastUsedAt),
        lt(apiTokenSchema.lastUsedAt, new Date(now.getTime() - LAST_USED_REFRESH_MS)),
      ),
    ));
}

/** The answer to rotating one named credential. */
export type RotatedCredential
  = | { status: 'ok'; keyHint: string }
    | { status: 'not-found' }
  /** The credential was retired; rotating it would quietly bring it back. */
    | { status: 'revoked' };

/**
 * Replace the values of one stored credential, keeping its row id.
 *
 * This is rotation for the platforms an org may hold several credentials for.
 * The id has to survive, because `source_install.api_token_id` points at it:
 * rotating in place is what makes the next sync use the new key with no
 * connector-side edit, which is the whole reason a connector stopped keeping
 * its own copy.
 *
 * Only for `credentialsPerOrg: 'many'` platforms. A `one-live` platform rotates
 * through {@link storePlatformKey}, which revokes the old row and inserts a new
 * one — nothing points at those rows by id, and the revoked row is a better
 * audit trail than an overwritten one. Calling this for such a platform is a
 * bug, so it throws rather than quietly doing the other thing.
 *
 * The plaintext never reaches the database and is never returned.
 * @param input - The rotation to perform.
 * @param input.orgId - The org the credential belongs to.
 * @param input.tokenId - The credential row to rewrite.
 * @param input.values - Every field of the new credential, keyed by field name.
 * @param input.expiresAt - New expiry, or null to clear it. Omit to leave it alone.
 */
export async function rotatePlatformCredential(input: {
  orgId: string;
  tokenId: string;
  values: CredentialValues;
  expiresAt?: Date | null;
}): Promise<RotatedCredential> {
  const [row] = await db
    .select({ platform: apiTokenSchema.platform, revokedAt: apiTokenSchema.revokedAt })
    .from(apiTokenSchema)
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.tokenId),
    ))
    .limit(1);

  if (!row) {
    return { status: 'not-found' };
  }
  if (!isCredentialPlatformId(row.platform) || !holdsManyCredentials(row.platform)) {
    throw new Error(
      `rotatePlatformCredential is only for platforms an org may hold several credentials for; ${row.platform} holds one. Use storePlatformKey.`,
    );
  }
  if (row.revokedAt) {
    return { status: 'revoked' };
  }

  const platform = getPlatform(row.platform);
  // Throws with a message written for the person filling the form, and never
  // echoes a value back.
  const values = validatePlatformCredential(row.platform, input.values);

  const vault = buildCredentialVault();
  const { ciphertext, nonce, authTag, dekId } = await vault.encrypt(
    input.orgId,
    Buffer.from(JSON.stringify(values), 'utf8'),
  );
  const hintOf = hintField(platform);
  const hint = hintOf ? keyHint(values[hintOf.name] ?? '') : '…';

  await db
    .update(apiTokenSchema)
    .set({
      dekId,
      ciphertext,
      nonce,
      authTag,
      keyHint: hint,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    })
    .where(and(
      eq(apiTokenSchema.orgId, input.orgId),
      eq(apiTokenSchema.id, input.tokenId),
    ));

  return { status: 'ok', keyHint: hint };
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
  return (await spendablePlatformKey(orgId, platform))?.key ?? null;
}

/** A key the next call could actually spend, with the mask that stands for it. */
export type SpendablePlatformKey = {
  key: string;
  /** Masked tail, safe for a settings surface to print. */
  keyHint: string;
};

/**
 * The org's key for `platform` when there is one a call could spend, or null.
 *
 * One definition of "spendable", because there are two questions about the
 * same key and they used to be answered by different code: the call path asked
 * "give me the key", a settings page asked "does a row exist", and the two
 * could disagree. The row is only half the answer — the document behind it has
 * to still carry a value under the field name the registry uses today, which a
 * renamed field quietly ends. A page that decides readiness on its own would
 * then show a green badge over a key that no call can use, and nothing would
 * say so.
 *
 * So a caller that only needs to know *whether* asks this too, and throws the
 * key away. That costs the decrypt a readiness check used to avoid, which is
 * the price of the badge being true; the secret never leaves this function
 * unless the caller takes it.
 *
 * Multi-field platforms are refused rather than answered with their first
 * field, which on AWS is an access key id — an identifier that authenticates
 * nothing. Those callers want the whole document, from
 * {@link resolvePlatformCredential}.
 * @param orgId - The org whose key to resolve.
 * @param platform - Which platform's key is wanted.
 */
export async function spendablePlatformKey(
  orgId: string,
  platform: CredentialPlatformId,
): Promise<SpendablePlatformKey | null> {
  const descriptor = getPlatform(platform);
  const soleField = descriptor.fields[0];
  if (!soleField || descriptor.fields.length > 1) {
    return null;
  }
  const values = await resolvePlatformCredential(orgId, platform);
  const key = values?.[soleField.name];
  if (!key) {
    return null;
  }
  return { key, keyHint: keyHint(key) };
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
  if (holdsManyCredentials(platform)) {
    // An org may hold several live credentials here, so "the org's Strapi key"
    // has no single answer and picking one would be a guess. Loud rather than
    // null: every caller that reaches this has a row id available and should
    // be using `resolveCredentialById` with it.
    throw new Error(
      `${platform} credentials are named by id, not resolved per org; use resolveCredentialById.`,
    );
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
  /**
   * A `vocion` row issued before minted tokens were kept encrypted. Only the
   * SHA-256 was ever stored, so there is nothing left to open.
   */
    | { status: 'minted' };

/**
 * Decrypt one stored credential so an admin can read it back on screen — a
 * supplied third-party key, or a Vocion token the org was issued.
 *
 * This is the only path in the service that hands a stored credential back to a
 * person, so it is deliberately narrow: a single row, named by id, scoped to
 * the caller's org.
 *
 * A revoked or expired row still opens. Revoking stops Vocion using a key; it
 * does not erase the key, which still exists at the vendor and is still the
 * thing an admin has to go and rotate there. Refusing to show it would hide a
 * secret the org already owns from the only people who can retire it.
 *
 * A `vocion` row opens like any other, because a minted token is now stored
 * encrypted alongside its hash. The one exception is a token issued before that
 * was true: it holds a hash and no ciphertext, so there is genuinely nothing to
 * decrypt and the answer is `'minted'`.
 *
 * Decryption failure throws, matching {@link resolvePlatformCredential} — a
 * ciphertext that will not open means the DEK and the data have diverged, and
 * that is worth surfacing rather than reporting as "no key here".
 * @param orgId - The org the caller is acting in. Rows outside it are invisible.
 * @param tokenId - The credential row to open.
 * @param options - `includeLogin` also opens a provider login's bag; off by default.
 * @param options.includeLogin
 */
export async function revealPlatformCredential(
  orgId: string,
  tokenId: string,
  options: { includeLogin?: boolean } = {},
): Promise<RevealedCredential> {
  const [row] = await db
    .select({
      platform: apiTokenSchema.platform,
      dekId: apiTokenSchema.dekId,
      ciphertext: apiTokenSchema.ciphertext,
      nonce: apiTokenSchema.nonce,
      authTag: apiTokenSchema.authTag,
      obtainedVia: apiTokenSchema.obtainedVia,
    })
    .from(apiTokenSchema)
    .where(and(eq(apiTokenSchema.orgId, orgId), eq(apiTokenSchema.id, tokenId)))
    .limit(1);

  if (!row) {
    return { status: 'not-found' };
  }
  if (row.obtainedVia === 'login' && !options.includeLogin) {
    // A login's tokens are the provider's grant to Vocion, not a key the org
    // holds. Answered like a missing row so the API-credentials screen never
    // shows one. Only the Connectors form asks for a login's token on purpose
    // (`includeLogin`), through an admin-only, audited route.
    return { status: 'not-found' };
  }
  if (!row.ciphertext || !row.nonce || !row.authTag || row.dekId === null) {
    // A Vocion token issued before minted tokens were stored encrypted. Its
    // plaintext is genuinely gone, which is a different sentence on screen from
    // a failure, so it gets its own status rather than an error.
    if (row.platform === DEFAULT_PLATFORM_ID) {
      return { status: 'minted' };
    }
    // For a supplied key the `api_token_shape_ck` constraint is supposed to
    // make this impossible, so reaching it means a row was written around the
    // schema. Log it and answer the caller the same way a missing row would.
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
