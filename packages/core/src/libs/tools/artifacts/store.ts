/**
 * Minimal artifact store for tool outputs (generated images, CSVs,
 * charts, docs). Writes bytes to a configurable directory and returns a
 * served URL.
 *
 * Default dir is `<cwd>/public/artifacts`, served by Next at
 * `/artifacts/<file>` — good for self-host/dev. For serverless or
 * multi-instance deploys, point `VOCION_ARTIFACTS_DIR` at a mounted
 * volume, or swap this module for an object-storage backend later
 * (the call sites only depend on `saveArtifact`'s return shape).
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
  return process.env.VOCION_ARTIFACTS_DIR ?? path.join(process.cwd(), 'public', 'artifacts');
}

export function artifactsUrlBase(): string {
  return process.env.VOCION_ARTIFACTS_URL_BASE ?? '/artifacts';
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
  await mkdir(dir, { recursive: true });
  const absPath = path.join(dir, filename);
  await writeFile(absPath, buf);
  return {
    id,
    filename,
    absPath,
    url: `${artifactsUrlBase()}/${filename}`,
    contentType: input.contentType,
    bytes: buf.byteLength,
  };
}
