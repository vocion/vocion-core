/**
 * S3 connector — ingest the objects under a bucket prefix as documents, one
 * per object. Zero vault auth: the default AWS credential chain applies
 * (AWS_PROFILE / env / role), the same as the STS + KMS clients in core.
 *
 * Built for image corpora (manufacturing photo archives, scan folders) where
 * the *file* is the record and the text is thin: every document gets a short
 * synthetic `content` (path, parsed fields, size, capture time) so search and
 * agents can find it, plus `metadata.image_url` — an in-app URL that 302s to
 * a presigned GET (see `app/api/v1/s3/object/route.ts`) — so cards, pages and
 * object detail can render the picture without the bucket being public.
 *
 * Config:
 *   - `bucket`, `prefix?`, `region?`
 *   - `extensions?` — default images (.jpg .jpeg .png .webp)
 *   - `pathFields?` — map key-path segment index → metadata key, counted
 *     AFTER `prefix`. `{ template_id: 1, label: 2 }` on prefix `templates/`
 *     turns `templates/C-PM-134-PC/good/x.jpg` into
 *     `{ template_id: 'C-PM-134-PC', label: 'good' }`.
 *   - `filenamePattern?` — a regex with NAMED groups applied to the basename,
 *     merged into metadata (e.g. production order + capture timestamp).
 *
 * Sync is a full list each run (objects are immutable, cheap to list);
 * unchanged objects dedupe upstream on etag/content hash.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import path from 'node:path';
import { z } from 'zod';
import { appImageUrl, listKeys } from '@/libs/aws/s3';

const s3ConfigSchema = z.object({
  bucket: z.string().min(3).describe('S3 bucket name'),
  prefix: z.string().default('').describe('Key prefix to list under (e.g. templates/)'),
  region: z.string().optional().describe('AWS region; defaults to AWS_REGION'),
  extensions: z.array(z.string()).default(['.jpg', '.jpeg', '.png', '.webp']).describe('Object extensions to ingest'),
  pathFields: z.record(z.string(), z.number().int().min(0)).default({}).describe('metadata key → key-path segment index (after prefix)'),
  filenamePattern: z.string().optional().describe('Regex with named groups applied to the basename; groups become metadata'),
  maxObjects: z.number().int().positive().max(20_000).default(5000),
});

export type S3SourceConfig = z.infer<typeof s3ConfigSchema>;

export function parseS3Config(config: Record<string, unknown>): S3SourceConfig {
  return s3ConfigSchema.parse(config);
}

/**
 * Metadata derived from an object's key, per the connector config.
 * @param cfg
 * @param key
 */
export function metadataFromKey(cfg: S3SourceConfig, key: string): Record<string, unknown> {
  const rel = cfg.prefix && key.startsWith(cfg.prefix) ? key.slice(cfg.prefix.length) : key;
  const segs = rel.split('/');
  const meta: Record<string, unknown> = {};
  for (const [field, idx] of Object.entries(cfg.pathFields)) {
    const v = segs[idx];
    if (v !== undefined && idx < segs.length - 1) {
      meta[field] = v;
    }
  }
  if (cfg.filenamePattern) {
    try {
      const m = new RegExp(cfg.filenamePattern).exec(path.basename(key));
      for (const [k, v] of Object.entries(m?.groups ?? {})) {
        if (v !== undefined) {
          meta[k] = v;
        }
      }
    } catch { /* bad pattern — validated loosely; ignore */ }
  }
  return meta;
}

export const s3Connector: SourceConnector<typeof s3ConfigSchema> = {
  slug: 's3',
  name: 'Amazon S3',
  description: 'Ingest the objects under an S3 prefix — one document per file, with fields parsed from the key path and filename. Built for image archives; renders through a presigned in-app URL.',
  icon: 'Database',
  authKind: 'none',
  configSchema: s3ConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = s3ConfigSchema.parse(ctx.config);
    let entries;
    try {
      entries = await listKeys({ bucket: cfg.bucket, prefix: cfg.prefix || undefined, region: cfg.region, max: cfg.maxObjects });
    } catch (err) {
      ctx.onProgress?.({ kind: 'error', uri: `s3://${cfg.bucket}/${cfg.prefix}`, message: `list failed: ${(err as Error).message}` });
      return;
    }
    const exts = new Set(cfg.extensions.map(e => e.toLowerCase()));
    for (const e of entries) {
      const ext = path.extname(e.key).toLowerCase();
      if (!exts.has(ext)) {
        ctx.onProgress?.({ kind: 'skipped', uri: e.key, message: 'extension not ingested' });
        continue;
      }
      const meta = metadataFromKey(cfg, e.key);
      const basename = path.basename(e.key);
      const lines = [
        `Image ${basename}`,
        `Path: s3://${cfg.bucket}/${e.key}`,
        ...Object.entries(meta).map(([k, v]) => `${k}: ${String(v)}`),
        e.lastModified ? `Uploaded: ${e.lastModified.toISOString()}` : null,
        `Size: ${e.size} bytes`,
      ].filter((l): l is string => l !== null);
      ctx.onProgress?.({ kind: 'fetched', uri: e.key });
      yield {
        externalId: e.key,
        uri: `s3://${cfg.bucket}/${e.key}`,
        title: basename,
        content: lines.join('\n'),
        etag: e.etag,
        lastModifiedAt: e.lastModified,
        metadata: {
          ...meta,
          bucket: cfg.bucket,
          image_key: e.key,
          image_url: appImageUrl(cfg.bucket, e.key),
          bytes: e.size,
          contentType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg',
        },
      };
    }
  },
};
