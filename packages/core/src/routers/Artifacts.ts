/**
 * client.artifacts.* — one live artifact, its versions, and the log.
 *
 * Human edits and agent edits go through the SAME service calls, so the
 * version history is one trail rather than two. The only thing the browser
 * can do that a tool cannot is `restore` and `setFolder`; the only thing a
 * tool can do that the browser cannot is create without a conversation.
 */

import type { ArtifactRow } from '@/services/ArtifactService';
import { os } from '@orpc/server';
import { z } from 'zod';
import { exportArtifactAsPage } from '@/libs/artifacts/exportPage';
import { artifactSharePath, signArtifactShare } from '@/libs/share/artifactShareToken';
import { SHARE_AUDIENCES } from '@/libs/share/audience';
import { SOURCE_ARTIFACT_KINDS, sourceContentOf, sourceKindOf } from '@/libs/workspace/source';
import { track } from '@/services/adoption/track';
import { ArtifactError, deleteArtifact, getArtifact, getArtifactVersion, listArtifactFolders, listArtifacts, listArtifactsForConversation, listArtifactVersions, restoreArtifactVersion, setArtifactFolder, setArtifactShare, toPayload, toVersionPayload, updateArtifact } from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';
import { reviseDocument } from '@/services/documents/DocumentEngine';
import { restoreWorkspaceSource, WorkspaceSourceError, writeWorkspaceSource } from '@/services/workspace/WorkspaceSourceService';
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
  if (err instanceof WorkspaceSourceError) {
    if (err.code === 'NOT_FOUND') {
      throw ApiError.notFound({ message: err.message });
    }
    // The pane reads "conflict" off the message and offers Review / Keep mine.
    throw ApiError.badRequest(err.code === 'CONFLICT' ? `conflict: ${err.message}` : err.message);
  }
  throw err;
}

/** Artifacts of one conversation, oldest first — the chips in the transcript. */
export const listForConversation = os
  .input(z.object({ conversationId: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.conversationId });
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
    const { orgId } = await guardAuth();
    return listArtifacts({ orgId, search: input.search, kinds: input.kinds, folder: input.folder, limit: input.limit });
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
      // A mission or a SKILL.md mirrored from the workspace
      // (`libs/workspace/source.ts`): the FILE is the source of truth, so the
      // save writes it first, and the mirror's new version comes out of that
      // write — never the other way round. Title follows the file's `name:`.
      if (input.spec && (typeof input.spec.yaml === 'string' || typeof input.spec.md === 'string')) {
        const existing = await getArtifact({ orgId: auth.orgId, id: input.id });
        if (existing && SOURCE_ARTIFACT_KINDS.has(existing.kind)) {
          const kind = sourceKindOf(existing.kind, existing.spec);
          const slug = typeof existing.spec.slug === 'string' ? existing.spec.slug : existing.recordId;
          const content = sourceContentOf(input.spec);
          if (!kind || !slug || content === null) {
            throw ApiError.badRequest('this artifact mirrors a workspace file but names no slug');
          }
          const res = await writeWorkspaceSource({
            orgId: auth.orgId,
            kind,
            slug,
            content,
            author: { kind: 'human', id: auth.userId },
            changeSummary: input.changeSummary ?? 'Edited by hand',
            ifVersion: input.ifVersion ?? null,
            appliedBy: auth.userId ?? 'user',
            existingOnly: true,
          });
          if (!res.unchanged) {
            void track(auth, 'artifact.edited', { resource: ['artifact', res.artifact.id], meta: { kind: res.artifact.kind, action: 'edited', version: res.version.version } });
          }
          return { artifact: toPayload(res.artifact), version: toVersionPayload(res.version), collapsed: false };
        }
      }
      // A person's hand edit to a document's HTML goes through the engine, so
      // it is render-verified like an agent's edit: same door, same verdict.
      if (input.spec && typeof input.spec.html === 'string') {
        const existing = await getArtifact({ orgId: auth.orgId, id: input.id });
        if (existing?.kind === 'document') {
          const { artifact, version } = await reviseDocument({
            orgId: auth.orgId,
            id: input.id,
            html: input.spec.html,
            title: input.title ?? null,
            author: { kind: 'human', id: auth.userId },
            changeSummary: input.changeSummary ?? 'Edited HTML by hand',
            ...(input.ifVersion ? { ifVersion: input.ifVersion } : {}),
          });
          void track(auth, 'artifact.edited', { resource: ['artifact', artifact.id], meta: { kind: artifact.kind, action: 'edited', version: version.version } });
          return { artifact: toPayload(artifact), version: toVersionPayload(version), collapsed: false };
        }
      }
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

/**
 * What the share picker shows: the audience, its owner, and the public path when there is one.
 * @param row
 */
function shareInfo(row: ArtifactRow) {
  return {
    audience: row.shareAudience,
    ownerId: row.shareOwnerId ?? null,
    publicPath: row.shareAudience === 'anyone' ? artifactSharePath(signArtifactShare({ artifactId: row.id, orgId: row.orgId })) : null,
  };
}

/** The share state of one artifact. */
export const share = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await getArtifact({ orgId, id: input.id });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return shareInfo(row);
  });

/**
 * Choose who an artifact opens for. `anyone` mints the public link; choosing
 * anything narrower afterwards kills every copy of it, because the public
 * route re-checks the audience on every request.
 */
export const setShare = os
  .input(z.object({ id: z.number().int().positive(), audience: z.enum(SHARE_AUDIENCES) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const row = await setArtifactShare({ orgId, id: input.id, audience: input.audience, userId: userId ?? null });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return shareInfo(row);
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
      // A workspace source restores by writing the old text to the FILE, then
      // forward as a new head — disk and history agree, and neither rewinds.
      const existing = await getArtifact({ orgId: auth.orgId, id: input.id });
      if (existing && SOURCE_ARTIFACT_KINDS.has(existing.kind)) {
        const res = await restoreWorkspaceSource({ orgId: auth.orgId, id: input.id, version: input.version, author: { kind: 'human', id: auth.userId } });
        void track(auth, 'artifact.edited', { resource: ['artifact', res.artifact.id], meta: { kind: res.artifact.kind, action: 'restored', version: res.version.version } });
        return { artifact: toPayload(res.artifact), version: toVersionPayload(res.version) };
      }
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
