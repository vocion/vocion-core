import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { presignGet } from '@/libs/aws/s3';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';
import { authApi, isErrorResponse, jsonError } from '../../_shared';

/**
 * GET /api/v1/s3/object?bucket=…&key=…
 *
 * Serves a private S3 object to a signed-in member by redirecting to a
 * short-lived presigned URL. The bucket must be declared by one of the
 * caller's org's `s3` sources — the source is the grant, so a workspace
 * cannot be used to read arbitrary buckets the AWS credentials can see.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const bucket = url.searchParams.get('bucket') ?? '';
  const key = url.searchParams.get('key') ?? '';
  if (!bucket || !key) {
    return jsonError('BAD_REQUEST', 'bucket and key are required', 400);
  }

  const source = await db.query.knowledgeSourceSchema.findFirst({
    where: and(
      eq(knowledgeSourceSchema.orgId, caller.orgId),
      sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 's3'`,
      sql`${knowledgeSourceSchema.configJson} ->> 'bucket' = ${bucket}`,
    ),
  });
  if (!source) {
    return jsonError('FORBIDDEN', 'No s3 source in this workspace declares that bucket', 403);
  }
  const region = typeof source.configJson.region === 'string' ? source.configJson.region : undefined;
  const signed = await presignGet({ bucket, key, region, expiresIn: 900 });
  return NextResponse.redirect(signed, { status: 302, headers: { 'cache-control': 'private, max-age=600' } });
}
