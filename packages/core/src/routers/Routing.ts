/**
 * Dashboard routes for the System Keys: the Jev key that turns dynamic routing
 * on (ADR 0006), and the Amplitude key that turns analytics on. `service`
 * names which; it defaults to Jev, the first.
 *
 * Session only (oRPC has no bearer path), admins only for a write, and
 * write-only: no route returns a key, only its last four characters.
 *
 * The INSTANCE key is the installation's. On a single-Org server (core's only
 * mode) the Org is the installation, so an admin may set it from System, the
 * way an admin sets the Org's brand. On a multi-Org server one customer's
 * admin must not set every customer's key, so there it comes from the
 * environment (`TYPESAFE_API_KEY`, `AMPLITUDE_API_KEY`) and the card says so.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { AMPLITUDE_KEY, removeAmplitudeKey, saveAmplitudeKey } from '@/services/analytics/amplitudeKey';
import { jevSettings } from '@/services/routing/jev';
import { JEV_KEY, jevKeyStatus, removeJevKey, saveJevKey } from '@/services/routing/jevKey';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

const scopeSchema = z.enum(['instance', 'workspace']);
const serviceSchema = z.enum(['jev', 'amplitude']).default('jev');
const SERVICES = { jev: JEV_KEY, amplitude: AMPLITUDE_KEY } as const;

/**
 * Why the instance key cannot be set from the dashboard here, or null when it can.
 * @param service - The System Key the lock is about.
 */
async function instanceLock(service: keyof typeof SERVICES = 'jev'): Promise<string | null> {
  const { orgsMode } = await import('@/services/OrgPolicy');
  return orgsMode() === 'multi'
    ? `This server holds several Orgs, so the instance key is set in the server environment (${SERVICES[service].envVar}), not here.`
    : null;
}

async function guardWrite(scope: 'instance' | 'workspace', service: keyof typeof SERVICES = 'jev') {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN })) {
    throw ApiError.forbidden();
  }
  if (scope === 'instance') {
    const lock = await instanceLock(service);
    if (lock) {
      throw ApiError.badRequest(lock);
    }
  }
  return ctx;
}

export const status = os.handler(async () => {
  const ctx = await guardAuth();
  const isAdmin = ctx.has({ role: ORG_ROLE.ADMIN });
  const lock = await instanceLock();
  return {
    ...(await jevKeyStatus(ctx.orgId)),
    jevModel: jevSettings().model,
    canSetWorkspace: isAdmin,
    canSetInstance: isAdmin && !lock,
    instanceLock: lock,
  };
});

export const saveKey = os
  .input(z.object({ scope: scopeSchema, key: z.string().max(400), service: serviceSchema }))
  .handler(async ({ input }) => {
    const service = input.service ?? 'jev';
    const ctx = await guardWrite(input.scope, service);
    const problem = SERVICES[service].problem(input.key);
    if (problem) {
      throw ApiError.badRequest(problem);
    }
    const save = service === 'amplitude' ? saveAmplitudeKey : saveJevKey;
    return save({ scope: input.scope, orgId: ctx.orgId, key: input.key, by: ctx.userId });
  });

export const removeKey = os
  .input(z.object({ scope: scopeSchema, service: serviceSchema }))
  .handler(async ({ input }) => {
    const service = input.service ?? 'jev';
    const ctx = await guardWrite(input.scope, service);
    await (service === 'amplitude' ? removeAmplitudeKey : removeJevKey)(input.scope, ctx.orgId);
    return { removed: true };
  });
