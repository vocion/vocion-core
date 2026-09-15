import { os } from '@orpc/server';
import { z } from 'zod';
import { exportCanvasAsPage } from '@/libs/canvas/exportPage';
import {
  ArtifactError,
  deleteArtifact,
  deleteCanvas,
  getArtifact,
  getCanvas,
  listArtifactsForConversation,
  listCanvases,
  saveCanvas,
  setArtifactPinned,
  setArtifactTiles,
  toPayload,
  updateArtifactSpec,
} from '@/services/ArtifactService';
import { getConversation } from '@/services/ConversationService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

const tileSchema = z.object({ slot: z.number().int().min(0).max(255), span: z.union([z.literal(1), z.literal(2), z.literal(3)]) });

/** Artifacts of one conversation, pinned only by default — what the canvas shows. */
export const listForConversation = os
  .input(z.object({ conversationId: z.number().int().positive(), includeUnpinned: z.boolean().default(false) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.conversationId });
    if (!conv) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    const rows = await listArtifactsForConversation({ orgId, conversationId: input.conversationId, includeUnpinned: input.includeUnpinned });
    return rows.map(toPayload);
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

export const updateSpec = os
  .input(z.object({ id: z.number().int().positive(), title: z.string().min(1).max(200).optional(), spec: z.record(z.string(), z.unknown()) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    try {
      const row = await updateArtifactSpec({ orgId, id: input.id, title: input.title, spec: input.spec });
      if (!row) {
        throw ApiError.notFound({ id: input.id });
      }
      return toPayload(row);
    } catch (err) {
      if (err instanceof ArtifactError) {
        throw ApiError.badRequest(err.message);
      }
      throw err;
    }
  });

/** A drag or a resize: the full new placement of the moved tiles. */
export const placeTiles = os
  .input(z.object({ tiles: z.array(z.object({ id: z.number().int().positive(), tile: tileSchema })).min(1).max(64) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await setArtifactTiles({ orgId, tiles: input.tiles });
    return { ok: true };
  });

export const setPinned = os
  .input(z.object({ id: z.number().int().positive(), pinned: z.boolean() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const row = await setArtifactPinned({ orgId, id: input.id, pinned: input.pinned });
    if (!row) {
      throw ApiError.notFound({ id: input.id });
    }
    return toPayload(row);
  });

export const remove = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await deleteArtifact({ orgId, id: input.id });
    return { ok: true };
  });

/* ---- canvases ---- */

export const saveCanvasRoute = os
  .input(z.object({ conversationId: z.number().int().positive(), name: z.string().min(1).max(120) }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    const conv = await getConversation({ orgId, id: input.conversationId });
    if (!conv) {
      throw ApiError.notFound({ conversationId: input.conversationId });
    }
    const { canvas, artifacts } = await saveCanvas({ orgId, projectId: conv.projectId, conversationId: input.conversationId, name: input.name, createdBy: userId ?? null });
    return { canvas, artifacts: artifacts.map(toPayload) };
  });

export const listCanvasesRoute = os
  .input(z.object({ limit: z.number().int().positive().max(200).default(100) }).default({ limit: 100 }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return listCanvases({ orgId, limit: input.limit });
  });

export const getCanvasRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const found = await getCanvas({ orgId, id: input.id });
    if (!found) {
      throw ApiError.notFound({ id: input.id });
    }
    return { canvas: found.canvas, artifacts: found.artifacts.map(toPayload) };
  });

export const removeCanvasRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await deleteCanvas({ orgId, id: input.id });
    return { ok: true };
  });

/** The saved canvas as a workspace `pages/<slug>.yaml` (+ sibling .md) a person commits to the workspace repo. */
export const exportCanvasRoute = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const found = await getCanvas({ orgId, id: input.id });
    if (!found) {
      throw ApiError.notFound({ id: input.id });
    }
    return exportCanvasAsPage(found.canvas, found.artifacts);
  });
