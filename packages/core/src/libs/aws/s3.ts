/**
 * Thin S3 helpers shared by the `s3` source connector, the vision tools and
 * the `dataset.add_example` action. One client per region, default AWS
 * credential chain (AWS_PROFILE / env / instance role) — the same assumption
 * the STS and KMS clients in this codebase already make.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const clients = new Map<string, S3Client>();

export function s3Client(region?: string): S3Client {
  const r = region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
  let c = clients.get(r);
  if (!c) {
    c = new S3Client({ region: r });
    clients.set(r, c);
  }
  return c;
}

/**
 * Parse `s3://bucket/key` or return `{ bucket: fallback, key }` for a bare key.
 * @param ref
 * @param fallbackBucket
 */
export function parseS3Ref(ref: string, fallbackBucket?: string): { bucket: string; key: string } {
  const m = ref.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (m?.[1] && m[2]) {
    return { bucket: m[1], key: m[2] };
  }
  if (!fallbackBucket) {
    throw new Error(`No bucket for key "${ref}" — pass s3://bucket/key or configure a bucket`);
  }
  return { bucket: fallbackBucket, key: ref.replace(/^\/+/, '') };
}

export type S3Entry = { key: string; size: number; lastModified: Date | null; etag: string | null };

export async function listKeys(opts: { bucket: string; prefix?: string; region?: string; max?: number }): Promise<S3Entry[]> {
  const out: S3Entry[] = [];
  let token: string | undefined;
  do {
    const res = await s3Client(opts.region).send(new ListObjectsV2Command({
      Bucket: opts.bucket,
      Prefix: opts.prefix,
      ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) {
      if (!o.Key || o.Key.endsWith('/')) {
        continue;
      }
      out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? null, etag: o.ETag ?? null });
      if (opts.max && out.length >= opts.max) {
        return out;
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function getObjectBytes(opts: { bucket: string; key: string; region?: string }): Promise<{ bytes: Buffer; contentType: string | null }> {
  const res = await s3Client(opts.region).send(new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }));
  const body = await res.Body?.transformToByteArray();
  if (!body) {
    throw new Error(`Empty object s3://${opts.bucket}/${opts.key}`);
  }
  return { bytes: Buffer.from(body), contentType: res.ContentType ?? null };
}

export async function objectExists(opts: { bucket: string; key: string; region?: string }): Promise<boolean> {
  try {
    await s3Client(opts.region).send(new HeadObjectCommand({ Bucket: opts.bucket, Key: opts.key }));
    return true;
  } catch {
    return false;
  }
}

export async function copyObject(opts: { bucket: string; fromKey: string; toKey: string; region?: string; metadata?: Record<string, string> }): Promise<void> {
  await s3Client(opts.region).send(new CopyObjectCommand({
    Bucket: opts.bucket,
    CopySource: `${opts.bucket}/${encodeURIComponent(opts.fromKey).replace(/%2F/g, '/')}`,
    Key: opts.toKey,
    ...(opts.metadata ? { Metadata: opts.metadata, MetadataDirective: 'REPLACE' } : {}),
  }));
}

export async function presignGet(opts: { bucket: string; key: string; region?: string; expiresIn?: number }): Promise<string> {
  return getSignedUrl(
    s3Client(opts.region),
    new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }),
    { expiresIn: opts.expiresIn ?? 900 },
  );
}

/**
 * Content type from a key's extension — S3 metadata is often missing for uploads.
 * @param key
 */
export function guessContentType(key: string): string {
  const ext = key.toLowerCase().split('.').pop() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/**
 * The in-app URL that serves an S3 object to a signed-in member — a 302 to a
 * short-lived presigned URL, issued only for buckets one of the org's `s3`
 * sources declares (see `app/api/v1/s3/object/route.ts`).
 * @param bucket
 * @param key
 */
export function appImageUrl(bucket: string, key: string): string {
  return `/api/v1/s3/object?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
}
