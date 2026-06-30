/**
 * ApiTokenService — the control-plane credential for the write API.
 *
 * An app (FirstHQ) or a client integration authenticates with a Bearer token
 * `vcn_live_<id>_<secret>`. We store only the SHA-256 of the secret; the
 * plaintext is shown once, at issue. A verified token resolves to an **authz
 * Principal**, so every mutation a token makes routes through the same
 * permission model + review queue as everything else (platform-plan §5).
 */

import type { Principal, WorkspaceRole } from '@/services/authz';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
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
 */
export async function issueToken(input: {
  orgId: string;
  name: string;
  createdBy?: string;
  role?: WorkspaceRole;
  grants?: string[];
}): Promise<IssuedToken> {
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const secret = randomBytes(24).toString('hex'); // hex → no '_', safe to split
  await db.insert(apiTokenSchema).values({
    id,
    orgId: input.orgId,
    name: input.name,
    secretHash: sha256(secret),
    role: input.role ?? 'owner',
    grants: input.grants ?? [],
    createdBy: input.createdBy ?? null,
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

export async function listTokens(orgId: string): Promise<Array<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }>> {
  return db
    .select({
      id: apiTokenSchema.id,
      name: apiTokenSchema.name,
      createdAt: apiTokenSchema.createdAt,
      lastUsedAt: apiTokenSchema.lastUsedAt,
      revokedAt: apiTokenSchema.revokedAt,
    })
    .from(apiTokenSchema)
    .where(eq(apiTokenSchema.orgId, orgId));
}
