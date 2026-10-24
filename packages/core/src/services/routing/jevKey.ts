/**
 * THE KEY THAT TURNS DYNAMIC ROUTING ON (ADR 0006). A Jev (TypeSafe) API key,
 * from the TypeSafe console (an OpenRouter key, `sk-or-…`, also works and is
 * sent to OpenRouter's System One API instead). Held at two levels:
 *
 * - the INSTANCE key, for every workspace on this installation: saved on
 *   System (`/dashboard/admin`) and stored encrypted here, else the
 *   `TYPESAFE_API_KEY` environment variable for a self-hoster who would
 *   rather keep it in the environment;
 * - a WORKSPACE override, saved by that workspace's admin on Developers
 *   (`/dashboard/developers`), so a client workspace's Jev calls bill and
 *   track on its own TypeSafe account.
 *
 * Resolution is workspace, then instance, then off. Off is the default and
 * means exactly ADR 0005's static routing: Jev is never called.
 *
 * Keys are write-only. Nothing here returns a key except `resolveJevKey`,
 * whose one caller hands it straight to `jev.decide`; status reads return the
 * last four characters. A workspace key that cannot be decrypted does NOT fall
 * through to the instance key (that would bill the wrong account without
 * saying so): routing goes static and the run records why.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { buildCredentialVault } from '@/libs/crypto/credentialVault';
import { db } from '@/libs/DB';
import { routingKeySchema } from '@/models/Schema';
import { jevProviderOf } from './jev';

export type KeyScope = 'instance' | 'workspace';

/** The vault scope and row a level's key lives under. */
const INSTANCE_HOLDER = 'instance';
const holderOf = (scope: KeyScope, orgId: string): string => (scope === 'instance' ? INSTANCE_HOLDER : `workspace:${orgId}`);
const vaultScopeOf = (scope: KeyScope, orgId: string): string => (scope === 'instance' ? INSTANCE_HOLDER : orgId);

/** A bearer token: no spaces, not absurdly short or long. TypeSafe does not document a prefix. */
const KEY_SHAPE = /^\S{20,400}$/;

/**
 * Why a pasted key will not do, or null when it will. Says nothing of the key.
 * @param raw - What was pasted.
 */
export function jevKeyProblem(raw: string): string | null {
  const key = raw.trim();
  if (!key) {
    return 'Paste a Jev (TypeSafe) API key.';
  }
  if (!KEY_SHAPE.test(key)) {
    return 'That does not look like an API key: it is one unbroken string of at least 20 characters, from the TypeSafe console (an OpenRouter key, sk-or-…, also works).';
  }
  return null;
}

/**
 * `…abcd`: what a card may show of a key.
 * @param key - The key.
 */
export function jevKeyHint(key: string): string {
  return key.length > 8 ? `…${key.slice(-4)}` : '…';
}

/** A level's key, as a settings card may see it. */
export type KeyOnFile = { hint: string; source: 'env' | 'saved'; provider: 'openrouter' | 'typesafe'; setBy: string | null; updatedAt: string | null };

/** Both levels, and which one a run in this workspace would use. */
export type JevKeyStatus = { workspace: KeyOnFile | null; instance: KeyOnFile | null; effective: KeyScope | null };

/** Seams for tests. */
export type JevKeyDeps = { env?: Record<string, string | undefined> };

const envKey = (env: Record<string, string | undefined>): string | null => {
  const v = (env.TYPESAFE_API_KEY ?? '').trim();
  return v || null;
};

async function row(holder: string) {
  const [r] = await db.select().from(routingKeySchema).where(eq(routingKeySchema.holder, holder)).limit(1);
  return r ?? null;
}

/**
 * The key a Jev call in this workspace spends, and whose it is; null when
 * routing is off. Throws only when a saved key will not decrypt (the caller
 * routes static and says why).
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function resolveJevKey(orgId: string, deps: JevKeyDeps = {}): Promise<{ key: string; scope: KeyScope } | null> {
  for (const scope of ['workspace', 'instance'] as const) {
    const r = await row(holderOf(scope, orgId));
    if (r) {
      const plain = await buildCredentialVault().decrypt(vaultScopeOf(scope, orgId), r.ciphertext, r.nonce, r.authTag, r.dekId);
      return { key: plain.toString('utf8'), scope };
    }
  }
  const env = envKey(deps.env ?? process.env);
  return env ? { key: env, scope: 'instance' } : null;
}

/**
 * Whether routing is on here, and from which level, without decrypting anything.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function jevKeyStatus(orgId: string, deps: JevKeyDeps = {}): Promise<JevKeyStatus> {
  const [ws, inst] = await Promise.all([row(holderOf('workspace', orgId)), row(INSTANCE_HOLDER)]);
  const onFile = (r: NonNullable<Awaited<ReturnType<typeof row>>>): KeyOnFile => ({ hint: r.keyHint, source: 'saved', provider: r.provider === 'openrouter' ? 'openrouter' : 'typesafe', setBy: r.setBy, updatedAt: r.updatedAt.toISOString() });
  const env = envKey(deps.env ?? process.env);
  const instance = inst ? onFile(inst) : env ? { hint: jevKeyHint(env), source: 'env' as const, provider: jevProviderOf(env), setBy: null, updatedAt: null } : null;
  const workspace = ws ? onFile(ws) : null;
  return { workspace, instance, effective: workspace ? 'workspace' : instance ? 'instance' : null };
}

/**
 * Save a level's key, replacing any before it. Refuses anything that is not a
 * key's shape.
 * @param input - What to save.
 * @param input.scope - `instance` or `workspace`.
 * @param input.orgId - The workspace (the instance key ignores it).
 * @param input.key - The key.
 * @param input.by - Who saved it.
 */
export async function saveJevKey(input: { scope: KeyScope; orgId: string; key: string; by: string }): Promise<KeyOnFile> {
  const key = input.key.trim();
  const problem = jevKeyProblem(key);
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
    keyHint: jevKeyHint(key),
    provider: jevProviderOf(key),
    setBy: input.by,
    updatedAt: now,
  };
  await db.insert(routingKeySchema).values({ holder: holderOf(input.scope, input.orgId), ...values }).onConflictDoUpdate({ target: routingKeySchema.holder, set: values });
  return { hint: values.keyHint, source: 'saved', provider: values.provider, setBy: input.by, updatedAt: now.toISOString() };
}

/**
 * Remove a level's saved key. The instance's `TYPESAFE_API_KEY`, if set,
 * stays in force: it lives in the environment, not here.
 * @param scope - `instance` or `workspace`.
 * @param orgId - The workspace.
 */
export async function removeJevKey(scope: KeyScope, orgId: string): Promise<void> {
  await db.delete(routingKeySchema).where(eq(routingKeySchema.holder, holderOf(scope, orgId)));
}
