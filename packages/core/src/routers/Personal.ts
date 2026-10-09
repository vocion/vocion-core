/**
 * Personal → Connectors: a person's own connections, and the Org's switch for
 * them (docs/guides/personal-connections.md).
 *
 * Every route acts in the session's workspace only when it is the caller's OWN
 * personal workspace; anywhere else there is nothing to list or disconnect.
 * The switch is the Org admin's, from the same panel.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

export const connectionsRoute = os.handler(async () => {
  const { orgId, userId, accountId, has } = await guardAuth();
  const { listPersonalConnections, ownPersonalWorkspace, personalConnectionsAllowed } = await import('@/services/personal/connections');
  const own = await ownPersonalWorkspace(orgId, userId);
  if (!own) {
    return { personal: false as const, allowed: false, canChangePolicy: false, connections: [] };
  }
  const allowed = await personalConnectionsAllowed(own.accountId);
  return {
    personal: true as const,
    allowed,
    canChangePolicy: Boolean(accountId) && has({ role: ORG_ROLE.ADMIN }),
    connections: allowed ? await listPersonalConnections(own) : [],
  };
});

export const disconnectRoute = os
  .input(z.object({ connector: z.string().min(1).max(60) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const { disconnectPersonalConnection, ownPersonalWorkspace } = await import('@/services/personal/connections');
    const own = await ownPersonalWorkspace(orgId, userId);
    if (!own) {
      throw ApiError.notFound();
    }
    return { removed: await disconnectPersonalConnection(own, input.connector) };
  });

export const setPolicyRoute = os
  .input(z.object({ allowed: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { setPersonalConnectionsAllowed } = await import('@/services/personal/connections');
    await setPersonalConnectionsAllowed(accountId, input.allowed);
    return { allowed: input.allowed };
  });

/**
 * The person's morning brief and evening wrap times. `browserTimeZone` is the
 * zone the page runs in: it becomes the person's zone the first time, when
 * they have not chosen one, so 07:30 means their 07:30 without a setting.
 */
export const rhythmRoute = os
  .input(z.object({ browserTimeZone: z.string().max(64).optional() }))
  .handler(async ({ input }) => {
    const { userId, accountId } = await guardAuth();
    if (!accountId) {
      throw ApiError.forbidden();
    }
    const { getRhythm, setRhythm } = await import('@/services/personal/rhythm/schedule');
    const { isValidTimeZone } = await import('@/libs/time/zone');
    const current = await getRhythm(userId, accountId);
    if (!current.zoneChosen && isValidTimeZone(input.browserTimeZone)) {
      return setRhythm(userId, accountId, { timeZone: input.browserTimeZone });
    }
    return current;
  });

export const setRhythmRoute = os
  .input(z.object({
    briefAt: z.string().max(5).optional(),
    wrapAt: z.string().max(5).optional(),
    briefOn: z.boolean().optional(),
    wrapOn: z.boolean().optional(),
    timeZone: z.string().max(64).optional(),
  }))
  .handler(async ({ input }) => {
    const { userId, accountId } = await guardAuth();
    if (!accountId) {
      throw ApiError.forbidden();
    }
    const { rhythmChangeProblem, setRhythm } = await import('@/services/personal/rhythm/schedule');
    const problem = rhythmChangeProblem(input);
    if (problem) {
      throw ApiError.badRequest(problem);
    }
    return setRhythm(userId, accountId, input);
  });

/** The Org's daily-brief switch and daily cap, and whether this person may change them. */
export const orgBriefsRoute = os.handler(async () => {
  const { accountId, has } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { orgBriefSettings } = await import('@/services/personal/rhythm/guard');
  return { ...(await orgBriefSettings(accountId)), canChange: has({ role: ORG_ROLE.ADMIN }) };
});

export const setOrgBriefsRoute = os
  .input(z.object({ dailyBriefs: z.boolean().optional(), briefDailyCents: z.number().int().min(0).max(1_000_000).nullable().optional() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { orgBriefSettings, setOrgBriefSettings } = await import('@/services/personal/rhythm/guard');
    await setOrgBriefSettings(accountId, input);
    return { ...(await orgBriefSettings(accountId)), canChange: true };
  });
