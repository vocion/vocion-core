/**
 * A VIDEO HOST: somewhere outside Vocion a recording can live with its own
 * player, transcript and sharing — optional, used only when a workspace has
 * connected one (Chris, 2026-10-03: "upload the factory's QA / live-check
 * recordings … and embed the player on the feature page").
 *
 * This file is the capability, and names no vendor. A provider (today the one
 * in `libs/slate/videoHost.ts`) says whether an org has it connected and how
 * to publish there; callers ask `videoHost(orgId)` and get one or null. A
 * second host costs a provider in {@link VIDEO_HOST_PROVIDERS}, nothing else.
 */

import type { Buffer } from 'node:buffer';
import { slateVideoHost } from '@/libs/slate/videoHost';

export type VideoHostPublishInput = {
  data: Buffer | Uint8Array;
  contentType: string;
  title: string;
  /** The line under it: what the recording shows. */
  summary: string | null;
};

export type VideoHostPublished = {
  ok: true;
  /** The host's id for the recording's share, what the player is addressed by. */
  shareId: string;
  /** The host's own id for the recording, when it differs from the share. */
  hostRef: string;
  watchUrl: string;
  embedUrl: string;
  /** Who may watch, in the host's words (`team`, `private`, …). */
  visibility: string;
};
export type VideoHostRefusal = { ok: false; reason: string; retryable: boolean };

export type VideoHost = {
  /** Stable id (`slate`). */
  id: string;
  /** Its name, for "Open in …". */
  label: string;
  publish: (input: VideoHostPublishInput) => Promise<VideoHostPublished | VideoHostRefusal>;
  /** Fields the provider keeps on the artifact's spec under its own names, for a share. */
  specFields: (shareId: string) => Record<string, unknown>;
};

export type VideoHostProvider = {
  id: string;
  label: string;
  /** The org's host, or null when it has none connected. Never throws for "not connected". */
  resolve: (orgId: string) => Promise<VideoHost | null>;
};

export const VIDEO_HOST_PROVIDERS: readonly VideoHostProvider[] = [slateVideoHost];

/**
 * The org's video host, or null when none is connected. A provider that fails
 * to resolve (a broken credential) counts as none, logged — a host is never a
 * reason for the factory to stop.
 * @param orgId - The workspace.
 * @param providers - Seam for tests.
 */
export async function videoHost(orgId: string, providers: readonly VideoHostProvider[] = VIDEO_HOST_PROVIDERS): Promise<VideoHost | null> {
  for (const p of providers) {
    try {
      const host = await p.resolve(orgId);
      if (host) {
        return host;
      }
    } catch (err) {
      const { logger } = await import('@/libs/Logger');
      logger.warn('video host not resolved', { orgId, host: p.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return null;
}
