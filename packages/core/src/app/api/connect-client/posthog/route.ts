/**
 * Vocion's PostHog OAuth client, published as a Client ID Metadata Document.
 *
 * PostHog does not make us register an app: our `client_id` is this URL, and
 * PostHog fetches it from the public internet to learn our name, logo and the
 * one callback it may send people back to. So this route must answer without
 * a session (everything under /api/ skips the page-auth gate in `proxy.ts`)
 * and must say exactly the callback `posthogProvider` sends.
 *
 * It lives beside, not under, `/api/connect/` so it cannot collide with the
 * dynamic `[provider]` routes there.
 */

import { NextResponse } from 'next/server';
import { posthogClientMetadata } from '@/libs/connect/providers/posthog';
import { connectOrigin } from '@/libs/connect/routes';

export const dynamic = 'force-dynamic';

/**
 * Serve the metadata document, or a 404 when this deployment has no public
 * origin to put in it.
 */
export function GET() {
  const origin = connectOrigin();
  if (!origin) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not set' }, { status: 404 });
  }
  return NextResponse.json(posthogClientMetadata(origin), { headers: { 'cache-control': 'public, max-age=300' } });
}
