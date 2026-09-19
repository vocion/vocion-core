/**
 * client.artifacts.* — one live artifact, its versions, and the log.
 *
 * Human edits and agent edits go through the SAME service calls, so the
 * version history is one trail rather than two. The only thing the browser
 * can do that a tool cannot is `restore` and `setFolder`; the only thing a
 * tool can do that the browser cannot is create without a conversation.
 */

import { os } from '@orpc/server';
import { z } from 'zod';
import { exportArtifactAsPage } from '@/libs/artifacts/exportPage';
import { track } from '@/services/adoption/track';
import {
  ArtifactError,
  deleteArtifact,
  getArtifact,
  getArtifactVersion,
  listArtifactFolders,
  listArtifacts,
  listArtifactsForConversation,
  listArtifactVersions,
  restoreArtifactVersion,
  setArtifactFolder,
  toPayload,
  toVersionPayload,
  updateArtifact,
} from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * Map a service error onto the wire.
 * @param err
 */
function rethrow(err: unknown): never {
  if (err instanceof ArtifactError) {
    if (err.code === 'NOT_FOUND') {
      throw ApiError.notFound({ message: err.message });
    }
    throw ApiError.badRequest(err.message);
  }
  throw err;
}

/** Artifacts of one conversation, oldest first — the chips in the transcript. */
export const listForConversation = os
  .input(z.object({ conversationId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.conversationId, requestedBy: userId });
    if (!conv) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    return (await listArtifactsForConversation({ orgId, conversationId: input.conversationId })).map(toPayload);
  });

export const get = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await getArtifact({ orgId, id: input.id });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return toPayload(row);
  });

/** The log at /dashboard/artifacts. */
export const list = os
  .input(z.object({
    search: z.string().max(200).optional(),
    kinds: z.array(z.string().max(20)).max(8).optional(),
    folder: z.string().max(120).optional(),
    limit: z.number().int().positive().max(500).default(200),
  }).default({ limit: 200 }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return listArtifacts({ orgId, search: input.search, kinds: input.kinds, folder: input.folder, limit: input.limit, requestedBy: userId });
  });

export const folders = os
  .input(z.object({}).default({}))
  .handler(async () => {
    const { orgId } = await guardAuth();
    return listArtifactFolders({ orgId });
  });

/**
 * A person's Save. `ifVersion` makes a race explicit: when the agent wrote
 * while the person was typing the save is refused rather than silently
 * clobbering, and the pane offers Review / Keep mine (which re-sends without
 * it, deliberately writing on top).
 */
export const update = os
  .input(z.object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(200).optional(),
    spec: z.record(z.string(), z.unknown()).optional(),
    contentMarkdown: z.string().max(200_000).optional(),
    changeSummary: z.string().max(160).optional(),
    ifVersion: z.number().int().positive().optional(),
  }))
  .handler(async ({ input }) => {
    const auth = await guardAuth();
    try {
      const { artifact, version, collapsed } = await updateArtifact({
        orgId: auth.orgId,
        id: input.id,
        title: input.title ?? null,
        spec: input.spec,
        contentMarkdown: input.contentMarkdown ?? null,
        author: { kind: 'human', id: auth.userId },
        changeSummary: input.changeSummary ?? null,
        ifVersion: input.ifVersion ?? null,
      });
      if (!collapsed) {
        void track(auth, 'artifact.edited', { resource: ['artifact', artifact.id], meta: { kind: artifact.kind, action: 'edited', version: version.version } });
      }
      return { artifact: toPayload(artifact), version: toVersionPayload(version), collapsed };
    } catch (err) {
      if (err instanceof ArtifactError && err.code === 'CONFLICT') {
        // The pane reads "conflict" off the message and offers Review / Keep
        // mine; Keep mine re-sends without `ifVersion`.
        throw ApiError.badRequest(`conflict: ${err.message}`);
      }
      return rethrow(err);
    }
  });

export const setFolder = os
  .input(z.object({ id: z.number().int().positive(), folder: z.string().max(120).nullable() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await setArtifactFolder({ orgId, id: input.id, folder: input.folder });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return toPayload(row);
  });

export const versions = os
  .input(z.object({ id: z.number().int().positive(), limit: z.number().int().positive().max(200).default(50) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return (await listArtifactVersions({ orgId, artifactId: input.id, limit: input.limit })).map(toVersionPayload);
  });

export const version = os
  .input(z.object({ id: z.number().int().positive(), version: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await getArtifactVersion({ orgId, artifactId: input.id, version: input.version });
    if (!row) {
      throw ApiError.notFound({ id: input.id, version: input.version });
    }
    return toVersionPayload(row);
  });

/** Restore writes a NEW head version carrying the old content. */
export const restore = os
  .input(z.object({ id: z.number().int().positive(), version: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const auth = await guardAuth();
    try {
      const { artifact, version: v } = await restoreArtifactVersion({
        orgId: auth.orgId,
        id: input.id,
        version: input.version,
        author: { kind: 'human', id: auth.userId },
      });
      void track(auth, 'artifact.edited', { resource: ['artifact', artifact.id], meta: { kind: artifact.kind, action: 'restored', version: v.version } });
      return { artifact: toPayload(artifact), version: toVersionPayload(v) };
    } catch (err) {
      return rethrow(err);
    }
  });

export const remove = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await deleteArtifact({ orgId, id: input.id });
    return { ok: true };
  });

/** The artifact as a workspace `pages/<slug>.yaml` (+ sibling .md) a person commits. */
export const exportPage = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await getArtifact({ orgId, id: input.id });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return exportArtifactAsPage(row);
  });
