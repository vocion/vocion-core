/**
 * "CONNECT YOUR SYSTEMS" over RPC — what the docked walk-through calls
 * (`features/dashboard/connect-systems`):
 *
 *   plan     the ranked list for this workspace and person (`recommendations.ts`)
 *   saveKey  a key typed inline, straight to the vault with its source, in the
 *            Connectors page's one transaction (`createSourceWithCredential`)
 *   verify   the test call and first-sync preview (`verifyConnection.ts`)
 *   finish   answers the Decision that started the walk, with the summary as
 *            what happened, so a reload (and the agent's next turn) reads it
 *
 * Every call is scoped to the session's workspace; nothing takes a workspace
 * from the caller. A key is never echoed: `saveKey` answers with the source it
 * made and nothing else, and logs nothing of what was typed — only that a save
 * for which connector failed, by error name.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { logger } from '@/libs/Logger';
import { createSourceWithCredential } from '@/services/connect/createSourceWithCredential';
import { recommendConnections } from '@/services/connect/recommendations';
import { verifyConnection } from '@/services/connect/verifyConnection';
import { getConversation } from '@/services/ConversationService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

const Slug = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);

export const planConnectionsRoute = os
  .input(z.object({ named: z.array(Slug).max(20).optional(), app: z.string().min(1).max(80).optional() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return recommendConnections({ orgId, userId }, input);
  });

export const saveConnectionKeyRoute = os
  .input(z.object({
    connector: Slug,
    config: z.record(z.string(), z.unknown()),
    values: z.record(z.string().max(80), z.string().max(8000)),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    let saved: Awaited<ReturnType<typeof createSourceWithCredential>>;
    try {
      saved = await createSourceWithCredential({ orgId, actorUserId: userId, connector: input.connector, config: input.config, credential: { values: input.values } });
    } catch (error) {
      // Never the values, never the message (it could quote them): the connector and the error's name.
      logger.error('connect-systems: saving a key failed', { orgId, connector: input.connector, errorName: error instanceof Error ? error.name : typeof error });
      throw ApiError.badRequest('The key could not be saved, so nothing was added. Try again.');
    }
    if (!saved.ok) {
      // The service words its refusals for a person and names no secret.
      throw ApiError.badRequest(saved.reason);
    }
    return { ok: true as const, sourceId: saved.sourceId };
  });

export const verifyConnectionRoute = os
  .input(z.object({ connector: Slug }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return verifyConnection(orgId, input.connector);
  });

export const finishConnectionsRoute = os
  .input(z.object({
    conversationId: z.number().int().positive(),
    /** The "Connect your systems" Decision that started the walk. */
    decisionId: z.number().int().positive(),
    summary: z.string().min(1).max(600),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    // The conversation must be this workspace's and visible to this person.
    const conversation = await getConversation({ orgId, id: input.conversationId, viewerId: userId });
    if (!conversation) {
      throw ApiError.notFound({ id: input.conversationId });
    }
    const { settleConnectSystems } = await import('@/services/connect/settleWalk');
    return settleConnectSystems({ orgId, userId, conversationId: input.conversationId, decisionId: input.decisionId, summary: input.summary });
  });
