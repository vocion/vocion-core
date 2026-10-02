/**
 * The save behind the Connectors page's login form (#1080). After a person
 * logs in at the vendor, the form saves the source through
 * `createSourceOnLogin`, the same service the chat action calls, so the admin
 * check, the config check and the credential link are one rule.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { VaultDecryptionError } from '@/libs/crypto/credentialVault';
import { createSourceOnLogin } from '@/services/connect/createSourceOnLogin';
import { createSourceWithCredential } from '@/services/connect/createSourceWithCredential';
import { revealStoredCredential } from '@/services/connect/revealStoredCredential';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const saveSourceRoute = os
  .input(z.object({
    connector: z.string().min(1).max(80),
    config: z.record(z.string(), z.unknown()),
    sourceSlug: z.string().min(1).max(120).optional(),
    // The page's "Add another" means a new source; only a caller that names a source on purpose sends false.
    createNew: z.boolean().default(true),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const saved = await createSourceOnLogin({
      orgId,
      actorUserId: userId,
      connector: input.connector,
      config: input.config,
      sourceSlug: input.sourceSlug,
      createNew: input.createNew,
    });
    if (!saved.ok) {
      // The service words its refusals for a person; the form shows them as they are.
      throw ApiError.badRequest(saved.reason);
    }
    return { ok: true as const, sourceId: saved.sourceId };
  });

/**
 * Add a connector and its credential in one save, from the Connectors page's
 * add form: a value the person pasted, or the stored login or key they kept.
 * One transaction writes the key, the source and the link, so a failure leaves
 * nothing behind and the form shows the reason. Admin-only, like `saveSource`.
 */
export const addConnectorRoute = os
  .input(z.object({
    connector: z.string().min(1).max(80),
    config: z.record(z.string(), z.unknown()),
    credential: z.union([
      z.object({ keepStored: z.literal(true) }),
      z.object({ values: z.record(z.string().max(80), z.string().max(8000)) }),
    ]),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const saved = await createSourceWithCredential({
      orgId,
      actorUserId: userId,
      connector: input.connector,
      config: input.config,
      credential: input.credential,
    });
    if (!saved.ok) {
      throw ApiError.badRequest(saved.reason);
    }
    return { ok: true as const, sourceId: saved.sourceId };
  });

/**
 * Show an admin the stored login or key the add form is keeping, on a
 * deliberate "Show" click. The page payload carries only the account and a
 * masked tail; this is the one place the value crosses to the browser. Members
 * get 403, and every reveal is written to `source_audit` before it is returned.
 * Callers send `cache: 'no-store'` and keep the value in component state only.
 */
export const revealStoredCredentialRoute = os
  .input(z.object({ connector: z.string().min(1).max(80) }))
  .handler(async ({ input }) => {
    const ctx = await guardAuth();
    if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    try {
      return await revealStoredCredential({ orgId: ctx.orgId, userId: ctx.userId, connector: input.connector });
    } catch (error) {
      // Only the vault's own sentence is safe to show; it names a cause and a fix and holds no secret.
      console.error('[connect.revealStoredCredential] could not reveal', {
        connector: input.connector,
        message: error instanceof Error ? error.message : String(error),
      });
      throw ApiError.badRequest(error instanceof VaultDecryptionError ? error.message : 'Could not read the stored credential.');
    }
  });
