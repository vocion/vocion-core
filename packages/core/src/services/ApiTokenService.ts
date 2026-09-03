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

import type { CredentialPlatformId, CredentialValues } from '@/libs/platforms/registry';
import type { Principal, WorkspaceRole } from '@/services/authz';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { DEFAULT_PLATFORM_ID, getPlatform, hintField, holdsManyCredentials, isCredentialPlatformId, keyHint, validatePlatformCredential } from '@/libs/platforms/registry';
import { apiTokenSchema } from '@/models/Schema';

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
    role: input.role ?? 'owner',
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
  /**
   * Whether this row still holds something the reveal route can decrypt.
   *
   * False for a Vocion token issued before minted tokens were kept encrypted:
   * only its hash was ever stored, so the dashboard must not offer a show
   * button that could never produce anything.
   */
  revealable: boolean;
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
      // Asked as a boolean rather than by selecting the ciphertext, so no part
      // of an encrypted credential travels with a list that is only metadata.
      revealable: sql<boolean>`(${apiTokenSchema.ciphertext} is not null)`.mapWith(Boolean),
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
  const replacesPreviousKey = !holdsManyCredentials(input.platform);
  await db.transaction(async (tx) => {
    if (replacesPreviousKey) {
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
    }
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
    .orderBy(desc(apiTokenSchema.createdAt));
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

  const vault = buildCredentialVault();
  const plaintext = await vault.decrypt(orgId, row.ciphertext, row.nonce, row.authTag, row.dekId);
  return { status: 'ok', values: JSON.parse(plaintext.toString('utf8')) as CredentialValues };
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
