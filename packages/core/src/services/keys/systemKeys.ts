/**
 * SYSTEM KEYS: the keys that switch an optional service on, held at two levels.
 *
 * - the INSTANCE key, for every workspace on this installation: saved on
 *   System (`/dashboard/admin`), else the service's environment variable for a
 *   self-hoster who would rather keep it there;
 * - a WORKSPACE override, saved on Developers (`/dashboard/developers`), so
 *   one workspace bills or reports to its own account.
 *
 * Resolution is workspace, then instance, then environment, then off.
 *
 * Keys are write-only and stored encrypted (`routing_key`, named for the
 * first service that needed it: Jev, ADR 0006). Status reads return the last
 * four characters. A workspace key that cannot be decrypted does NOT fall
 * through to the instance key, which would send to the wrong account without
 * saying so: resolution throws and the caller treats the service as off.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { routingKeySchema } from '@/models/Schema';

export type KeyScope = 'instance' | 'workspace';

/** One service a System Keys card switches on. */
export type SystemKeyService = {
  /** `jev`, `amplitude`. */
  id: string;
  /** The environment variable that stands in for a saved instance key. */
  envVar: string;
  /** Why a pasted key will not do, or null when it will. Says nothing of the key. */
  problem: (key: string) => string | null;
  /** Where the key is sent, stored beside it (Jev: `typesafe` | `openrouter`). */
  providerOf: (key: string) => string;
  /**
   * Jev's rows predate the other services and are held as `instance` and
   * `workspace:<id>`; every other service prefixes its id.
   */
  unprefixedHolders?: boolean;
};

/** A level's key, as a settings card may see it. */
export type KeyOnFile = { hint: string; source: 'env' | 'saved'; provider: string; setBy: string | null; updatedAt: string | null };

/** Both levels, and which one a call in this workspace would use. */
export type SystemKeyStatus = { workspace: KeyOnFile | null; instance: KeyOnFile | null; effective: KeyScope | null };

/** Seams for tests. */
export type SystemKeyDeps = { env?: Record<string, string | undefined> };

const levelOf = (scope: KeyScope, orgId: string): string => (scope === 'instance' ? 'instance' : `workspace:${orgId}`);
const holderOf = (service: SystemKeyService, scope: KeyScope, orgId: string): string =>
  service.unprefixedHolders ? levelOf(scope, orgId) : `${service.id}:${levelOf(scope, orgId)}`;
const vaultScopeOf = (scope: KeyScope, orgId: string): string => (scope === 'instance' ? 'instance' : orgId);

/**
 * `…abcd`: what a card may show of a key.
 * @param key - The key.
 */
export function keyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : '…';
}

function envKey(service: SystemKeyService, env: Record<string, string | undefined>): string | null {
  const v = (env[service.envVar] ?? '').trim();
  return v || null;
}

async function row(holder: string) {
  const [r] = await db.select().from(routingKeySchema).where(eq(routingKeySchema.holder, holder)).limit(1);
  return r ?? null;
}

/**
 * The key a call in this workspace uses, and whose it is; null when the
 * service is off. Throws only when a saved key will not decrypt.
 * @param service - The service.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function resolveSystemKey(service: SystemKeyService, orgId: string, deps: SystemKeyDeps = {}): Promise<{ key: string; scope: KeyScope } | null> {
  for (const scope of ['workspace', 'instance'] as const) {
    const r = await row(holderOf(service, scope, orgId));
    if (r) {
      const plain = await buildCredentialVault().decrypt(vaultScopeOf(scope, orgId), r.ciphertext, r.nonce, r.authTag, r.dekId);
      return { key: plain.toString('utf8'), scope };
    }
  }
  const env = envKey(service, deps.env ?? process.env);
  return env ? { key: env, scope: 'instance' } : null;
}

/**
 * Whether the service is on here, and from which level, without decrypting anything.
 * @param service - The service.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function systemKeyStatus(service: SystemKeyService, orgId: string, deps: SystemKeyDeps = {}): Promise<SystemKeyStatus> {
  const [ws, inst] = await Promise.all([row(holderOf(service, 'workspace', orgId)), row(holderOf(service, 'instance', orgId))]);
  const onFile = (r: NonNullable<Awaited<ReturnType<typeof row>>>): KeyOnFile => ({ hint: r.keyHint, source: 'saved', provider: r.provider, setBy: r.setBy, updatedAt: r.updatedAt.toISOString() });
  const env = envKey(service, deps.env ?? process.env);
  const instance = inst ? onFile(inst) : env ? { hint: keyHint(env), source: 'env' as const, provider: service.providerOf(env), setBy: null, updatedAt: null } : null;
  const workspace = ws ? onFile(ws) : null;
  return { workspace, instance, effective: workspace ? 'workspace' : instance ? 'instance' : null };
}

/**
 * Save a level's key, replacing any before it. Refuses anything that is not
 * the service's key shape.
 * @param service - The service.
 * @param input - What to save.
 * @param input.scope - `instance` or `workspace`.
 * @param input.orgId - The workspace (the instance key ignores it).
 * @param input.key - The key.
 * @param input.by - Who saved it.
 */
export async function saveSystemKey(service: SystemKeyService, input: { scope: KeyScope; orgId: string; key: string; by: string }): Promise<KeyOnFile> {
  const key = input.key.trim();
  const problem = service.problem(key);
  if (problem) {
    throw new Error(problem);
  }
  const sealed = await buildCredentialVault().encrypt(vaultScopeOf(input.scope, input.orgId), Buffer.from(key, 'utf8'));
  const now = new Date();
  const values = {
    orgId: input.scope === 'instance' ? null : input.orgId,
    dekId: sealed.dekId,
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    authTag: sealed.authTag,
    keyHint: keyHint(key),
    provider: service.providerOf(key),
    setBy: input.by,
    updatedAt: now,
  };
  await db.insert(routingKeySchema).values({ holder: holderOf(service, input.scope, input.orgId), ...values }).onConflictDoUpdate({ target: routingKeySchema.holder, set: values });
  return { hint: values.keyHint, source: 'saved', provider: values.provider, setBy: input.by, updatedAt: now.toISOString() };
}

/**
 * Remove a level's saved key. The environment variable, if set, stays in force.
 * @param service - The service.
 * @param scope - `instance` or `workspace`.
 * @param orgId - The workspace.
 */
export async function removeSystemKey(service: SystemKeyService, scope: KeyScope, orgId: string): Promise<void> {
  await db.delete(routingKeySchema).where(eq(routingKeySchema.holder, holderOf(service, scope, orgId)));
}
