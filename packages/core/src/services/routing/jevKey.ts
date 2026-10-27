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
 * Stored and resolved by the shared System Keys store
 * (`services/keys/systemKeys.ts`); this module is Jev's half of it.
 *
 * Keys are write-only. Nothing here returns a key except `resolveJevKey`,
 * whose one caller hands it straight to `jev.decide`; status reads return the
 * last four characters. A workspace key that cannot be decrypted does NOT fall
 * through to the instance key (that would bill the wrong account without
 * saying so): routing goes static and the run records why.
 */

import type { KeyScope, SystemKeyDeps, KeyOnFile as SystemKeyOnFile, SystemKeyService } from '@/services/keys/systemKeys';
import { keyHint, removeSystemKey, resolveSystemKey, saveSystemKey, systemKeyStatus } from '@/services/keys/systemKeys';
import { jevProviderOf } from './jev';

export type { KeyScope };

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

/** The Jev key, as one of the System Keys (`services/keys/systemKeys.ts`). */
export const JEV_KEY: SystemKeyService = {
  id: 'jev',
  envVar: 'TYPESAFE_API_KEY',
  problem: jevKeyProblem,
  providerOf: jevProviderOf,
  unprefixedHolders: true,
};

/**
 * `…abcd`: what a card may show of a key.
 * @param key - The key.
 */
export const jevKeyHint = keyHint;

/** A level's key, as a settings card may see it. */
export type KeyOnFile = Omit<SystemKeyOnFile, 'provider'> & { provider: 'openrouter' | 'typesafe' };

/** Both levels, and which one a run in this workspace would use. */
export type JevKeyStatus = { workspace: KeyOnFile | null; instance: KeyOnFile | null; effective: KeyScope | null };

/** Seams for tests. */
export type JevKeyDeps = SystemKeyDeps;

const asJev = (onFile: SystemKeyOnFile | null): KeyOnFile | null =>
  onFile ? { ...onFile, provider: onFile.provider === 'openrouter' ? 'openrouter' : 'typesafe' } : null;

/**
 * The key a Jev call in this workspace spends, and whose it is; null when
 * routing is off. Throws only when a saved key will not decrypt (the caller
 * routes static and says why).
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export function resolveJevKey(orgId: string, deps: JevKeyDeps = {}): Promise<{ key: string; scope: KeyScope } | null> {
  return resolveSystemKey(JEV_KEY, orgId, deps);
}

/**
 * Whether routing is on here, and from which level, without decrypting anything.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function jevKeyStatus(orgId: string, deps: JevKeyDeps = {}): Promise<JevKeyStatus> {
  const status = await systemKeyStatus(JEV_KEY, orgId, deps);
  return { workspace: asJev(status.workspace), instance: asJev(status.instance), effective: status.effective };
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
  return asJev(await saveSystemKey(JEV_KEY, input))!;
}

/**
 * Remove a level's saved key. The instance's `TYPESAFE_API_KEY`, if set,
 * stays in force: it lives in the environment, not here.
 * @param scope - `instance` or `workspace`.
 * @param orgId - The workspace.
 */
export function removeJevKey(scope: KeyScope, orgId: string): Promise<void> {
  return removeSystemKey(JEV_KEY, scope, orgId);
}
