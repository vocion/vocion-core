import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { readBrandAsset } from '@/libs/tools/artifacts/media';

/**
 * `GET /api/media/brand/:accountId/:filename` — an Org's logo or mark
 * (`libs/tools/artifacts/media.ts` § brand files), to anyone.
 *
 * Public on purpose: the sign-in page shows the logo before anyone signs in,
 * the browser tab asks for the mark as a favicon, and mail shows the logo in
 * a client that has no session. What keeps that safe is what can be stored —
 * a PNG, or an SVG rebuilt from an allowlist — plus a policy that forbids
 * scripts and outside requests should the file ever be opened as a page, and
 * the name, which carries the content hash, so a URL never changes what it
 * shows and can be cached for a year.
 *
 * `?format=png` asks for an SVG as a PNG, 96px tall: most mail clients will
 * not draw an SVG, so a mail header asks for this (`services/branding/mailBrand.ts`).
 * @param req - The request.
 * @param ctx - The route.
 * @param ctx.params - The Org and the file.
 */
export async function GET(req: Request, ctx: { params: Promise<{ accountId: string; filename: string }> }) {
  const { accountId, filename } = await ctx.params;
  const found = await readBrandAsset(accountId, filename);
  if (!found) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Brand file not found' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  let body: Uint8Array = found.bytes;
  let contentType = found.contentType;
  if (new URL(req.url).searchParams.get('format') === 'png' && contentType === 'image/svg+xml') {
    try {
      const sharp = (await import('sharp')).default;
      body = new Uint8Array(await sharp(Buffer.from(found.bytes), { density: 288 }).resize({ height: 96 }).png().toBuffer());
      contentType = 'image/png';
    } catch {
      // An SVG sharp cannot draw is served as it is; the mail shows its alt text.
    }
  }
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; sandbox',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
