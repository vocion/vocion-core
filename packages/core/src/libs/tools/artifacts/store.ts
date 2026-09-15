/**
 * Minimal artifact store for tool outputs (generated images, CSVs,
 * charts, docs). Writes bytes to a configurable directory and returns the
 * URL of the AUTHENTICATED route that serves them (`/api/artifacts/<id>/<file>`,
 * org-checked — see `serve.ts`).
 *
 * Default dir is `<cwd>/.artifacts` — deliberately NOT under `public/`:
 * anything under `public/` is served by Next to anyone who knows the URL,
 * and a revenue brief with a guessable name is not something to leave there
 * (found on a deployment 2026-09-15). Point `VOCION_ARTIFACTS_DIR` at a
 * mounted private volume in production. `VOCION_ARTIFACTS_URL_BASE` stays
 * as an override for deployments that serve the directory themselves
 * behind their own auth (a CDN with signed URLs, say); leave it unset to
 * use the built-in route.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { API_ARTIFACTS_BASE, servedArtifactUrl } from './url';

export type SavedArtifact = {
  id: string;
  filename: string;
  /** Absolute path on disk. */
  absPath: string;
  /** Served URL (relative). */
  url: string;
  contentType: string;
  bytes: number;
};

export function artifactsDir(): string {
  return process.env.VOCION_ARTIFACTS_DIR ?? path.join(process.cwd(), '.artifacts');
}

/** True when the configured directory would be served statically by Next — never acceptable in production. */
export function artifactsDirIsPublic(): boolean {
  const dir = path.resolve(artifactsDir());
  return dir.startsWith(path.resolve(process.cwd(), 'public') + path.sep);
}

export function artifactsUrlBase(): string {
  return process.env.VOCION_ARTIFACTS_URL_BASE ?? API_ARTIFACTS_BASE;
}

export async function saveArtifact(input: {
  orgId: string;
  data: Buffer | string;
  ext: string;
  contentType: string;
}): Promise<SavedArtifact> {
  const buf = typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : input.data;
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  const id = `${input.orgId}-${hash}`;
  const filename = `${id}.${input.ext.replace(/^\./, '')}`;
  const dir = artifactsDir();
  if (process.env.NODE_ENV === 'production' && artifactsDirIsPublic()) {
    console.warn('[artifacts] VOCION_ARTIFACTS_DIR points under public/ — files there are served unauthenticated. Move it to a private volume.');
  }
  await mkdir(dir, { recursive: true });
  const absPath = path.join(dir, filename);
  await writeFile(absPath, buf);
  return {
    id,
    filename,
    absPath,
    url: servedArtifactUrl(filename, artifactsUrlBase()),
    contentType: input.contentType,
    bytes: buf.byteLength,
  };
}
