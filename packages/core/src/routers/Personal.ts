/**
 * Personal connectors: a person's own connections, and the Org's switch for
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
    const { userId, accountId: sessionAccount } = await guardAuth();
    // A person's rhythm is theirs, kept on their home Org with their one Personal.
    const { homeAccountFor } = await import('@/services/workspace/personalProject');
    const accountId = (await homeAccountFor(userId)) ?? sessionAccount;
    if (!accountId) {
      throw ApiError.forbidden();
    }
    const { getRhythm, setRhythm } = await import('@/services/personal/rhythm/schedule');
    const { isValidTimeZone } = await import('@/libs/time/zone');
    const current = await getRhythm(userId, accountId);
    const { pushChannelsAvailable } = await import('@/services/personal/push');
    const { listenAvailability } = await import('@/services/briefings/audio/settings');
    const [available, listen] = await Promise.all([pushChannelsAvailable(userId), listenAvailability(userId, accountId)]);
    if (!current.zoneChosen && isValidTimeZone(input.browserTimeZone)) {
      return { ...(await setRhythm(userId, accountId, { timeZone: input.browserTimeZone })), available, listen };
    }
    return { ...current, available, listen };
  });

export const setRhythmRoute = os
  .input(z.object({
    briefAt: z.string().max(5).optional(),
    wrapAt: z.string().max(5).optional(),
    briefOn: z.boolean().optional(),
    wrapOn: z.boolean().optional(),
    timeZone: z.string().max(64).optional(),
    pushChannels: z.array(z.enum(['slack', 'sms', 'email'])).max(3).optional(),
    pushMode: z.enum(['brief_and_urgent', 'urgent']).optional(),
    quietStart: z.string().max(5).nullable().optional(),
    quietEnd: z.string().max(5).nullable().optional(),
    listenOn: z.boolean().nullable().optional(),
    voiceId: z.string().max(64).nullable().optional(),
    listenSpeed: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  }))
  .handler(async ({ input }) => {
    const { userId, accountId: sessionAccount } = await guardAuth();
    // A person's rhythm is theirs, kept on their home Org with their one Personal.
    const { homeAccountFor } = await import('@/services/workspace/personalProject');
    const accountId = (await homeAccountFor(userId)) ?? sessionAccount;
    if (!accountId) {
      throw ApiError.forbidden();
    }
    const { rhythmChangeProblem, setRhythm } = await import('@/services/personal/rhythm/schedule');
    const problem = rhythmChangeProblem(input);
    if (problem) {
      throw ApiError.badRequest(problem);
    }
    const { pushChannelsAvailable } = await import('@/services/personal/push');
    const { listenAvailability } = await import('@/services/briefings/audio/settings');
    const saved = await setRhythm(userId, accountId, input);
    const [available, listen] = await Promise.all([pushChannelsAvailable(userId), listenAvailability(userId, accountId)]);
    return { ...saved, available, listen };
  });

/** The Org's daily-brief switch and daily cap, and whether this person may change them. */
export const orgBriefsRoute = os.handler(async () => {
  const { accountId, has } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { orgBriefSettings } = await import('@/services/briefings/budgetGate');
  return { ...(await orgBriefSettings(accountId)), canChange: has({ role: ORG_ROLE.ADMIN }) };
});

export const setOrgBriefsRoute = os
  .input(z.object({ dailyBriefs: z.boolean().optional(), briefDailyCents: z.number().int().min(0).max(1_000_000).nullable().optional(), briefAudio: z.boolean().optional(), briefVoiceId: z.string().regex(/^[\w-]{1,64}$/).nullable().optional() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { orgBriefSettings, setOrgBriefSettings } = await import('@/services/briefings/budgetGate');
    await setOrgBriefSettings(accountId, input);
    return { ...(await orgBriefSettings(accountId)), canChange: true };
  });

/** The voices the Org's account can speak with, for the voice choice under Your day. */
export const voicesRoute = os.handler(async () => {
  const { userId, accountId } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { voicesFor } = await import('@/services/briefings/audio/settings');
  return voicesFor(userId, accountId);
});

/**
 * Make the person's private podcast feed (revoking any old one) and return
 * its URL — the only time it is shown.
 */
export const createFeedRoute = os.handler(async () => {
  const { userId, accountId } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { createPodcastFeed, feedPath } = await import('@/services/briefings/audio/podcast');
  const { appBaseUrl } = await import('@/libs/links');
  const { token, createdAt } = await createPodcastFeed(userId, accountId);
  return { url: `${appBaseUrl()}${feedPath(token)}`, createdAt };
});

/** Stop the person's private podcast feed. */
export const revokeFeedRoute = os.handler(async () => {
  const { userId, accountId } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const { revokePodcastFeed } = await import('@/services/briefings/audio/podcast');
  await revokePodcastFeed(userId, accountId);
  return { revoked: true };
});

/**
 * The Org's "Include in members' Personal" setting (`services/personal/reach.ts`):
 * whether its items reach its members' one Personal with their content, or as
 * counts with links. Meaningful only where there are several Orgs to read
 * across, so `applies` is false on a single-Org install and nothing is shown.
 */
export const orgReachRoute = os.handler(async () => {
  const { accountId, has } = await guardAuth();
  if (!accountId) {
    throw ApiError.forbidden();
  }
  const [{ includeInPersonal }, { orgsMode }] = await Promise.all([import('@/services/personal/reach'), import('@/services/OrgPolicy')]);
  return { include: await includeInPersonal(accountId), canChange: has({ role: ORG_ROLE.ADMIN }), applies: orgsMode() === 'multi' };
});

export const setOrgReachRoute = os
  .input(z.object({ include: z.boolean() }))
  .handler(async ({ input }) => {
    const { accountId, has } = await guardAuth();
    if (!accountId || !has({ role: ORG_ROLE.ADMIN })) {
      throw ApiError.forbidden();
    }
    const { setIncludeInPersonal } = await import('@/services/personal/reach');
    await setIncludeInPersonal(accountId, input.include);
    return { include: input.include };
  });
