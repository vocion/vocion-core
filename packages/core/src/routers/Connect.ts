/**
 * The save behind the Connectors page's login form (#1028). After a person
 * logs in at the vendor, the form saves the source through
 * `createSourceOnLogin`, the same service the chat action calls, so the admin
 * check, the config check and the credential link are one rule.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { createSourceOnLogin } from '@/services/connect/createSourceOnLogin';
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
