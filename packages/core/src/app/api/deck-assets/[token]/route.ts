/**
 * `GET /api/deck-assets/<token>` — one stored file of a checked-out
 * deliverable, for an outside assistant that cannot sign in. The token names
 * one file in one workspace and expires (`libs/decks/assetLink.ts`); anything
 * else is a 404 that says nothing about what exists. Sign-in free, so it stays
 * light: the file store only.
 */

import type { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { readAssetLinkToken } from '@/libs/decks/assetLink';
import { artifactsDir } from '@/libs/tools/artifacts/store';
import { contentTypeForExt, parseArtifactFilename } from '@/libs/tools/artifacts/url';

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

/**
 * @param _req - The request.
 * @param ctx - The route.
 * @param ctx.params - The token.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const claim = readAssetLinkToken(decodeURIComponent(token));
  if (!claim) {
    return notFound();
  }
  const dir = path.resolve(/* turbopackIgnore: true */ artifactsDir());
  const abs = path.resolve(dir, claim.filename);
  if (!abs.startsWith(dir + path.sep)) {
    return notFound();
  }
  try {
    const body = await readFile(abs);
    const ext = parseArtifactFilename(claim.filename)?.ext ?? '';
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': contentTypeForExt(ext),
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Disposition': `attachment; filename="${claim.filename}"`,
      },
    });
  } catch {
    return notFound();
  }
}
