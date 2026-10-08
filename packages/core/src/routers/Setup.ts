/**
 * A plugin's setup: where it stands, and the admin-only reset that lets
 * onboarding be run again (services/plugins/setupState.ts, setupReset.ts).
 */
import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { listPluginSlugs } from '@/libs/workspace/plugins';
import { resetSetup } from '@/services/plugins/setupReset';
import { setupStateForOrg } from '@/services/plugins/setupState';
import { guardAuth, guardRole } from './AuthGuards';

export const state = os.handler(async () => {
  const { orgId } = await guardAuth();
  return { plugins: await setupStateForOrg(orgId!) };
});

export const reset = os
  .input(z.object({ plugin: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardRole('org:admin');
    const { userId } = await guardAuth();
    if (!listPluginSlugs().includes(input.plugin)) {
      throw new ORPCError('NOT_FOUND', { message: `unknown plugin "${input.plugin}"` });
    }
    try {
      return await resetSetup({ orgId: orgId!, pluginSlug: input.plugin, actor: userId ? `user:${userId}` : 'ui-setup' });
    } catch (err) {
      throw new ORPCError('BAD_REQUEST', { message: err instanceof Error ? err.message : String(err) });
    }
  });
