/**
 * RUNNER TOKENS BOUND TO AN ACCOUNT (Vocion 5.1). A runner that builds one company's engineering
 * runs holds a credential that can claim that company's runs and nothing else.
 *
 * `vcn_runner_<id>_<secret>`. Only the SHA-256 of the secret is stored, the way a minted API
 * token's is, and unlike an API token it is never kept encrypted: a runner token is pasted once
 * into a runner's secrets and never read back, so there is nothing to show again. An account
 * admin mints and revokes them from Workforce › Settings › Developers (`routers/Runners.ts`); an
 * operator from a shell (`npm run runner-tokens`).
 *
 * A token is scoped to its account, and optionally to a list of that account's workspaces. The
 * scope is enforced where runs are chosen (`services/runners/claimNext.ts`), by joining the run's
 * workspace to its account, so a token cannot reach a run of another account however it asks.
 */

import { Buffer } from 'node:buffer';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, runnerTokenSchema } from '@/models/Schema';

export const RUNNER_TOKEN_PREFIX = 'vcn_runner_';

/** How fresh "last used" is kept: a write at most this often per token. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;

/** What a verified runner token may claim. `projectIds` null = every workspace of the account. */
export type RunnerTokenScope = { tokenId: string; accountId: string; projectIds: string[] | null };

export type RunnerTokenSummary = {
  id: string;
  name: string;
  keyHint: string | null;
  /** The workspaces it may claim for, with their names; null = every workspace of the account. */
  workspaces: Array<{ id: string; name: string }> | null;
  createdBy: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

/** A runner token problem a person can act on; the message names no secret. */
export class RunnerTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerTokenError';
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Mint a runner token for an account. The plaintext is returned here and nowhere else.
 * @param input - What to mint.
 * @param input.accountId - The account whose runs it claims.
 * @param input.name - What to call it (which runner holds it).
 * @param input.projectIds - Narrow it to these workspaces of the account; omit or null for all.
 * @param input.createdBy - Who minted it, for the audit (a user id, or `cli:<who>`).
 * @param input.expiresAt - When it stops working; null for never.
 */
export async function mintRunnerToken(input: { accountId: string; name: string; projectIds?: string[] | null; createdBy?: string | null; expiresAt?: Date | null }): Promise<{ id: string; token: string }> {
  const name = input.name.trim();
  if (!name) {
    throw new RunnerTokenError('Give the runner token a name, so its row says which runner holds it.');
  }
  let projectIds: string[] | null = null;
  // An empty list is a mistake, never "every workspace": that is null, said on purpose.
  if (input.projectIds && input.projectIds.length === 0) {
    throw new RunnerTokenError('Name at least one workspace, or choose every workspace of the account.');
  }
  if (input.projectIds) {
    const wanted = [...new Set(input.projectIds)];
    const owned = await db.select({ id: projectSchema.id }).from(projectSchema).where(and(eq(projectSchema.accountId, input.accountId), inArray(projectSchema.id, wanted)));
    const ownedIds = new Set(owned.map(p => p.id));
    const foreign = wanted.filter(id => !ownedIds.has(id));
    if (foreign.length > 0) {
      throw new RunnerTokenError(`A runner token can only name this account's own workspaces; ${foreign.length === 1 ? 'one of them is' : `${foreign.length} of them are`} not.`);
    }
    projectIds = wanted;
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new RunnerTokenError('The expiry must be in the future.');
  }
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const secret = randomBytes(32).toString('hex');
  const token = `${RUNNER_TOKEN_PREFIX}${id}_${secret}`;
  await db.insert(runnerTokenSchema).values({
    id,
    accountId: input.accountId,
    name: name.slice(0, 80),
    secretHash: sha256(secret),
    keyHint: `…${secret.slice(-4)}`,
    projectIds,
    createdBy: input.createdBy ?? null,
    expiresAt: input.expiresAt ?? null,
  });
  return { id, token };
}

/**
 * The scope a runner token grants, or null when the value is not one, is unknown, revoked,
 * expired or wrong. Stamps `lastUsedAt` on success.
 * @param raw - The bearer value.
 */
export async function verifyRunnerToken(raw: string): Promise<RunnerTokenScope | null> {
  if (!raw.startsWith(RUNNER_TOKEN_PREFIX)) {
    return null;
  }
  const rest = raw.slice(RUNNER_TOKEN_PREFIX.length);
  const sep = rest.indexOf('_');
  if (sep <= 0) {
    return null;
  }
  const id = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (!secret) {
    return null;
  }
  const [row] = await db.select().from(runnerTokenSchema).where(eq(runnerTokenSchema.id, id)).limit(1);
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
    return null;
  }
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(row.secretHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  // A runner polls every twenty seconds; "last used" needs minutes, not a write per poll.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await db.update(runnerTokenSchema).set({ lastUsedAt: new Date() }).where(eq(runnerTokenSchema.id, id));
  }
  return { tokenId: row.id, accountId: row.accountId, projectIds: row.projectIds && row.projectIds.length > 0 ? row.projectIds : null };
}

/**
 * An account's runner tokens, newest first. Metadata only: never the hash.
 * @param accountId - The account.
 * @param opts - Options.
 * @param opts.includeRevoked - Also list revoked tokens.
 */
export async function listRunnerTokens(accountId: string, opts: { includeRevoked?: boolean } = {}): Promise<RunnerTokenSummary[]> {
  const rows = await db.select().from(runnerTokenSchema).where(eq(runnerTokenSchema.accountId, accountId)).orderBy(desc(runnerTokenSchema.createdAt));
  const named = new Set(rows.flatMap(r => r.projectIds ?? []));
  const projects = named.size > 0
    ? await db.select({ id: projectSchema.id, name: projectSchema.name }).from(projectSchema).where(and(eq(projectSchema.accountId, accountId), inArray(projectSchema.id, [...named])))
    : [];
  const nameOf = new Map(projects.map(p => [p.id, p.name]));
  return rows
    .filter(r => opts.includeRevoked || !r.revokedAt)
    .map(r => ({
      id: r.id,
      name: r.name,
      keyHint: r.keyHint,
      // A workspace deleted since keeps its id in the list; it no longer names a workspace, so it
      // is shown by id rather than dropped, which would read as a wider scope than the token has.
      workspaces: r.projectIds && r.projectIds.length > 0 ? r.projectIds.map(id => ({ id, name: nameOf.get(id) ?? id })) : null,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
      expiresAt: r.expiresAt,
    }));
}

/**
 * Revoke one of an account's runner tokens. A runner holding it can claim nothing from the next
 * call on; a run it already claimed keeps its own run token until that run ends.
 * @param accountId - The account (a token of another account is not found).
 * @param id - The token id.
 */
export async function revokeRunnerToken(accountId: string, id: string): Promise<boolean> {
  // The first revoke's time stands: a second click must not move when the token stopped.
  await db.update(runnerTokenSchema).set({ revokedAt: new Date() }).where(and(eq(runnerTokenSchema.accountId, accountId), eq(runnerTokenSchema.id, id), isNull(runnerTokenSchema.revokedAt)));
  const [row] = await db.select({ revokedAt: runnerTokenSchema.revokedAt }).from(runnerTokenSchema).where(and(eq(runnerTokenSchema.accountId, accountId), eq(runnerTokenSchema.id, id))).limit(1);
  return Boolean(row?.revokedAt);
}
